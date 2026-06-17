#!/usr/bin/env node
// msc-wa.mjs — gestão da instância WhatsApp (Evolution API).
//
// Uso:
//   node scripts/msc-wa.mjs state            # estado da conexão
//   node scripts/msc-wa.mjs webhook-status   # config atual do webhook
//   node scripts/msc-wa.mjs webhook-on       # liga entrada (MESSAGES_UPSERT)
//   node scripts/msc-wa.mjs webhook-off      # desliga entrada (para de gravar)
//   node scripts/msc-wa.mjs connect          # gera pairing code + QR (_qr.png)
//   node scripts/msc-wa.mjs logout           # desconecta (p/ re-parear)
//
// Credenciais/consts: lê do .env.local (gitignored).
//
// DE PROPÓSITO este script NÃO envia mensagens (sendText/sendList/sendButtons).
// Mandar mensagem real continua exigindo aprovação (via curl manual).

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.EVOLUTION_BASE_URL || "https://evo.nairavian-n8n.de";
const INSTANCE = process.env.EVOLUTION_INSTANCE || "mara";
const PHONE = process.env.EVOLUTION_PHONE || "34613761609";
const FN_URL =
  "https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/whatsapp-inbound";

function readEnvLocal(key) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const KEY = readEnvLocal("EVOLUTION_API_KEY");
const INBOUND_TOKEN = readEnvLocal("WHATSAPP_INBOUND_TOKEN");

async function api(method, p, body) {
  const resp = await fetch(`${BASE}${p}`, {
    method,
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: resp.status, data };
}

function webhookBody(enabled) {
  return {
    webhook: {
      enabled,
      url: `${FN_URL}?token=${INBOUND_TOKEN}`,
      events: enabled ? ["MESSAGES_UPSERT"] : [],
      webhookByEvents: false,
      webhookBase64: false,
    },
  };
}

async function main() {
  if (!KEY) {
    console.error("ERRO: EVOLUTION_API_KEY não encontrado no .env.local");
    process.exit(1);
  }
  const cmd = process.argv[2];
  switch (cmd) {
    case "state": {
      const r = await api("GET", `/instance/connectionState/${INSTANCE}`);
      console.log(JSON.stringify(r.data));
      break;
    }
    case "webhook-status": {
      const r = await api("GET", `/webhook/find/${INSTANCE}`);
      const d = r.data || {};
      console.log(JSON.stringify({ enabled: d.enabled, events: d.events }));
      break;
    }
    case "webhook-on": {
      if (!INBOUND_TOKEN) {
        console.error("ERRO: WHATSAPP_INBOUND_TOKEN não encontrado no .env.local");
        process.exit(1);
      }
      const r = await api("POST", `/webhook/set/${INSTANCE}`, webhookBody(true));
      console.log(`webhook-on -> HTTP ${r.status} | enabled=${r.data?.enabled} events=${JSON.stringify(r.data?.events)}`);
      break;
    }
    case "webhook-off": {
      const r = await api("POST", `/webhook/set/${INSTANCE}`, webhookBody(false));
      console.log(`webhook-off -> HTTP ${r.status} | enabled=${r.data?.enabled}`);
      break;
    }
    case "logout": {
      const r = await api("DELETE", `/instance/logout/${INSTANCE}`);
      console.log(`logout -> HTTP ${r.status} | ${JSON.stringify(r.data)}`);
      break;
    }
    case "restart": {
      const r = await api("POST", `/instance/restart/${INSTANCE}`);
      console.log(`restart -> HTTP ${r.status} | ${JSON.stringify(r.data)}`);
      break;
    }
    case "connect": {
      const r = await api("GET", `/instance/connect/${INSTANCE}?number=${PHONE}`);
      const pc = r.data?.pairingCode || r.data?.code || "";
      const pretty = pc.length === 8 ? `${pc.slice(0, 4)}-${pc.slice(4)}` : pc;
      console.log(`pairingCode: ${pretty}`);
      const b64 = (r.data?.base64 || "").replace(/^data:image\/\w+;base64,/, "");
      if (b64) {
        fs.writeFileSync("_qr.png", Buffer.from(b64, "base64"));
        console.log("QR salvo em _qr.png (abra/escaneie)");
      }
      break;
    }
    default:
      console.error(
        "comando inválido. use: state | webhook-status | webhook-on | webhook-off | connect | logout",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});
