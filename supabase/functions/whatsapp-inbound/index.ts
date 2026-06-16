// =============================================================================
// Edge Function: whatsapp-inbound  (WhatsApp — entrada / Fase 2)
//
// Recebe o webhook de ENTRADA do Evolution (parceiro mandou mensagem), roda um
// menu numerado com máquina de estados (whatsapp_sessoes) e executa a ação de
// "adicionar comentário". As RESPOSTAS são enfileiradas no MESMO outbox da
// Fase 1 (whatsapp_enqueue_text) — o poller n8n já ativo é quem entrega.
//
// Segurança:
//   - Protegida por TOKEN (env WHATSAPP_INBOUND_TOKEN) em ?token= ou header
//     x-inbound-token. Evolution não assina, então sem token => 401.
//   - Roda com service-role (fura RLS); a autorização é REIMPLEMENTADA no RPC
//     whatsapp_parceiro_add_comentario (parceiro só comenta no caso dele).
//   - Ignora fromMe, grupos (@g.us) e faz DEDUPE por data.key.id.
//
// Escopo Fase 2 (decidido 2026-05-31): menu principal + menu do caso +
// adicionar comentário. Ver/responder e documentos são Fase 3.
//
// Sempre responde 200 rápido (a entrega da resposta é assíncrona via outbox).
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_TOKEN = Deno.env.get("WHATSAPP_INBOUND_TOKEN") ?? "";
const EXPIRA_MIN = 30;

// Evolution — usado só na Fase 3 (baixar mídia que o parceiro envia).
const EVO_BASE = Deno.env.get("EVOLUTION_BASE_URL") ?? "https://evo.nairavian-n8n.de";
const EVO_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE") ?? "mara";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// Rótulos amigáveis dos enums (só exibição).
const STATUS_LABEL: Record<string, string> = {
  aguardando_documentos: "Aguardando documentos",
  em_analise: "Em análise",
  em_revisao: "Em revisão",
  em_andamento: "Em andamento",
  concluido_exito: "Concluído (com êxito)",
  concluido_sem_exito: "Concluído (sem êxito)",
  arquivado: "Arquivado",
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

const ok = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { "content-type": "application/json" },
});

function extractText(message: any): string | null {
  if (!message) return null;
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.ephemeralMessage?.message?.conversation ??
    message.ephemeralMessage?.message?.extendedTextMessage?.text ??
    null
  );
}

// Extrai só os dígitos de um JID (telefone), ignorando grupos.
function digitsFromJid(jid: unknown): string | null {
  if (typeof jid !== "string" || !jid) return null;
  if (jid.endsWith("@g.us")) return null;
  const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return d || null;
}
const isLid = (jid: unknown) => typeof jid === "string" && jid.endsWith("@lid");

// O WhatsApp pode entregar o remetente como "@lid" (identificador anônimo) em
// vez do telefone. O Baileys ainda manda o telefone REAL em campos paralelos
// (senderPn / remoteJidAlt / participantPn). Tentamos todos; se só sobrar o LID,
// devolvemos viaLid=true (a função loga o key cru p/ diagnóstico).
function extractRemetente(data: any): { telefone: string | null; viaLid: boolean } {
  const key = data?.key ?? {};
  const candidatos = [
    key.senderPn, key.participantPn, key.remoteJidAlt,
    data.senderPn, data.remoteJidAlt,
    !isLid(key.remoteJid) ? key.remoteJid : null,
    !isLid(key.participant) ? key.participant : null,
  ];
  for (const c of candidatos) {
    const d = digitsFromJid(c);
    if (d && d.length >= 8) return { telefone: d, viaLid: false };
  }
  return { telefone: digitsFromJid(key.remoteJid), viaLid: isLid(key.remoteJid) };
}

// --- mídia (Fase 3) ---------------------------------------------------------
// Desembrulha mensagens efêmeras/viewOnce p/ achar o conteúdo real.
function unwrapMsg(message: any): any {
  return message?.ephemeralMessage?.message
    ?? message?.viewOnceMessage?.message
    ?? message?.viewOnceMessageV2?.message
    ?? message?.documentWithCaptionMessage?.message
    ?? message;
}

// Detecta imagem/documento na entrada. Devolve null se for texto/outro.
function extractMedia(
  message: any,
): { kind: "image" | "document"; mimetype: string; fileName: string } | null {
  const m = unwrapMsg(message);
  if (!m) return null;
  if (m.imageMessage) {
    return {
      kind: "image",
      mimetype: m.imageMessage.mimetype ?? "image/jpeg",
      fileName: m.imageMessage.fileName ?? `foto_${Date.now()}.jpg`,
    };
  }
  if (m.documentMessage) {
    return {
      kind: "document",
      mimetype: m.documentMessage.mimetype ?? "application/octet-stream",
      fileName: m.documentMessage.fileName ?? m.documentMessage.title ?? `documento_${Date.now()}`,
    };
  }
  return null;
}

function sanitizeFileName(n: string): string {
  return (n || "arquivo")
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "arquivo";
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Baixa o binário da mídia via Evolution (webhookBase64 está OFF, então pedimos
// o base64 sob demanda). Retorna null em qualquer falha (a função trata).
async function baixarBase64(
  data: any,
): Promise<{ base64: string; mimetype?: string; fileName?: string } | null> {
  if (!EVOLUTION_API_KEY) {
    console.error("baixarBase64: EVOLUTION_API_KEY ausente");
    return null;
  }
  try {
    const resp = await fetch(
      `${EVO_BASE}/chat/getBase64FromMediaMessage/${EVO_INSTANCE}`,
      {
        method: "POST",
        headers: { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { key: data.key }, convertToMp4: false }),
      },
    );
    if (!resp.ok) {
      console.error("getBase64 HTTP", resp.status, (await resp.text()).slice(0, 300));
      return null;
    }
    const j = await resp.json();
    const base64 = j.base64 ?? j.media ?? null;
    if (!base64) return null;
    return { base64, mimetype: j.mimetype, fileName: j.fileName };
  } catch (e) {
    console.error("baixarBase64 erro:", (e as Error)?.message ?? e);
    return null;
  }
}

// --- textos do menu --------------------------------------------------------
// Primeiro nome só (mais pessoal e cabe melhor no balão).
const primeiroNome = (nome: string) => (nome || "").trim().split(/\s+/)[0] || "Dr(a).";

const menuPrincipal = (nome: string) =>
  `👋 Olá, Dr(a). *${primeiroNome(nome)}*!\n` +
  `Como posso ajudar?\n\n` +
  `*1* · 📁 Meus casos\n` +
  `*0* · 🚪 Sair\n\n` +
  `_Responda com o número da opção._`;

function listaCasosTexto(casos: { cliente: string; status: string }[]) {
  if (casos.length === 0)
    return `📭 Você não tem casos no momento.\n\n_Digite *menu* para voltar._`;
  const linhas = casos
    .map((c, i) => `*${i + 1}.* ${c.cliente} — _${statusLabel(c.status)}_`)
    .join("\n");
  return `📁 *Seus casos*\n\n${linhas}\n\n` +
    `_Responda com o número do caso, ou *0* para voltar._`;
}

const menuCaso = (cliente: string, status: string) =>
  `📌 *Caso de ${cliente}*\n` +
  `Status: _${statusLabel(status)}_\n\n` +
  `*1* · 💬 Adicionar comentário\n` +
  `*2* · 📎 Enviar documento\n` +
  `*0* · ◀️ Voltar`;

// --- persistência de sessão -------------------------------------------------
async function salvarSessao(
  telefone: string, parceiro_id: string, estado: string, contexto: unknown,
) {
  const expira = new Date(Date.now() + EXPIRA_MIN * 60_000).toISOString();
  await sb.from("whatsapp_sessoes").upsert({
    telefone, parceiro_id, estado, contexto,
    atualizado_em: new Date().toISOString(), expira_em: expira,
  });
}

async function responder(
  telefone: string, parceiro_id: string, texto: string,
  caso_id: string | null = null,
) {
  await sb.rpc("whatsapp_enqueue_text", {
    p_telefone: telefone, p_tipo: "menu", p_texto: texto,
    p_parceiro_id: parceiro_id, p_caso_id: caso_id,
  });
  await sb.from("whatsapp_mensagens").insert({
    telefone, direcao: "out", tipo: "menu", conteudo: texto, parceiro_id,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // --- token ---
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("x-inbound-token") ?? "";
  if (!INBOUND_TOKEN || token !== INBOUND_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return ok(); }

  // Evolution: { event, instance, data:{ key, message, messageType } }
  const data = body?.data ?? body;
  const key = data?.key;
  if (!key) return ok();
  if (key.fromMe === true) return ok();

  const jid: string = key.remoteJid ?? "";
  if (!jid || jid.endsWith("@g.us")) return ok(); // ignora grupos
  // `ident` = identificador de ENTRADA. Pode ser o telefone real OU um LID
  // anônimo (o WhatsApp não revela o telefone na entrada). Usamos `ident` só p/
  // log/dedupe e p/ resolver o parceiro; as RESPOSTAS vão sempre p/ o telefone
  // cadastrado (ver `telefone` logo abaixo), pois NÃO é possível enviar p/ um @lid.
  const { telefone: ident, viaLid } = extractRemetente(data);
  if (!ident) return ok();
  const msgId: string | null = key.id ?? null;
  const texto = extractText(data.message);

  // --- DEDUPE: insere log de entrada; conflito (mesmo id) => já processado ---
  const { error: dupErr } = await sb.from("whatsapp_mensagens").insert({
    telefone: ident, direcao: "in", tipo: data.messageType ?? "texto",
    conteudo: texto, evolution_message_id: msgId,
  });
  if (dupErr && (dupErr as any).code === "23505") return ok(); // duplicado

  // --- resolve parceiro (por LID via whatsapp_lid_map, ou por telefone) ---
  const { data: pr } = await sb.rpc("whatsapp_resolve_parceiro", {
    p_ident: ident, p_via_lid: viaLid,
  });
  const parceiro = Array.isArray(pr) ? pr[0] : pr;
  if (!parceiro) {
    // ONBOARDING POR CÓDIGO: a entrada vem por LID (não casa por telefone), mas
    // o remetente pode estar respondendo um CÓDIGO de ativação (enviado antes
    // pelo interno, via whatsapp_gerar_codigo_ativacao, pro telefone dele).
    // Se o código for válido, cria o vínculo LID->parceiro e já entra no menu.
    const cod = (texto ?? "").trim();
    if (viaLid && /^\d{4}$/.test(cod)) {
      const { data: linked } = await sb.rpc("whatsapp_consumir_codigo", {
        p_codigo: cod, p_lid: ident,
      });
      const novo = Array.isArray(linked) ? linked[0] : linked;
      if (novo && novo.parceiro_id) {
        const telNovo: string = novo.telefone ?? ident;
        const nmNovo: string = novo.nome ?? "Dr(a).";
        await responder(telNovo, novo.parceiro_id,
          `✅ *WhatsApp ativado!*\n\n` + menuPrincipal(nmNovo));
        await salvarSessao(telNovo, novo.parceiro_id, "menu", {});
        return ok();
      }
    }
    // Não reconhecido (e não era código válido). Só conseguimos responder se a
    // ENTRADA trouxe um telefone real (não-LID); a um @lid não há como entregar.
    if (!viaLid) {
      await sb.rpc("whatsapp_enqueue_text", {
        p_telefone: ident, p_tipo: "desconhecido",
        p_texto: "Não reconhecemos este número. Por favor, fale com o escritório.",
        p_parceiro_id: null, p_caso_id: null,
      });
    }
    return ok();
  }
  const parceiroId: string = parceiro.parceiro_id;
  const nome: string = parceiro.nome ?? "Dr(a).";
  // Destino das respostas = telefone cadastrado do parceiro (entregável).
  const telefone: string = parceiro.telefone ?? ident;

  // --- carrega sessão (e aplica expiração de 30 min) ---
  const { data: sess } = await sb.from("whatsapp_sessoes")
    .select("*").eq("telefone", telefone).maybeSingle();
  let estado = "menu";
  let ctx: any = {};
  if (sess) {
    const expirada = sess.expira_em && new Date(sess.expira_em) < new Date();
    if (!expirada) { estado = sess.estado; ctx = sess.contexto ?? {}; }
  }

  const entrada = (texto ?? "").trim();
  const lower = entrada.toLowerCase();
  const media = extractMedia(data.message);  // imagem/PDF na entrada (Fase 3)

  // --- comando global: "menu" reinicia ---
  if (lower === "menu") {
    await responder(telefone, parceiroId, menuPrincipal(nome));
    await salvarSessao(telefone, parceiroId, "menu", {});
    return ok();
  }

  // ===================== MÁQUINA DE ESTADOS =====================
  if (estado === "menu") {
    if (entrada === "1") {
      const { data: casos } = await sb.from("casos")
        .select("id, status, clientes(nome)")
        .eq("parceiro_id", parceiroId)
        .order("created_at", { ascending: false });
      const lista = (casos ?? []).map((c: any) => ({
        id: c.id, cliente: c.clientes?.nome ?? "Cliente", status: c.status,
      }));
      await responder(telefone, parceiroId, listaCasosTexto(lista));
      await salvarSessao(telefone, parceiroId, lista.length ? "escolhe_caso" : "menu", { casos: lista });
    } else if (entrada === "0") {
      await responder(telefone, parceiroId,
        `👋 Até logo, Dr(a). *${primeiroNome(nome)}*!\n_Digite *menu* quando precisar._`);
      await salvarSessao(telefone, parceiroId, "menu", {});
    } else {
      await responder(telefone, parceiroId, menuPrincipal(nome));
      await salvarSessao(telefone, parceiroId, "menu", {});
    }
    return ok();
  }

  if (estado === "escolhe_caso") {
    const casos: any[] = ctx.casos ?? [];
    if (entrada === "0") {
      await responder(telefone, parceiroId, menuPrincipal(nome));
      await salvarSessao(telefone, parceiroId, "menu", {});
      return ok();
    }
    const n = parseInt(entrada, 10);
    if (Number.isInteger(n) && n >= 1 && n <= casos.length) {
      const caso = casos[n - 1];
      await responder(telefone, parceiroId, menuCaso(caso.cliente, caso.status), caso.id);
      await salvarSessao(telefone, parceiroId, "menu_caso", { caso });
    } else {
      await responder(telefone, parceiroId, "⚠️ Opção inválida.\n\n" + listaCasosTexto(casos));
      // mantém estado escolhe_caso
      await salvarSessao(telefone, parceiroId, "escolhe_caso", { casos });
    }
    return ok();
  }

  if (estado === "menu_caso") {
    const caso = ctx.caso;
    if (!caso) {
      await responder(telefone, parceiroId, menuPrincipal(nome));
      await salvarSessao(telefone, parceiroId, "menu", {});
      return ok();
    }
    if (entrada === "1") {
      await responder(telefone, parceiroId,
        `💬 Escreva seu comentário para o caso de *${caso.cliente}*:\n\n_Envie o texto, ou *0* para cancelar._`, caso.id);
      await salvarSessao(telefone, parceiroId, "comentar", { caso });
    } else if (entrada === "2") {
      await responder(telefone, parceiroId,
        `📎 Envie a *foto* ou o *PDF* do documento para o caso de *${caso.cliente}*.\n\n_Ou *0* para cancelar._`, caso.id);
      await salvarSessao(telefone, parceiroId, "enviar_documento", { caso });
    } else if (entrada === "0") {
      await responder(telefone, parceiroId, menuPrincipal(nome));
      await salvarSessao(telefone, parceiroId, "menu", {});
    } else {
      await responder(telefone, parceiroId, "⚠️ Opção inválida.\n\n" + menuCaso(caso.cliente, caso.status), caso.id);
      await salvarSessao(telefone, parceiroId, "menu_caso", { caso });
    }
    return ok();
  }

  if (estado === "comentar") {
    const caso = ctx.caso;
    if (!caso) {
      await responder(telefone, parceiroId, menuPrincipal(nome));
      await salvarSessao(telefone, parceiroId, "menu", {});
      return ok();
    }
    if (entrada === "0") {
      await responder(telefone, parceiroId, "🚫 Comentário cancelado.\n\n" + menuCaso(caso.cliente, caso.status), caso.id);
      await salvarSessao(telefone, parceiroId, "menu_caso", { caso });
      return ok();
    }
    if (entrada === "") {
      await responder(telefone, parceiroId, "⚠️ Mensagem vazia. Escreva o comentário ou *0* para cancelar.", caso.id);
      await salvarSessao(telefone, parceiroId, "comentar", { caso });
      return ok();
    }
    const { data: novoComentarioId, error: addErr } = await sb.rpc(
      "whatsapp_parceiro_add_comentario",
      { p_parceiro_id: parceiroId, p_caso_id: caso.id, p_texto: entrada },
    );
    if (addErr) {
      await responder(telefone, parceiroId,
        "❌ Não consegui registrar o comentário. Tente de novo ou digite *menu*.", caso.id);
      await salvarSessao(telefone, parceiroId, "comentar", { caso });
    } else {
      await responder(telefone, parceiroId,
        `✅ Comentário registrado no caso de *${caso.cliente}*!\n\n` + menuCaso(caso.cliente, caso.status), caso.id);
      await salvarSessao(telefone, parceiroId, "menu_caso", { caso });
      // Avisa a equipe INTERNA por email — reusa a MESMA Edge Function que o app
      // dispara quando um parceiro comenta pela UI (notify-novo-comentario manda
      // pra todos os internos ativos). Fire-and-forget protegido: um erro aqui
      // NUNCA derruba o registro do comentário nem a resposta ao parceiro.
      if (novoComentarioId) {
        try {
          await sb.functions.invoke("notify-novo-comentario", {
            body: { comentario_id: novoComentarioId },
          });
        } catch (e) {
          console.error("notify-novo-comentario falhou:", (e as Error)?.message ?? e);
        }
      }
    }
    return ok();
  }

  if (estado === "enviar_documento") {
    const caso = ctx.caso;
    if (!caso) {
      await responder(telefone, parceiroId, menuPrincipal(nome));
      await salvarSessao(telefone, parceiroId, "menu", {});
      return ok();
    }
    if (entrada === "0") {
      await responder(telefone, parceiroId, "🚫 Envio cancelado.\n\n" + menuCaso(caso.cliente, caso.status), caso.id);
      await salvarSessao(telefone, parceiroId, "menu_caso", { caso });
      return ok();
    }
    if (!media) {
      await responder(telefone, parceiroId,
        "⚠️ Não recebi um arquivo. Envie a *foto* ou o *PDF*, ou *0* para cancelar.", caso.id);
      await salvarSessao(telefone, parceiroId, "enviar_documento", { caso });
      return ok();
    }
    // baixa o binário do Evolution
    const baixado = await baixarBase64(data);
    if (!baixado) {
      await responder(telefone, parceiroId,
        "❌ Não consegui baixar o arquivo. Tente enviar de novo, ou *0* para cancelar.", caso.id);
      await salvarSessao(telefone, parceiroId, "enviar_documento", { caso });
      return ok();
    }
    const bytes = base64ToBytes(baixado.base64);
    const nomeExib = baixado.fileName ?? media.fileName;
    const path = `${caso.id}/${Date.now()}_${sanitizeFileName(nomeExib)}`;
    const { error: upErr } = await sb.storage.from("documentos").upload(path, bytes, {
      contentType: baixado.mimetype ?? media.mimetype,
      upsert: false,
    });
    if (upErr) {
      console.error("upload storage err:", (upErr as Error)?.message ?? upErr);
      await responder(telefone, parceiroId,
        "❌ Não consegui salvar o arquivo. Tente de novo, ou *0* para cancelar.", caso.id);
      await salvarSessao(telefone, parceiroId, "enviar_documento", { caso });
      return ok();
    }
    const { error: docErr } = await sb.rpc("whatsapp_parceiro_add_documento", {
      p_parceiro_id: parceiroId, p_caso_id: caso.id,
      p_nome_arquivo: nomeExib, p_storage_path: path, p_tamanho: bytes.length,
    });
    if (docErr) {
      console.error("add_documento err:", (docErr as Error)?.message ?? docErr);
      await sb.storage.from("documentos").remove([path]).catch(() => {}); // limpa órfão
      await responder(telefone, parceiroId,
        "❌ Não consegui anexar o documento. Tente de novo, ou *0* para cancelar.", caso.id);
      await salvarSessao(telefone, parceiroId, "enviar_documento", { caso });
      return ok();
    }
    await responder(telefone, parceiroId,
      `✅ Documento *${nomeExib}* anexado ao caso de *${caso.cliente}*!\n\n` + menuCaso(caso.cliente, caso.status), caso.id);
    await salvarSessao(telefone, parceiroId, "menu_caso", { caso });
    return ok();
  }

  // estado desconhecido -> reinicia
  await responder(telefone, parceiroId, menuPrincipal(nome));
  await salvarSessao(telefone, parceiroId, "menu", {});
  return ok();
});
