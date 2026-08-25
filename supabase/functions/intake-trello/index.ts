// =============================================================================
// intake-trello — importa clientes novos do board do André (Trello).
//
// Substitui os workflows n8n "V2.2 - Intake STAGE 1/2" (Trello → Tramitação
// Inteligente + Drive). Ver planning/INTEGRACAO_TRELLO.md.
//
// Fluxo por rodada (cron a cada 2 dias, ou chamada manual):
//   1. Lê os cards da lista-gatilho pela API do Trello.
//   2. Card novo (sem linha em intake_trello_runs): parseia a descrição e cria
//      cliente + caso em nome do parceiro (André), senha do Meu INSS cifrada
//      via RPC set_senha_meu_inss_sistema.
//   3. Baixa os documentos da pasta do Drive do card (conexão Google da equipe,
//      escopo drive.readonly) e os anexos hospedados no próprio Trello; sobe
//      pro bucket `documentos` com tipo sugerido pela heurística de nome;
//      IA (integração da Naira) só nos que ficarem como "outro".
//   4. Grava o resultado em intake_trello_runs (concluido/pendente/erro) e
//      manda relatório por e-mail + notificação no sino.
//
// Idempotência: card com run 'concluido' ou 'pendente' nunca repete; 'erro'
// (falha ANTES de criar qualquer coisa) é retentado na rodada seguinte.
//
// Body opcional (POST): { "dry_run": true, "para": "email", "sempre": true,
//   "max_cards": 8 }. dry_run só lista o que faria, sem escrever nada.
//
// Deploy: bunx supabase functions deploy intake-trello --no-verify-jwt \
//   --project-ref alhqbpbekmxpoibrrnbi   (staging primeiro; depois prod)
// Secrets: TRELLO_API_KEY, TRELLO_TOKEN (+ os já existentes GMAIL_CLIENT_ID,
//   GMAIL_CLIENT_SECRET, IA_MASTER_KEY, RESEND_API_KEY, APP_URL).
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { decryptSecret } from "../_shared/crypto.ts";
import { carregarIntegracao, IntegracaoIA } from "../_shared/ia-integracao.ts";
import { Attachment, chatWith } from "../_shared/ia-providers.ts";
import { extrairJson } from "../_shared/documento-campos.ts";
import { extrairNome, parsearCard } from "./parse.ts";
import {
  baixarArquivo,
  DriveArquivo,
  listarArquivosPasta,
  obterAccessTokenGoogle,
} from "./drive.ts";
import { inferirTipoPorNome } from "./doc-type-inference.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TRELLO_API_KEY = Deno.env.get("TRELLO_API_KEY") ?? "";
const TRELLO_TOKEN = Deno.env.get("TRELLO_TOKEN") ?? "";
// Lista "2.5.) NAIRA>ORGANIZAÇÃO DE DOCUMENTOS P/ REQ ADM" do board
// 01-AÇÕES PREVIDENCIÁRIAS (o gatilho histórico do intake).
const TRELLO_LISTA_ID = Deno.env.get("TRELLO_LISTA_ID") ?? "667f448ec6b497edbdd2eb22";
// Usuário parceiro dono dos cards (André Alves Servan). O espelho de staging
// preserva ids, então o mesmo default vale nos dois ambientes.
const PARCEIRO_ID = Deno.env.get("INTAKE_PARCEIRO_ID") ?? "5d4cf10c-00b2-4e65-8dec-0416dd516d26";
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") ?? "";
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://marasandraconnect.com";
const NAIRA_EMAIL = Deno.env.get("NAIRA_EMAIL_DEFAULT") ?? "nairaromerovian@gmail.com";
const EMAIL_FROM = "Mara Sandra Advocacia <noreply@marasandraconnect.com>";

const MAX_CARDS_POR_RODADA = 8; // gateway derruba em 150s; cada card pesa
const MAX_DOCS_POR_CARD = 80;
const MAX_IA_POR_RODADA = 20;
const MAX_ARQUIVO_BYTES = 50 * 1024 * 1024; // limite do bucket `documentos`
const MAX_IA_BYTES = 8 * 1024 * 1024;
const IA_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

// Etiqueta do Trello -> nome em tipos_beneficio (validado contra o banco na
// rodada; etiqueta sem mapa ou nome inexistente vira "Outro").
const ETIQUETA_PARA_BENEFICIO: Record<string, string> = {
  "auxílio acidente": "Auxílio-acidente",
  "auxílio - doença/invalidez": "Auxílio por incapacidade temporária",
  "beneficio incapacidade acidentaria": "Auxílio por incapacidade temporária",
  "aposentadoria p/ invalidez": "Aposentadoria por incapacidade permanente",
  "aposentadoria por tc/idade": "Aposentadoria por tempo de contribuição",
  "aposentadoria especial": "Aposentadoria especial",
  "aposentadoria pcd": "Aposentadoria da PCD (LC 142/2013)",
  "aposentadoria por tc/deficiencia": "Aposentadoria da PCD (LC 142/2013)",
  "aposentadoria do professor": "Aposentadoria por tempo de contribuição",
  "pensão p/ morte": "Pensão por morte",
  "bpc/loas": "BPC/LOAS",
  "revisão": "Revisão de aposentadoria",
};

const PROMPT_CLASSIFICACAO = `Você classifica documentos de um escritório previdenciário brasileiro.
Analise o documento anexo e responda SOMENTE um JSON: {"tipo": "<chave>"}.

Chaves possíveis (use exatamente uma):
- rg_cpf: RG, CNH, CPF, CIN, Cadastro Único de pessoa física
- comprovante_residencia: conta de luz/água/telefone, contrato de aluguel usado como endereço
- ctps: Carteira de Trabalho
- cnis: extrato CNIS completo (relações previdenciárias detalhadas)
- cnis_resumido: CNIS resumido
- hiscre: extrato HISCRE
- laudo_inss: laudo do INSS (SABI, PMF, perícia federal — cabeçalho do INSS)
- laudo_medico: laudo, exame ou relatório médico particular
- atestado_medico: atestado médico
- holerite: holerite / contracheque
- ltcat: LTCAT
- pgr_ppra: PGR ou PPRA
- ppp: Perfil Profissiográfico Previdenciário
- cat: Comunicação de Acidente de Trabalho (CAT / eSocial)
- ctc: Certidão de Tempo de Contribuição
- carta_concessao_inss: carta de concessão ou indeferimento do INSS
- carne_gps: carnê / guia de contribuição GPS
- certidao_nascimento | certidao_casamento | certidao_obito: certidões de registro civil (pelo TÍTULO)
- cnpj_empregadora: cartão CNPJ de empresa (não confundir com documento pessoal)
- procuracao: procuração (administrativa ou ad judicia)
- substabelecimento: substabelecimento
- contrato_honorarios: contrato de honorários
- termo_representacao: termo de representação e autorização (INSS)
- autodeclaracao_veracidade: autodeclaração de autenticidade e veracidade
- termo_renuncia_teto: termo de renúncia ao teto dos JEF
- termo_responsabilidade: termo de responsabilidade
- declaracao_hipossuficiencia: declaração de hipossuficiência / pobreza
- declaracao_ausencia_duplicidade: declaração de ausência de duplicidade de ações
- declaracao_uniao_estavel | declaracao_atividade_rural: as respectivas declarações
- outro: nada acima

Priorize o cabeçalho/título do documento sobre o nome do arquivo.`;

// Mesma sanitização do front (Storage rejeita chave com acento).
function sanitizeFileName(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_");
}

function formatarTelefone(digitos: string | null): string | null {
  if (!digitos) return null;
  if (digitos.length === 11) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  }
  if (digitos.length === 10) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  }
  return digitos;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  shortUrl: string;
  labels?: Array<{ name?: string }>;
  attachments?: Array<{ id: string; name?: string; url?: string; bytes?: number; mimeType?: string }>;
}

async function buscarCardsDaLista(): Promise<Array<TrelloCard>> {
  const params = new URLSearchParams({
    key: TRELLO_API_KEY,
    token: TRELLO_TOKEN,
    fields: "name,desc,shortUrl,labels",
    attachments: "true",
    attachment_fields: "name,url,bytes,mimeType",
  });
  const resp = await fetch(`https://api.trello.com/1/lists/${TRELLO_LISTA_ID}/cards?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Trello: HTTP ${resp.status} ${await resp.text()}`);
  return (await resp.json()) as Array<TrelloCard>;
}

/** Anexo hospedado no próprio Trello exige o header OAuth pra baixar. */
async function baixarAnexoTrello(url: string): Promise<Uint8Array> {
  const resp = await fetch(url, {
    headers: {
      Authorization: `OAuth oauth_consumer_key="${TRELLO_API_KEY}", oauth_token="${TRELLO_TOKEN}"`,
    },
    signal: AbortSignal.timeout(90_000),
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`Anexo Trello: HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

function mapearBeneficio(
  labels: Array<{ name?: string }> | undefined,
  nomesValidos: Set<string>,
): string {
  for (const l of labels ?? []) {
    const alvo = ETIQUETA_PARA_BENEFICIO[(l.name ?? "").trim().toLowerCase()];
    if (alvo && nomesValidos.has(alvo)) return alvo;
  }
  return nomesValidos.has("Outro") ? "Outro" : "Outro";
}

// --- Conexão Google (mesma do Gmail; precisa do escopo drive.readonly) ------
async function obterAccessTokenDrive(
  sb: SupabaseClient,
): Promise<{ token: string } | { erro: string }> {
  let { data: vinculo } = await sb
    .from("usuario_gmail_oauth")
    .select("refresh_cipher, refresh_iv, scope")
    .eq("email_conectado", NAIRA_EMAIL)
    .maybeSingle();
  if (!vinculo) {
    const { data: recente } = await sb
      .from("usuario_gmail_oauth")
      .select("refresh_cipher, refresh_iv, scope")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    vinculo = recente ?? null;
  }
  if (!vinculo) return { erro: "Nenhuma conta Google conectada (Configurações > Integração Gmail)." };
  if (!String(vinculo.scope ?? "").includes("drive.readonly")) {
    return {
      erro: "A conexão Google não tem acesso ao Drive — reconectar em Configurações > Integração Gmail.",
    };
  }
  try {
    const refresh = await decryptSecret(vinculo.refresh_cipher, vinculo.refresh_iv);
    const token = await obterAccessTokenGoogle(refresh, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
    return { token };
  } catch (err) {
    return { erro: `Falha ao renovar acesso Google: ${err instanceof Error ? err.message : err}` };
  }
}

// --- IA (integração da Naira, mesma regra do inss-email-processor) ----------
let iaCache: { integ: IntegracaoIA; apiKey: string } | null | undefined;
async function classificarComIA(
  sb: SupabaseClient,
  nairaId: string | null,
  arquivo: { nome: string; mime: string; bytes: Uint8Array },
  tiposValidos: Set<string>,
): Promise<string | null> {
  if (!nairaId) return null;
  if (iaCache === undefined) {
    const r = await carregarIntegracao(sb, nairaId);
    if (!r.ok) {
      console.warn("[intake] IA nao configurada; classificacao fica so na heuristica:", r.error);
      iaCache = null;
    } else {
      iaCache = { integ: r.integ, apiKey: await decryptSecret(r.integ.api_key_cipher, r.integ.api_key_iv) };
    }
  }
  if (!iaCache) return null;
  try {
    let b64 = "";
    const chunk = 0x8000;
    for (let i = 0; i < arquivo.bytes.length; i += chunk) {
      b64 += String.fromCharCode(...arquivo.bytes.subarray(i, i + chunk));
    }
    b64 = btoa(b64);
    const anexo: Attachment = {
      kind: arquivo.mime === "application/pdf" ? "pdf" : "image",
      mediaType: arquivo.mime,
      base64: b64,
      name: arquivo.nome,
    };
    const res = await chatWith(iaCache.integ.provider, iaCache.apiKey, iaCache.integ.modelo, {
      system: PROMPT_CLASSIFICACAO,
      tools: [],
      maxTokens: 200,
      messages: [{ role: "user", content: `Arquivo: ${arquivo.nome}` }],
      attachments: [anexo],
    });
    const obj = extrairJson(res.text || "") as { tipo?: string } | null;
    const tipo = obj?.tipo?.trim();
    return tipo && tiposValidos.has(tipo) && tipo !== "outro" ? tipo : null;
  } catch (err) {
    console.warn("[intake] IA falhou pra", arquivo.nome, err);
    return null;
  }
}

// --- Processamento de um card ------------------------------------------------
interface ResultadoCard {
  card: TrelloCard;
  status: "concluido" | "pendente" | "erro";
  motivo: string | null;
  clienteId: string | null;
  casoId: string | null;
  docs: number;
  docsIa: number;
  avisos: Array<string>;
}

async function processarCard(
  sb: SupabaseClient,
  card: TrelloCard,
  ctx: {
    nomesBeneficio: Set<string>;
    tiposDocumento: Set<string>;
    nairaId: string | null;
    driveToken: string | null;
    driveErro: string | null;
    iaRestante: { n: number };
  },
): Promise<ResultadoCard> {
  const base: ResultadoCard = {
    card,
    status: "erro",
    motivo: null,
    clienteId: null,
    casoId: null,
    docs: 0,
    docsIa: 0,
    avisos: [],
  };

  const urls = (card.attachments ?? []).map((a) => a.url ?? "");
  const p = parsearCard(card.name, card.desc, urls);

  if (!p.nome || p.nome.length < 3) {
    return { ...base, status: "pendente", motivo: "Card sem nome de cliente no título." };
  }
  if (!p.cpf) {
    return { ...base, status: "pendente", motivo: "CPF não encontrado na descrição do card." };
  }

  // Cliente já existe? Vira pendência (mesmo comportamento da tela de criação:
  // não cria caso em cima de cadastro existente sem um humano olhar).
  const { data: existente, error: buscaErr } = await sb
    .from("clientes")
    .select("id, nome")
    .eq("cpf", p.cpf)
    .maybeSingle();
  if (buscaErr) return { ...base, motivo: `Busca de cliente falhou: ${buscaErr.message}` };
  if (existente) {
    return {
      ...base,
      status: "pendente",
      clienteId: existente.id as string,
      motivo: `Cliente já cadastrado (${existente.nome}). Conferir se é novo caso do mesmo cliente.`,
    };
  }

  // Se o card tem pasta do Drive mas não temos acesso ao Drive, não criamos
  // nada: fica como erro e a próxima rodada (pós-reautorização) tenta de novo.
  if (p.driveFolderId && !ctx.driveToken) {
    return { ...base, motivo: ctx.driveErro ?? "Sem acesso ao Google Drive." };
  }

  // --- Cliente ---------------------------------------------------------------
  const { data: clienteRow, error: cliErr } = await sb
    .from("clientes")
    .insert({
      nome: p.nome,
      cpf: p.cpf,
      telefone: formatarTelefone(p.celular),
      endereco: p.cidade && p.estado ? `${p.cidade}/${p.estado}` : null,
      created_by: PARCEIRO_ID, // service role: trigger de auth.uid() não preenche
    })
    .select("id")
    .single();
  if (cliErr) {
    // 23505 = corrida com outro cadastro do mesmo CPF entre a busca e o insert.
    if (cliErr.code === "23505") {
      return { ...base, status: "pendente", motivo: "Cliente já cadastrado (CPF duplicado)." };
    }
    return { ...base, motivo: `Insert de cliente falhou: ${cliErr.message}` };
  }
  const clienteId = clienteRow.id as string;

  // Daqui em diante já existe cliente: qualquer falha vira 'pendente' (nunca
  // 'erro'), senão a retentativa da próxima rodada duplicaria o cadastro.
  try {
    if (p.senhaMeuInss) {
      const { error: senhaErr } = await sb.rpc("set_senha_meu_inss_sistema", {
        p_cliente_id: clienteId,
        p_senha: p.senhaMeuInss,
        p_autor: PARCEIRO_ID,
      });
      if (senhaErr) base.avisos.push(`Senha do Meu INSS não gravada: ${senhaErr.message}`);
    } else {
      base.avisos.push("Card sem senha do Meu INSS.");
    }

    // --- Caso ----------------------------------------------------------------
    const observacoes =
      `Importado do Trello em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} — ${card.shortUrl}\n\n` +
      (p.relato || "(card sem relato)");
    const { data: casoRow, error: casoErr } = await sb
      .from("casos")
      .insert({
        cliente_id: clienteId,
        parceiro_id: PARCEIRO_ID,
        tipo_beneficio: mapearBeneficio(card.labels, ctx.nomesBeneficio),
        fase: "analise",
        status: "em_analise",
        observacoes,
      })
      .select("id")
      .single();
    if (casoErr) {
      return {
        ...base,
        status: "pendente",
        clienteId,
        motivo: `Cliente criado, mas o caso falhou: ${casoErr.message}`,
      };
    }
    const casoId = casoRow.id as string;

    // --- Documentos ----------------------------------------------------------
    // Fila: arquivos do Drive + anexos hospedados no Trello (o robô antigo
    // ignorava estes últimos).
    type ItemDoc = {
      nome: string;
      mime: string;
      caminho: string | null;
      gdriveId: string | null;
      baixar: () => Promise<Uint8Array>;
      bytesDeclarados: number;
    };
    const fila: Array<ItemDoc> = [];

    if (p.driveFolderId && ctx.driveToken) {
      let doDrive: Array<DriveArquivo> = [];
      try {
        doDrive = await listarArquivosPasta(ctx.driveToken, p.driveFolderId);
      } catch (err) {
        base.avisos.push(`Pasta do Drive inacessível: ${err instanceof Error ? err.message : err}`);
      }
      for (const f of doDrive) {
        fila.push({
          nome: f.name,
          mime: f.mimeType,
          caminho: f.caminho.includes("/") ? f.caminho.slice(0, f.caminho.lastIndexOf("/")) : null,
          gdriveId: f.id,
          baixar: () => baixarArquivo(ctx.driveToken!, f.id),
          bytesDeclarados: f.size,
        });
      }
    } else if (!p.driveFolderId) {
      base.avisos.push("Card sem link de pasta do Drive.");
    }

    for (const a of card.attachments ?? []) {
      const url = a.url ?? "";
      if (!url.includes("trello.com")) continue; // link externo que não é arquivo
      fila.push({
        nome: a.name || "anexo",
        mime: a.mimeType || "application/octet-stream",
        caminho: null,
        gdriveId: null,
        baixar: () => baixarAnexoTrello(url),
        bytesDeclarados: a.bytes ?? 0,
      });
    }

    if (fila.length > MAX_DOCS_POR_CARD) {
      base.avisos.push(`Card com ${fila.length} arquivos; importados os ${MAX_DOCS_POR_CARD} primeiros.`);
      fila.length = MAX_DOCS_POR_CARD;
    }

    for (const item of fila) {
      try {
        if (item.bytesDeclarados > MAX_ARQUIVO_BYTES) {
          base.avisos.push(`${item.nome}: acima de 50 MB, não importado.`);
          continue;
        }
        const bytes = await item.baixar();
        if (bytes.length > MAX_ARQUIVO_BYTES) {
          base.avisos.push(`${item.nome}: acima de 50 MB, não importado.`);
          continue;
        }

        let tipo = inferirTipoPorNome(item.nome);
        if (!ctx.tiposDocumento.has(tipo)) tipo = "outro";
        if (
          tipo === "outro" &&
          ctx.iaRestante.n > 0 &&
          IA_MIMES.has(item.mime) &&
          bytes.length <= MAX_IA_BYTES
        ) {
          ctx.iaRestante.n -= 1;
          const daIa = await classificarComIA(
            sb,
            ctx.nairaId,
            { nome: item.nome, mime: item.mime, bytes },
            ctx.tiposDocumento,
          );
          if (daIa) {
            tipo = daIa;
            base.docsIa += 1;
          }
        }

        const storagePath = `${casoId}/${Date.now()}_${sanitizeFileName(item.nome)}`;
        const up = await sb.storage.from("documentos").upload(storagePath, bytes, {
          contentType: item.mime,
        });
        if (up.error) {
          base.avisos.push(`${item.nome}: upload falhou (${up.error.message}).`);
          continue;
        }
        const { error: docErr } = await sb.from("documentos").insert({
          caso_id: casoId,
          tipo,
          tipo_personalizado: null,
          nome_arquivo: item.nome,
          storage_path: storagePath,
          tamanho_bytes: bytes.length,
          uploaded_by: PARCEIRO_ID,
          visivel_parceiro: true,
          gdrive_file_id: item.gdriveId,
          pasta_relativa: item.caminho,
        });
        if (docErr) {
          base.avisos.push(`${item.nome}: registro falhou (${docErr.message}).`);
          await sb.storage.from("documentos").remove([storagePath]);
          continue;
        }
        base.docs += 1;
      } catch (err) {
        base.avisos.push(`${item.nome}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { ...base, status: "concluido", clienteId, casoId, motivo: null };
  } catch (err) {
    return {
      ...base,
      status: "pendente",
      clienteId,
      motivo: `Cliente criado, mas o restante falhou: ${err instanceof Error ? err.message : err}`,
    };
  }
}

// --- Relatório ---------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function montarHtmlRelatorio(resultados: Array<ResultadoCard>, restantes: number): string {
  const bloco = (titulo: string, itens: Array<ResultadoCard>, cor: string) => {
    if (!itens.length) return "";
    const linhas = itens
      .map((r) => {
        const extras = [
          r.motivo ? esc(r.motivo) : "",
          r.docs ? `${r.docs} documento(s) importado(s)${r.docsIa ? ` (${r.docsIa} via IA)` : ""}` : "",
          ...r.avisos.map(esc),
        ]
          .filter(Boolean)
          .map((t) => `<div style="color:#555;font-size:13px">• ${t}</div>`)
          .join("");
        const link = r.casoId
          ? ` — <a href="${APP_URL}/casos/${r.casoId}">abrir caso</a>`
          : ` — <a href="${esc(r.card.shortUrl)}">card no Trello</a>`;
        return `<li style="margin-bottom:10px"><strong>${esc(r.card.name)}</strong>${link}${extras}</li>`;
      })
      .join("");
    return `<h3 style="color:${cor};margin:18px 0 6px">${titulo} (${itens.length})</h3><ul style="padding-left:18px;margin:0">${linhas}</ul>`;
  };

  const ok = resultados.filter((r) => r.status === "concluido");
  const pend = resultados.filter((r) => r.status === "pendente");
  const erro = resultados.filter((r) => r.status === "erro");

  return `<div style="font-family:Arial,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">Intake Trello — clientes do André</h2>
    <p style="color:#555;margin:0 0 12px">Rodada de ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
    ${bloco("Importados", ok, "#2e7d4f")}
    ${bloco("Pendências (precisam de alguém)", pend, "#b27a18")}
    ${bloco("Erros (serão retentados)", erro, "#b3372f")}
    ${restantes > 0 ? `<p style="color:#555">Mais ${restantes} card(s) na lista ficam pra próxima rodada.</p>` : ""}
  </div>`;
}

// --- Handler -----------------------------------------------------------------
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }
  if (!TRELLO_API_KEY || !TRELLO_TOKEN) {
    return new Response(JSON.stringify({ error: "TRELLO_API_KEY/TRELLO_TOKEN ausentes" }), { status: 500 });
  }

  let body: { dry_run?: boolean; para?: string | Array<string>; sempre?: boolean; max_cards?: number } = {};
  try {
    body = await req.json();
  } catch (_) { /* body vazio ok */ }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const cards = await buscarCardsDaLista();

  // Filtra os que já têm run que não deve repetir.
  const { data: runs } = await sb
    .from("intake_trello_runs")
    .select("card_id, status")
    .in("card_id", cards.map((c) => c.id));
  const naoRepetir = new Set(
    (runs ?? []).filter((r) => r.status !== "erro").map((r) => r.card_id as string),
  );
  const novos = cards.filter((c) => !naoRepetir.has(c.id));

  if (body.dry_run) {
    return new Response(
      JSON.stringify({
        dry_run: true,
        na_lista: cards.length,
        a_processar: novos.map((c) => {
          const p = parsearCard(c.name, c.desc, (c.attachments ?? []).map((a) => a.url ?? ""));
          return {
            card: c.name,
            nome: p.nome,
            cpf_ok: !!p.cpf,
            tem_senha: !!p.senhaMeuInss,
            tem_drive: !!p.driveFolderId,
            anexos_trello: (c.attachments ?? []).filter((a) => (a.url ?? "").includes("trello.com")).length,
          };
        }),
      }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const maxCards = Math.min(body.max_cards ?? MAX_CARDS_POR_RODADA, 20);
  const lote = novos.slice(0, maxCards);
  const restantes = novos.length - lote.length;

  if (!lote.length && !body.sempre) {
    return new Response(JSON.stringify({ processados: 0, na_lista: cards.length }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Contexto da rodada
  const { data: tiposBen } = await sb.from("tipos_beneficio").select("nome").eq("ativo", true);
  const nomesBeneficio = new Set((tiposBen ?? []).map((t) => t.nome as string));
  // Valores do enum tipo_documento (migration_intake_trello.sql). A lista fica
  // aqui em vez de consultar pg_enum: um tipo fora dela só faria o documento
  // cair em "outro", nunca quebrar o insert.
  const tiposDocumento = new Set<string>([
    "cnis", "cnis_resumido", "rg_cpf", "comprovante_residencia", "ctps", "holerite", "ppp",
    "laudo_medico", "laudo_inss", "ltcat", "pgr_ppra", "atestado_medico", "cat", "carne_gps",
    "ctc", "carta_concessao_inss", "hiscre", "certidao_casamento", "certidao_obito",
    "certidao_nascimento", "declaracao_uniao_estavel", "declaracao_atividade_rural",
    "procuracao", "substabelecimento", "contrato_honorarios", "declaracao_hipossuficiencia",
    "declaracao_ausencia_duplicidade", "termo_representacao", "autodeclaracao_veracidade",
    "termo_renuncia_teto", "termo_responsabilidade", "cnpj_empregadora", "outro",
  ]);

  const { data: naira } = await sb
    .from("usuarios")
    .select("id")
    .eq("email", NAIRA_EMAIL)
    .eq("tipo", "interno")
    .maybeSingle();

  const drive = await obterAccessTokenDrive(sb);
  const ctx = {
    nomesBeneficio,
    tiposDocumento,
    nairaId: (naira?.id as string | undefined) ?? null,
    driveToken: "token" in drive ? drive.token : null,
    driveErro: "erro" in drive ? drive.erro : null,
    iaRestante: { n: MAX_IA_POR_RODADA },
  };

  const resultados: Array<ResultadoCard> = [];
  for (const card of lote) {
    let r: ResultadoCard;
    try {
      r = await processarCard(sb, card, ctx);
    } catch (err) {
      r = {
        card,
        status: "erro",
        motivo: err instanceof Error ? err.message : String(err),
        clienteId: null,
        casoId: null,
        docs: 0,
        docsIa: 0,
        avisos: [],
      };
    }

    const { error: runErr } = await sb.from("intake_trello_runs").upsert({
      card_id: card.id,
      card_nome: card.name,
      card_url: card.shortUrl,
      status: r.status,
      motivo: r.motivo,
      cliente_id: r.clienteId,
      caso_id: r.casoId,
      docs_importados: r.docs,
      docs_classificados_ia: r.docsIa,
      detalhes: { avisos: r.avisos },
      atualizado_em: new Date().toISOString(),
    });
    if (runErr) console.error("[intake] gravar run falhou:", runErr);

    // Sino: um aviso por cliente importado (escritório todo).
    if (r.status === "concluido") {
      const { error: notifErr } = await sb.from("notificacoes").insert({
        tipo: "caso",
        titulo: `Cliente novo do André (Trello): ${extrairNome(card.name)}`,
        descricao: `${r.docs} documento(s) importado(s). Conferir tipos sugeridos e dados do cadastro.`,
        caso_id: r.casoId,
        cliente_id: r.clienteId,
        destinatario_id: null,
      });
      if (notifErr && notifErr.code !== "23505") console.error("[intake] notificacao:", notifErr);
    }
    resultados.push(r);
  }

  // Relatório por e-mail (default: só Naira, como o digest).
  const houveAlgo = resultados.length > 0;
  if (houveAlgo && RESEND_API_KEY) {
    const para = body.para ?? NAIRA_EMAIL;
    const destinatarios = Array.isArray(para) ? para : [para];
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: destinatarios,
        subject: `Intake Trello: ${resultados.filter((r) => r.status === "concluido").length} importado(s), ${resultados.filter((r) => r.status !== "concluido").length} pendência(s)`,
        html: montarHtmlRelatorio(resultados, restantes),
      }),
    });
    if (!resp.ok) console.error("[intake] Resend falhou:", resp.status, await resp.text());
  }

  return new Response(
    JSON.stringify({
      processados: resultados.length,
      concluidos: resultados.filter((r) => r.status === "concluido").length,
      pendentes: resultados.filter((r) => r.status === "pendente").length,
      erros: resultados.filter((r) => r.status === "erro").length,
      restantes,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
