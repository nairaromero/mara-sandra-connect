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
//   { tipo: "judicial", despacho: string, prazo_fatal?: "aaaa-mm-dd",
//     nome_cliente?: string }
//
// Saída SEMPRE 200 com { mensagem: string | null, motivo?: string }.
// mensagem null = quem chamou usa o texto padrão do template. A IA nunca
// bloqueia a aplicação do template — mesma filosofia do fluxo automático.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

import { chatWith } from "../_shared/ia-providers.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { carregarIntegracao } from "../_shared/ia-integracao.ts";

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
- Destaque o prazo com "⚠️" e a data entre asteriscos, assim: *DD/MM/AAAA*. Use exatamente a data informada como PRAZO FATAL no input; não invente. Peça que os documentos cheguem ao escritório alguns dias antes dessa data, porque quem faz o protocolo no processo é o escritório e isso leva tempo.
- Se o input disser que o prazo não foi informado, não invente data: diga que o prazo é curto e que o escritório confirmará a data.
- Avise que, se os documentos não chegarem a tempo, o juiz pode decidir o processo sem eles, o que pode prejudicar o caso.
- Termine pedindo que providencie o quanto antes e envie ao escritório para fazermos a juntada no processo.
- Não mencione número do processo, vara, nome do juiz, artigos de lei nem sites de tribunal (quem peticiona é o escritório).
- Quando o problema for assinatura eletrônica não validada (procuração, termos, declarações), oriente as duas saídas aceitas: (a) imprimir o documento e assinar de próprio punho, com caneta, enviando foto ou digitalização colorida, completa e legível, sem cortar nenhuma parte; ou (b) assinar digitalmente pelo gov.br (assinatura gov.br). Não cite outros sites.
- Documentos em foto/digitalização devem estar coloridos, legíveis e completos (frente e verso quando houver).

Regras de formato (importante — o texto é exibido como texto puro):
- Separe os blocos com UMA linha em branco: saudação/explicação, lista de passos, prazo, fechamento.
- Um item numerado por linha.
- Sem markdown além dos asteriscos da data (nada de #, **, listas com -, blocos de código).
- Responda SOMENTE com a mensagem final, sem comentários.`;

function dataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Provedor de IA pendurado não pode segurar a UI até o gateway estourar 504 —
// depois do limite, cai no catch e o template segue com o texto padrão.
const IA_TIMEOUT_MS = 45_000;
function comTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout da IA (45s)")), IA_TIMEOUT_MS)
    ),
  ]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "secrets ausentes na funcao" }, 500);
  }

  let body: {
    tipo?: string;
    despacho?: string;
    prazo_fatal?: string | null;
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Só usuário interno logado — a chave de IA cobrada é a dele (ou a
  // compartilhada do escritório).
  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  let usuarioId: string | null = null;
  if (jwt) {
    const { data: u } = await admin.auth.getUser(jwt);
    if (u?.user?.id) usuarioId = u.user.id;
  }
  if (!usuarioId) {
    return jsonResponse({ error: "JWT valido obrigatorio" }, 401);
  }
  const { data: perfil } = await admin
    .from("usuarios")
    .select("tipo")
    .eq("id", usuarioId)
    .maybeSingle();
  if (perfil?.tipo !== "interno") {
    return jsonResponse({ error: "apenas usuario interno" }, 403);
  }

  const resIntegracao = await carregarIntegracao(admin, usuarioId);
  if (!resIntegracao.ok) {
    // Sem IA configurada não é erro do fluxo: o template segue com o texto padrão.
    return jsonResponse({ mensagem: null, motivo: resIntegracao.code });
  }

  try {
    const apiKey = await decryptSecret(
      resIntegracao.integ.api_key_cipher,
      resIntegracao.integ.api_key_iv,
    );
    const hoje = new Date(Date.now() - 3 * 3600_000).toLocaleDateString("pt-BR");
    const prazoLinha = body.prazo_fatal
      ? `PRAZO FATAL: ${dataBR(body.prazo_fatal)}`
      : "PRAZO FATAL: não informado";
    const res = await comTimeout(chatWith(
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
            `Data de hoje: ${hoje}\n` +
            `Cliente: ${body.nome_cliente || "(sem nome)"}\n` +
            `${prazoLinha}\n\n` +
            `Trecho da publicação/despacho judicial:\n${despacho}`,
        }],
      },
    ));
    const texto = (res.text || "").trim();
    // Resposta vazia ou curta demais = modelo se perdeu; melhor o texto padrão.
    if (texto.length < 40) {
      return jsonResponse({ mensagem: null, motivo: "resposta_curta" });
    }
    return jsonResponse({ mensagem: texto });
  } catch (err) {
    console.warn("[mensagem-parceiro-exigencia] falha na IA:", err);
    return jsonResponse({ mensagem: null, motivo: "falha_ia" });
  }
});
