// =============================================================================
// Edge Function: extrair-dados-cliente
//
// Le RG/CNH e comprovante de endereco (imagem ou PDF) e devolve os campos do
// cadastro de cliente ja preenchidos, pra equipe conferir antes de salvar.
// Usa o OCR nativo do modelo (BYOK, mesma chave do resto da IA) — nao ha
// servico de OCR separado.
//
// Body: { arquivos: [{ nome, mime, base64, tipo }] }   (base64 SEM prefixo data:)
//        tipo: "rg_cpf" | "comprovante_residencia"
// Resp: { campos: {nome, cpf, data_nascimento, endereco}, avisos, usage }
//
// Auth: JWT de usuario INTERNO. Documento de identidade nao passa por parceiro
// (decisao da Naira) — parceiro continua cadastrando a mao.
//
// A funcao NAO grava nada: quem salva o cliente e arquiva os documentos e a
// tela, depois da conferencia. Erro de leitura nunca vira dado sem revisao.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IA_MASTER_KEY.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { carregarIntegracao } from "../_shared/ia-integracao.ts";
import { chatWith, type Attachment } from "../_shared/ia-providers.ts";
import { extrairJson, montarCampos } from "../_shared/documento-campos.ts";

// Documento de identidade e comprovante sao arquivos pequenos; teto baixo de
// proposito, porque base64 infla ~33% e o worker tem memoria curta.
const MAX_ARQUIVOS = 4;
const MAX_BYTES_ARQUIVO = 8 * 1024 * 1024;
const MAX_BYTES_TOTAL = 16 * 1024 * 1024;

const SYSTEM =
  "Voce extrai dados cadastrais de documentos brasileiros para um escritorio de " +
  "advocacia previdenciaria.\n\n" +
  "ONDE PROCURAR CADA DADO, POR TIPO DE DOCUMENTO:\n" +
  "- CNH (Carteira Nacional de Habilitacao): o CPF vem impresso na frente, em " +
  "campo proprio rotulado CPF. Tambem traz nome, data de nascimento e filiacao. " +
  "O 'Nº REGISTRO' e o numero da habilitacao — NAO e o CPF.\n" +
  "- RG / Carteira de Identidade: modelos recentes trazem o CPF junto do RG; nos " +
  "antigos ele pode estar no verso, no rodape ou ausente. Procure em todo o " +
  "documento antes de concluir que nao ha. O 'Registro Geral' NAO e o CPF.\n" +
  "- CIN (Carteira de Identidade Nacional): o numero do documento E o CPF.\n" +
  "- Certidao de nascimento: NAO tem CPF. Extraia nome do registrado e data de " +
  "nascimento; ignore os nomes dos pais e avos, o nome e o do registrado.\n" +
  "- Comprovante de residencia: use para o endereco. O nome no comprovante pode " +
  "ser de terceiro (titular da conta) — nao use esse nome se houver documento de " +
  "identidade junto.\n\n" +
  "VARIOS DOCUMENTOS NA MESMA MENSAGEM:\n" +
  "Podem vir varios documentos de identidade — frente e verso do mesmo RG, ou RG " +
  "mais CPF avulso, ou RG mais CNH. Todos sao da MESMA pessoa. Combine-os: para " +
  "cada campo, use o documento em que ele estiver mais legivel. Se um traz o CPF " +
  "completo e outro so parte, use o completo.\n" +
  "SE OS DOCUMENTOS PARECEREM DE PESSOAS DIFERENTES (nomes ou datas de nascimento " +
  "incompativeis entre si), NAO misture os dados: extraia do documento de " +
  "identidade mais completo e diga isso em observacoes. Nome diferente no " +
  "comprovante de residencia e normal (a conta pode estar em nome de outra " +
  "pessoa) e NAO caracteriza conflito — nesse caso use o comprovante so pro " +
  "endereco.\n\n" +
  "REGRAS ABSOLUTAS:\n" +
  "1. Extraia SOMENTE o que estiver legivel. Nunca deduza nem invente um dado. " +
  "Campo ilegivel ou ausente = null.\n" +
  "2. EXCECAO IMPORTANTE PARA O CPF: se parte dos digitos estiver ilegivel, NAO " +
  "devolva null. Devolva os digitos que voce consegue ler, NA ORDEM, sem inventar " +
  "os demais. E muito comum os dois digitos apos o hifen sairem ilegiveis em " +
  "documento gasto ou escaneado: nesse caso devolva os 9 primeiros. O sistema " +
  "sabe completar os dois ultimos e avisa a equipe para conferir.\n" +
  "3. Nao corrija nomes que parecam grafados de forma incomum — transcreva " +
  "exatamente como esta no documento.\n" +
  "4. Responda APENAS com o objeto JSON, sem texto antes ou depois, sem cercas " +
  "de markdown.\n\n" +
  "Formato exato da resposta:\n" +
  "{\n" +
  '  "nome": string|null,            // nome civil completo, como no documento\n' +
  '  "cpf": string|null,             // so digitos; 11 se legivel inteiro, ou os 9 primeiros se o final estiver ilegivel\n' +
  '  "data_nascimento": string|null, // AAAA-MM-DD\n' +
  '  "endereco": string|null,        // logradouro, numero, complemento, bairro, cidade/UF, CEP\n' +
  '  "observacoes": string|null      // o que voce nao conseguiu ler, ou duvida relevante\n' +
  "}";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: "ambiente incompleto" }, 500);
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "sem token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userData } = await admin.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (!uid) return jsonResponse({ error: "token invalido" }, 401);

  const { data: perfil } = await admin
    .from("usuarios")
    .select("tipo")
    .eq("id", uid)
    .maybeSingle();
  if (perfil?.tipo !== "interno") {
    return jsonResponse({ error: "apenas interno pode ler documentos" }, 403);
  }

  // Chave própria; sem ela, cai na compartilhada do escritório (se houver).
  const resIntegracao = await carregarIntegracao(admin, uid);
  if (!resIntegracao.ok) {
    return jsonResponse(
      { error: resIntegracao.error, code: resIntegracao.code },
      resIntegracao.status,
    );
  }
  const integ = resIntegracao.integ;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  const brutos = Array.isArray(body.arquivos) ? body.arquivos : [];
  if (brutos.length === 0) return jsonResponse({ error: "nenhum arquivo enviado" }, 400);
  if (brutos.length > MAX_ARQUIVOS) {
    return jsonResponse({ error: `no maximo ${MAX_ARQUIVOS} arquivos por vez` }, 400);
  }

  const attachments: Attachment[] = [];
  const descricoes: string[] = [];
  let totalBytes = 0;

  for (const bruto of brutos) {
    const a = bruto as Record<string, unknown>;
    const base64 = typeof a.base64 === "string" ? a.base64 : "";
    const mime = typeof a.mime === "string" ? a.mime.toLowerCase() : "";
    const nome = typeof a.nome === "string" ? a.nome : "documento";
    const tipo = a.tipo === "comprovante_residencia" ? "comprovante_residencia" : "rg_cpf";

    if (!base64) return jsonResponse({ error: `arquivo ${nome} sem conteudo` }, 400);

    const ehPdf = mime === "application/pdf";
    const ehImagem = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
    if (!ehPdf && !ehImagem) {
      return jsonResponse(
        { error: `formato nao suportado em ${nome}: use PDF, JPEG, PNG ou WEBP` },
        400,
      );
    }

    // base64 infla ~4/3; estima o tamanho bruto sem decodificar.
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes > MAX_BYTES_ARQUIVO) {
      return jsonResponse(
        { error: `${nome} tem ${(bytes / 1048576).toFixed(1)} MB; o limite e 8 MB` },
        400,
      );
    }
    totalBytes += bytes;
    if (totalBytes > MAX_BYTES_TOTAL) {
      return jsonResponse({ error: "soma dos arquivos passa de 16 MB" }, 400);
    }

    attachments.push({ kind: ehPdf ? "pdf" : "image", mediaType: mime, base64, name: nome });
    descricoes.push(
      `- ${nome}: ${
        tipo === "rg_cpf" ? "documento de identidade (RG/CNH/CPF)" : "comprovante de residencia"
      }`,
    );
  }

  let apiKey: string;
  try {
    apiKey = await decryptSecret(integ.api_key_cipher, integ.api_key_iv);
  } catch {
    return jsonResponse({ error: "falha ao abrir a chave configurada" }, 500);
  }

  let res: { text: string; usage: { input: number; output: number } };
  try {
    res = await chatWith(integ.provider, apiKey, integ.modelo, {
      system: SYSTEM,
      maxTokens: 1200,
      tools: [],
      attachments,
      messages: [
        {
          role: "user",
          content: "Extraia os dados cadastrais dos documentos anexados nesta mensagem.\n" +
            descricoes.join("\n") +
            "\n\nO endereco deve vir do comprovante de residencia quando houver um. " +
            "Responda apenas com o JSON.",
        },
      ],
    });
  } catch (e) {
    return jsonResponse({ error: "falha ao ler o documento: " + String(e) }, 502);
  }

  const obj = extrairJson(res.text);
  if (!obj) {
    return jsonResponse(
      { error: "a IA nao devolveu um JSON legivel; tente novamente ou preencha a mao" },
      502,
    );
  }

  const { campos, avisos, calculados } = montarCampos(obj);

  return jsonResponse({
    campos,
    avisos,
    calculados,
    usage: res.usage,
    modelo: integ.modelo,
    provider: integ.provider,
  });
});
