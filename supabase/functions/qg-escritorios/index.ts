// =============================================================================
// Edge Function: qg-escritorios — QG da plataforma (superadmin)
//
// O que o QG faz e PRECISA da Admin API do Auth (criar conta / mandar convite):
//
//   { action: "criar_escritorio", nome, slug, cnpj?, plano?, admin_nome, admin_email, redirect_to? }
//       cria o escritório (RPC qg_criar_escritorio, com a sessão do staff — é lá
//       que a permissão é conferida e a auditoria grava o ator), convida o
//       primeiro admin e ativa o escritório.
//   { action: "convidar_staff", nome, email, papel, break_glass?, redirect_to? }
//       conta nova para a equipe da plataforma — SEM vínculo com escritório.
//
// Todo o resto do QG (listar, editar, suspender, encerrar, suporte…) é RPC
// `qg_*` direto do front: não precisa de service role.
//
// Quem chama: staff da plataforma (plataforma_staff), conferido no banco por
// `private.exigir_staff` dentro de cada RPC — esta function não decide nada
// sozinha, só encadeia.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Conta no Auth (convite por e-mail) + linha em `usuarios`. Devolve o id. */
async function garantirConta(
  admin: SupabaseClient,
  dados: { nome: string; email: string; escritorioOrigem: string | null; redirectTo?: string },
): Promise<{ id: string; nova: boolean } | { erro: string }> {
  const { data: existente, error: exErr } = await admin
    .from("usuarios").select("id").eq("email", dados.email).maybeSingle();
  if (exErr) return { erro: "falha ao procurar a conta: " + exErr.message };
  if (existente?.id) return { id: existente.id as string, nova: false };

  const convite = await admin.auth.admin.inviteUserByEmail(dados.email, {
    data: { nome: dados.nome, tipo: "interno" },
    redirectTo: dados.redirectTo,
  });
  if (convite.error || !convite.data.user?.id) {
    return { erro: "erro ao convidar: " + (convite.error?.message ?? "sem usuário") };
  }
  const id = convite.data.user.id;
  const { error: upErr } = await admin.from("usuarios").upsert({
    id,
    nome: dados.nome,
    email: dados.email,
    tipo: "interno",
    ativo: true,
    onboarded_em: new Date().toISOString(),
    ...(dados.escritorioOrigem ? { escritorio_origem_id: dados.escritorioOrigem } : {}),
  }, { onConflict: "id" });
  if (upErr) return { erro: "convite enviado, mas o perfil falhou: " + upErr.message };
  return { id, nova: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) return jsonResponse({ error: "env ausente" }, 500);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt.split(".").length !== 3) return jsonResponse({ error: "não autenticado" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !u?.user?.id) return jsonResponse({ error: "não autenticado" }, 401);

  // A sessão do staff: é com ela que as RPCs qg_* rodam.
  const staff = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: eu, error: euErr } = await staff.rpc("qg_eu");
  if (euErr) return jsonResponse({ error: "falha ao verificar o acesso ao QG" }, 503);
  const perms: string[] = (Array.isArray(eu) ? eu[0]?.permissoes : null) ?? [];
  if (perms.length === 0) return jsonResponse({ error: "acesso restrito à equipe da plataforma" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  const action = String(body.action ?? "");
  const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;

  // ---------------------------------------------------------------------------
  if (action === "criar_escritorio") {
    if (!perms.includes("escritorios_gerenciar")) return jsonResponse({ error: "sem permissão para criar escritório" }, 403);
    const nome = String(body.nome ?? "").trim();
    const slug = String(body.slug ?? "").trim().toLowerCase();
    const adminNome = String(body.admin_nome ?? "").trim();
    const adminEmail = String(body.admin_email ?? "").trim().toLowerCase();
    if (nome.length < 3) return jsonResponse({ error: "nome do escritório obrigatório" }, 400);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return jsonResponse({ error: "slug inválido (letras minúsculas, números e hífen)" }, 400);
    if (adminNome.length < 3) return jsonResponse({ error: "nome do primeiro admin obrigatório" }, 400);
    if (!EMAIL_RE.test(adminEmail)) return jsonResponse({ error: "e-mail do primeiro admin inválido" }, 400);

    const criado = await staff.rpc("qg_criar_escritorio", {
      p_nome: nome, p_slug: slug, p_cnpj: body.cnpj ? String(body.cnpj) : null, p_plano: body.plano ? String(body.plano) : "padrao",
    });
    if (criado.error) {
      const dup = /duplicate key|escritorios_slug_key/.test(criado.error.message);
      return jsonResponse({ error: dup ? "já existe um escritório com este slug" : criado.error.message }, dup ? 409 : 400);
    }
    const escritorioId = criado.data as string;

    const conta = await garantirConta(admin, { nome: adminNome, email: adminEmail, escritorioOrigem: escritorioId, redirectTo });
    if ("erro" in conta) {
      // O escritório fica "provisionando": dá para tentar o convite de novo.
      return jsonResponse({ ok: false, escritorio_id: escritorioId, error: conta.erro }, 207);
    }
    const vinc = await staff.rpc("qg_vincular_primeiro_admin", { p_escritorio_id: escritorioId, p_usuario_id: conta.id });
    if (vinc.error) return jsonResponse({ ok: false, escritorio_id: escritorioId, error: vinc.error.message }, 207);

    return jsonResponse({ ok: true, escritorio_id: escritorioId, admin_id: conta.id, conta_nova: conta.nova });
  }

  // ---------------------------------------------------------------------------
  if (action === "convidar_staff") {
    if (!perms.includes("staff_gerenciar")) return jsonResponse({ error: "sem permissão para gerenciar a equipe do QG" }, 403);
    const nome = String(body.nome ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const papel = String(body.papel ?? "");
    if (nome.length < 3) return jsonResponse({ error: "nome obrigatório" }, 400);
    if (!EMAIL_RE.test(email)) return jsonResponse({ error: "e-mail inválido" }, 400);
    if (!["dono", "operacao", "suporte", "leitura"].includes(papel)) return jsonResponse({ error: "papel inválido" }, 400);

    const conta = await garantirConta(admin, { nome, email, escritorioOrigem: null, redirectTo });
    if ("erro" in conta) return jsonResponse({ error: conta.erro }, 400);
    // Staff não é membro de escritório: a sincronização usuarios→membros cria um
    // vínculo para toda conta nova (código antigo) — desfaz SÓ quando a conta
    // acabou de nascer aqui. Quem já tinha conta mantém os vínculos que tinha.
    if (conta.nova) {
      const { error: delErr } = await admin.from("membros").delete().eq("usuario_id", conta.id);
      if (delErr) return jsonResponse({ error: "conta criada, mas sobrou vínculo de escritório: " + delErr.message }, 500);
    }
    const def = await staff.rpc("qg_definir_staff", { p_email: email, p_papel: papel, p_ativo: true, p_break_glass: body.break_glass === true });
    if (def.error) return jsonResponse({ error: def.error.message }, 400);
    return jsonResponse({ ok: true, usuario_id: conta.id, conta_nova: conta.nova });
  }

  return jsonResponse({ error: "action desconhecida" }, 400);
});
