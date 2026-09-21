// supabase/functions/mensagem-parceiro-exigencia/index.ts
//
// Reescreve, em linguagem simples, uma exigência de documentos pro parceiro
// leigo — a versão sob demanda do redigirMensagemParceiro que já roda dentro
// do inss-email-processor. Hoje atende o template "Exigência Judicial",
// aplicado manualmente no TarefaSheet: a equipe cola o trecho da publicação
// (Legalmail) e informa o prazo fatal; o campo `tipo` existe pra estender ao
// fluxo manual do INSS depois.
//
// Entrada (POST, JWT de usuário interno):
//   { tipo: "judicial", despacho: string, prazo_parceiro: "aaaa-mm-dd" | null,
//     nome_cliente?: string }
// prazo_parceiro é o "enviar até" do parceiro (fatal − 3, regra da casa), o
// mesmo prazo_at da solicitação. O fatal real não entra aqui: nunca chega ao
// parceiro. A data na mensagem é posta por esta função, não pela IA (prazo.ts).
//
// Saída SEMPRE 200 com { mensagem: string | null, motivo?: string }.
// mensagem null = quem chamou usa o texto padrão do template. A IA nunca
// bloqueia a aplicação do template — mesma filosofia do fluxo automático.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

import { chatWith } from "../_shared/ia-providers.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { carregarIntegracao } from "../_shared/ia-integracao.ts";
import { MARCADOR_PRAZO, montarMensagem } from "./prazo.ts";
import { exigirUsuario } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PROMPT_JUDICIAL = `Você redige mensagens curtas para parceiros comerciais de um escritório de advocacia previdenciária brasileiro. O parceiro é LEIGO: não entende de Direito nem os termos da Justiça.

Você receberá o trecho de uma publicação/intimação judicial em que o juiz exige documentos num processo do cliente. Elabore, de forma simples e objetiva, uma mensagem para o parceiro dizendo o que precisa ser providenciado e qual é o prazo.

Regras de conteúdo:
- Comece com "Olá!" e uma frase curta explicando o que a Justiça pediu (em palavras simples, sem jargão; se houver termo técnico, explique).
- Liste o que o cliente/parceiro deve fazer em passos numerados (1., 2., 3., ...), um passo por linha, frases curtas.
- PRAZO: depois dos passos, escreva numa linha sozinha exatamente ${MARCADOR_PRAZO} — o sistema troca esse marcador pelo prazo certo, com a data. Não escreva data, dia da semana nem quantidade de dias em nenhum lugar da mensagem, nem os do trecho da publicação.
- Avise que, se os documentos não chegarem a tempo, o juiz pode decidir o processo sem eles, o que pode prejudicar o caso.
- Termine pedindo que providencie o quanto antes e envie ao escritório para fazermos a juntada no processo.
- Não mencione número do processo, vara, nome do juiz, artigos de lei nem sites de tribunal (quem peticiona é o escritório).
- Quando o problema for assinatura eletrônica não validada (procuração, termos, declarações), oriente as duas saídas aceitas: (a) imprimir o documento e assinar de próprio punho, com caneta, enviando foto ou digitalização colorida, completa e legível, sem cortar nenhuma parte; ou (b) assinar digitalmente pelo gov.br (assinatura gov.br). Não cite outros sites.
- Documentos em foto/digitalização devem estar coloridos, legíveis e completos (frente e verso quando houver).

Regras de formato (importante — o texto é exibido como texto puro):
- Separe os blocos com UMA linha em branco: saudação/explicação, lista de passos, ${MARCADOR_PRAZO}, fechamento.
- Um item numerado por linha.
- Sem markdown (nada de *, #, listas com -, blocos de código).
- Responda SOMENTE com a mensagem final, sem comentários.`;

// Provedor de IA pendurado não pode segurar a UI até o gateway estourar 504 —
// depois do limite, cai no catch e o template segue com o texto padrão. O
// signal aborta o fetch do provedor (não só a espera): nada fica rodando nem
// gastando token depois do limite.
const IA_TIMEOUT_MS = 45_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }

  // A checagem vinha DEPOIS de ler o corpo: com corpo vazio a função respondia 200 sem saber quem chamou. Agora é a primeira coisa.
  const quem = await exigirUsuario(req, { tipo: "interno" });
  if (quem instanceof Response) return quem;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "secrets ausentes na funcao" }, 500);
  }

  let body: {
    tipo?: string;
    despacho?: string;
    prazo_parceiro?: string | null;
    nome_cliente?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body invalido" }, 400);
  }

  const despacho = (body.despacho ?? "").trim();
  if (!despacho) {
    return jsonResponse({ mensagem: null, motivo: "sem_despacho" });
  }

  const admin = quem.admin;
  // Front anterior a 2026-09-15 mandava o fatal cru, que não pode ir pro
  // parceiro: sem o "enviar até", a IA fica de fora e vale o texto padrão.
  if (!("prazo_parceiro" in body)) {
    return jsonResponse({ mensagem: null, motivo: "sem_prazo_parceiro" });
  }
  const prazoParceiro = body.prazo_parceiro ?? null;
  if (prazoParceiro !== null && !/^\d{4}-\d{2}-\d{2}$/.test(prazoParceiro)) {
    return jsonResponse({ error: "prazo_parceiro deve ser aaaa-mm-dd" }, 400);
  }

  const resIntegracao = await carregarIntegracao(admin, quem.uid);
  if (!resIntegracao.ok) {
    // Sem IA configurada não é erro do fluxo: o template segue com o texto padrão.
    return jsonResponse({ mensagem: null, motivo: resIntegracao.code });
  }

  try {
    const apiKey = await decryptSecret(
      resIntegracao.integ.api_key_cipher,
      resIntegracao.integ.api_key_iv,
    );
    const res = await chatWith(
      resIntegracao.integ.provider,
      apiKey,
      resIntegracao.integ.modelo,
      {
        system: PROMPT_JUDICIAL,
        tools: [],
        maxTokens: 900,
        messages: [{
          role: "user",
          content:
            `Cliente: ${body.nome_cliente || "(sem nome)"}\n\n` +
            `Trecho da publicação/despacho judicial:\n${despacho}`,
        }],
        signal: AbortSignal.timeout(IA_TIMEOUT_MS),
      },
    );
    const texto = (res.text || "").trim();
    // Resposta vazia ou curta demais = modelo se perdeu; melhor o texto padrão.
    if (texto.length < 40) {
      return jsonResponse({ mensagem: null, motivo: "resposta_curta" });
    }
    const montagem = montarMensagem(texto, prazoParceiro);
    if (!montagem.ok) {
      console.warn(
        `[mensagem-parceiro-exigencia] IA escreveu prazo por conta própria (${montagem.achados.join(" | ")}); vai o texto padrão`,
      );
      return jsonResponse({ mensagem: null, motivo: montagem.motivo });
    }
    return jsonResponse({ mensagem: montagem.mensagem });
  } catch (err) {
    console.warn("[mensagem-parceiro-exigencia] falha na IA:", err);
    return jsonResponse({ mensagem: null, motivo: "falha_ia" });
  }
});
