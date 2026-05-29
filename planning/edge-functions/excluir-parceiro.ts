// supabase/functions/excluir-parceiro/index.ts
//
// Exclui um parceiro do sistema, com cascade que preserva o historico
// dos casos/andamentos/documentos. Util pra apagar parceiros de teste
// ou desligar parceiros que sairam do escritorio.
//
// Estrategia de cascade:
//   - casos.parceiro_id = NULL      (caso fica como "cliente interno")
//   - andamentos.criado_por = NULL  (preserva timeline, perde autoria)
//   - documentos.uploaded_by = NULL (preserva docs, perde autoria)
//   - comentarios do parceiro: DELETE (cascade kills replies)
//   - usuarios: DELETE
//   - auth.users: DELETE via admin API
//
// Chamada do frontend:
//   await supabase.functions.invoke("excluir-parceiro", {
//     body: { usuario_id: "<uuid>", confirmar: true }
//   });
//
// Secrets:
//   - SUPABASE_URL (automatico)
//   - SUPABASE_SERVICE_ROLE_KEY (automatico)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  // ---------------------------------------------------------------------------
  // 1) Valida JWT do caller e que eh interno
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return jsonResponse({ error: "sem authorization header" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: userResp, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userResp.user) {
    return jsonResponse({ error: "jwt invalido" }, 401);
  }
  const callerId = userResp.user.id;

  const { data: caller } = await supabase
    .from("usuarios")
    .select("tipo")
    .eq("id", callerId)
    .maybeSingle();

  if (!caller || (caller as { tipo: string }).tipo !== "interno") {
    return jsonResponse(
      { error: "apenas usuarios internos podem excluir parceiros" },
      403,
    );
  }

  // ---------------------------------------------------------------------------
  // 2) Parse body
  // ---------------------------------------------------------------------------
  let body: { usuario_id?: string; confirmar?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  const usuarioId = String(body.usuario_id || "").trim();
  if (!usuarioId) {
    return jsonResponse({ error: "usuario_id obrigatorio" }, 400);
  }
  if (body.confirmar !== true) {
    return jsonResponse({ error: "confirmar=true obrigatorio" }, 400);
  }

  // Verifica que alvo eh parceiro
  const { data: alvo } = await supabase
    .from("usuarios")
    .select("id, nome, tipo")
    .eq("id", usuarioId)
    .maybeSingle();
  if (!alvo) {
    return jsonResponse({ error: "parceiro nao encontrado" }, 404);
  }
  if ((alvo as { tipo: string }).tipo !== "parceiro") {
    return jsonResponse(
      { error: "este endpoint so exclui parceiros" },
      400,
    );
  }

  // ---------------------------------------------------------------------------
  // 3) Cascade preservando historico
  // ---------------------------------------------------------------------------
  const erros: string[] = [];

  // 3.1) Desvincula casos (parceiro_id = NULL)
  const casosResp = await supabase
    .from("casos")
    .update({ parceiro_id: null })
    .eq("parceiro_id", usuarioId);
  if (casosResp.error) {
    erros.push("casos: " + casosResp.error.message);
  }

  // 3.2) Andamentos - preserva timeline, perde autoria
  try {
    const andResp = await supabase
      .from("andamentos")
      .update({ criado_por: null })
      .eq("criado_por", usuarioId);
    if (andResp.error) erros.push("andamentos: " + andResp.error.message);
  } catch (e) {
    erros.push("andamentos: " + (e as Error).message);
  }

  // 3.3) Documentos - preserva docs, perde autoria
  try {
    const docResp = await supabase
      .from("documentos")
      .update({ uploaded_by: null })
      .eq("uploaded_by", usuarioId);
    if (docResp.error) erros.push("documentos: " + docResp.error.message);
  } catch (e) {
    erros.push("documentos: " + (e as Error).message);
  }

  // 3.4) Comentarios do parceiro - delete (cascade kills replies)
  try {
    const comResp = await supabase
      .from("comentarios")
      .delete()
      .eq("autor_id", usuarioId);
    if (comResp.error) erros.push("comentarios: " + comResp.error.message);
  } catch (e) {
    // Tabela pode nao existir se migration nao rodou - nao bloqueia
    console.warn("comentarios delete falhou (ok se tabela nao existe):", e);
  }

  // 3.5) Solicitacoes de documento - set null em criado_por se existir
  try {
    await supabase
      .from("solicitacoes_documento")
      .update({ criado_por: null })
      .eq("criado_por", usuarioId);
  } catch {
    // Ignora se coluna nao existir
  }

  // 3.6) Acessos senha INSS (CASCADE no usuario_id pode ser SET NULL ja)
  try {
    await supabase
      .from("acessos_senha_inss")
      .update({ usuario_id: null })
      .eq("usuario_id", usuarioId);
  } catch {
    // Tabela ja tem on delete set null no FK
  }

  // 3.7) Mensagens legacy (tabela antiga do Chat)
  try {
    await supabase
      .from("mensagens")
      .delete()
      .eq("remetente_id", usuarioId);
  } catch {
    // Ignora se ja foi removida ou nao tem
  }

  // ---------------------------------------------------------------------------
  // 4) Delete public.usuarios
  // ---------------------------------------------------------------------------
  const delUsr = await supabase.from("usuarios").delete().eq("id", usuarioId);
  if (delUsr.error) {
    return jsonResponse(
      {
        error: "erro ao deletar usuarios",
        detail: delUsr.error.message,
        erros_cascade: erros,
      },
      500,
    );
  }

  // ---------------------------------------------------------------------------
  // 5) Delete auth.users via admin
  // ---------------------------------------------------------------------------
  const delAuth = await supabase.auth.admin.deleteUser(usuarioId);
  if (delAuth.error) {
    // public.usuarios ja foi - retorna warning mas nao erro
    return jsonResponse({
      excluido: true,
      auth_excluido: false,
      warning: "Parceiro excluido do app mas auth.users falhou: " +
        delAuth.error.message,
      erros_cascade: erros,
    });
  }

  return jsonResponse({
    excluido: true,
    auth_excluido: true,
    erros_cascade: erros,
    nome: (alvo as { nome: string | null }).nome,
  });
});
