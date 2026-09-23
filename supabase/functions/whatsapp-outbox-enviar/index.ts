// whatsapp-outbox-enviar — drena a fila de saída do WhatsApp POR ESCRITÓRIO,
// sem n8n (decisão de 2026-09-23). Chamada pelo pg_cron (assinatura de
// sistema `cron:whatsapp-outbox`, migration_cron_whatsapp_outbox) ou manual.
//
//   1. whatsapp_claim_batch(limite) — lote 'pendente' → 'enviando' (+tentativa)
//   2. agrupa por escritorio_id; para cada um lê escritorio_integracoes
//      (tipo whatsapp, ativo): base_url, instance e a chave DECIFRADA aqui.
//      Escritório padrão sem linha própria cai nas variáveis de ambiente
//      antigas (EVOLUTION_*), como o whatsapp-inbound; os demais nunca.
//   3. POST {base}/message/sendText/{instance} { number, text } (ou sendMedia
//      quando há midia_url) com o header apikey do escritório.
//   4. whatsapp_mark_result(outbox_id, ok, http, erro) — backoff igual ao
//      antigo (1m/5m/30m/2h; 5ª falha → 'falhou').
//
// Sem integração configurada a linha falha com erro claro e entra no backoff:
// nunca cai na instância de outro escritório.
// Body opcional: { limite?: number, dry_run?: boolean }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { exigirSistema, fetchT } from "../_shared/auth.ts";
import { decryptSecret } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-msc-assinatura",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// legado do escritório padrão (mesmas variáveis do whatsapp-inbound)
const EVO_BASE = Deno.env.get("EVOLUTION_BASE_URL") ?? "";
const EVO_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE") ?? "";
const EVO_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";

interface Linha { outbox_id: string; escritorio_id: string | null; telefone: string; tipo: string; texto: string | null; midia_url: string | null }
interface Credencial { base: string; instance: string; key: string; origem: "escritorio" | "ambiente" }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const quem = await exigirSistema(req, "cron:whatsapp-outbox");
  if (quem instanceof Response) return quem;
  const admin = quem.admin;

  let body: { limite?: number; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* sem corpo */ }
  const limite = Math.min(Math.max(Number(body.limite) || 20, 1), 100);
  const dryRun = body.dry_run === true;

  const { data: lote, error: eLote } = await admin.rpc("whatsapp_claim_batch", { p_limit: limite });
  if (eLote) return json({ error: `claim: ${eLote.message}` }, 500);
  const linhas = (lote ?? []) as Linha[];

  const credenciais = new Map<string, Credencial | null>();
  async function credencialDe(escritorioId: string | null): Promise<Credencial | null> {
    const chave = escritorioId ?? "(sem escritório)";
    if (credenciais.has(chave)) return credenciais.get(chave)!;
    let cred: Credencial | null = null;
    if (escritorioId) {
      const { data, error } = await admin
        .from("escritorio_integracoes")
        .select("config, ativo, segredo_cipher, segredo_iv")
        .eq("escritorio_id", escritorioId)
        .eq("tipo", "whatsapp")
        .maybeSingle();
      if (error) throw new Error(`escritorio_integracoes: ${error.message}`);
      const cfg = (data?.config ?? {}) as { base_url?: string; instance?: string };
      if (data?.ativo && cfg.base_url && cfg.instance && data.segredo_cipher && data.segredo_iv) {
        cred = { base: cfg.base_url.replace(/\/+$/, ""), instance: cfg.instance, key: await decryptSecret(data.segredo_cipher, data.segredo_iv), origem: "escritorio" };
      } else if (EVO_BASE && EVO_INSTANCE && EVO_KEY) {
        const { data: esc } = await admin.from("escritorios").select("padrao_sistema").eq("id", escritorioId).maybeSingle();
        if (esc?.padrao_sistema) cred = { base: EVO_BASE.replace(/\/+$/, ""), instance: EVO_INSTANCE, key: EVO_KEY, origem: "ambiente" };
      }
    }
    credenciais.set(chave, cred);
    return cred;
  }

  const resultado = { processadas: linhas.length, enviadas: 0, falhas: 0, dry_run: dryRun, por_escritorio: {} as Record<string, { enviadas: number; falhas: number; origem?: string; erro?: string }> };
  for (const l of linhas) {
    const escKey = l.escritorio_id ?? "(sem escritório)";
    const acc = (resultado.por_escritorio[escKey] ??= { enviadas: 0, falhas: 0 });
    let ok = false, http: number | null = null, erro: string | null = null;
    try {
      const cred = await credencialDe(l.escritorio_id);
      if (!cred) {
        erro = "integração WhatsApp não configurada neste escritório";
      } else {
        acc.origem = cred.origem;
        if (dryRun) {
          ok = true;
        } else {
          const media = !!l.midia_url;
          const url = `${cred.base}/message/${media ? "sendMedia" : "sendText"}/${encodeURIComponent(cred.instance)}`;
          const payload = media
            ? { number: l.telefone, mediatype: /\.(png|jpe?g|webp)(\?|$)/i.test(l.midia_url!) ? "image" : "document", media: l.midia_url, caption: l.texto ?? "" }
            : { number: l.telefone, text: l.texto ?? "" };
          const r = await fetchT(url, { method: "POST", headers: { apikey: cred.key, "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs: 15_000 });
          http = r.status;
          ok = r.ok;
          if (!ok) erro = `HTTP ${r.status} ${(await r.text()).slice(0, 300)}`;
        }
      }
    } catch (e) {
      erro = String((e as Error)?.message ?? e).slice(0, 300);
    }
    if (dryRun && !ok && !erro) ok = true;
    if (!dryRun || !ok) {
      const { error: eMark } = await admin.rpc("whatsapp_mark_result", { p_outbox_id: l.outbox_id, p_ok: ok, p_http_status: http, p_erro: erro });
      if (eMark) console.error("mark_result", l.outbox_id, eMark.message);
    } else {
      // dry_run: devolve a linha para a fila sem contar tentativa a mais
      await admin.from("whatsapp_outbox").update({ status: "pendente" }).eq("id", l.outbox_id);
    }
    if (ok) { resultado.enviadas++; acc.enviadas++; } else { resultado.falhas++; acc.falhas++; if (erro) acc.erro = erro; }
  }
  return json(resultado);
});
