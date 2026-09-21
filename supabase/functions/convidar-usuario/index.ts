// supabase/functions/convidar-usuario/index.ts
//
// Cria um usuario (interno OU parceiro) e envia o link de acesso via API admin
// (admin.inviteUserByEmail). Nao mexe na sessao do interno logado. Cria a linha
// em public.usuarios explicitamente (NAO existe trigger auth.users->usuarios).
//
//   - tipo='interno': onboarded_em=now() (pula o fluxo de boas-vindas do
//     parceiro), oab opcional.
//   - tipo='parceiro': onboarded_em=NULL (passa por /boas-vindas).
//
// Body: { nome, email, tipo: 'interno'|'parceiro', oab?, telefone?, observacoes?, redirect_to?, reenviar_link? }
//   reenviar_link=true: se o usuario ja existir, envia um novo magic link de
//   acesso (signInWithOtp) em vez de so responder ja_existia.
// Auth: JWT de usuario interno.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { exigirUsuario } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-escritorio-id",
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ---- Autorizacao: interno ATIVO do escritório ativo ----
  // O convite é para o escritório de QUEM CONVIDA (RBAC multi-tenant).
  const quem = await exigirUsuario(req, { tipo: "interno" });
  if (quem instanceof Response) return quem;
  const perfil = quem.perfil;
  const escritorioId = perfil.escritorio_id; // nulo só em banco sem as migrations

  // ---- Body ----
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  const nome = String(body.nome || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const tipo = body.tipo === "interno" ? "interno" : "parceiro";
  // Papel no escritório. Interno: admin, advogado (padrão), assistente ou
  // financeiro. Parceiro é sempre "parceiro".
  const PAPEIS_INTERNOS = ["admin", "advogado", "assistente", "financeiro"];
  const papel = tipo === "parceiro"
    ? "parceiro"
    : PAPEIS_INTERNOS.includes(String(body.papel)) ? String(body.papel) : "advogado";
  // Convidar gente pra EQUIPE (interno) e so de quem gerencia a equipe (admin).
  // Parceiro, quem gerencia parceiros (todo advogado) continua podendo.
  const podeConvidar = escritorioId
    ? perfil.permissoes.includes(tipo === "interno" ? "equipe:gerenciar" : "parceiros:gerenciar")
    : tipo === "parceiro" || perfil.eh_admin === true;
  if (!podeConvidar) {
    return jsonResponse({
      error: tipo === "interno"
        ? "apenas administradores podem convidar internos"
        : "sem permissão para convidar parceiros",
    }, 403);
  }
  const oab = String(body.oab || "").trim();
  const telefone = String(body.telefone || "").trim();
  const observacoes = body.observacoes ? String(body.observacoes).trim() : null;
  const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;
  const percentualRaw = body.percentual_parceiro ?? body.percentual;
  const percentual =
    percentualRaw === null || percentualRaw === undefined || percentualRaw === ""
      ? null
      : Number(percentualRaw);

  if (nome.length < 3) return jsonResponse({ error: "nome obrigatorio" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResponse({ error: "email invalido" }, 400);
  }

  // ---- Convite via admin API ----
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      nome,
      oab,
      telefone,
      tipo,
      observacoes_iniciais: observacoes,
    },
    redirectTo,
  });

  if (error) {
    const msg = error.message || "";
    if (/already.*regist|already.*exist/i.test(msg)) {
      const { data: existente } = await admin
        .from("usuarios")
        .select("id, nome, email, tipo")
        .eq("email", email)
        .maybeSingle();
      if (existente?.id) {
        // Já tem conta. Se ainda NÃO é deste escritório, o convite vira vínculo
        // (a pessoa passa a ver os dois no seletor) — com a sessão de quem
        // convida, que é onde a permissão é conferida de novo.
        let vinculado = false;
        if (escritorioId) {
          const { data: jaMembro } = await admin
            .from("membros")
            .select("id, status")
            .eq("escritorio_id", escritorioId)
            .eq("usuario_id", existente.id)
            .maybeSingle();
          if (!jaMembro) {
            const v = await quem.rls.rpc("vincular_pessoa", { p_email: email, p_papel: papel });
            if (v.error) return jsonResponse({ error: "erro ao vincular: " + v.error.message }, 400);
            vinculado = true;
          }
        }
        let linkEnviado = false;
        let warning: string | undefined;
        if (body.reenviar_link === true) {
          const otp = await admin.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
          });
          if (otp.error) {
            warning = "novo magic link falhou: " + otp.error.message;
          } else {
            linkEnviado = true;
          }
        }
        return jsonResponse({
          ok: true,
          ja_existia: true,
          vinculado,
          link_enviado: linkEnviado,
          ...(warning ? { warning } : {}),
          id: existente.id,
          nome: existente.nome,
          email: existente.email,
          tipo: existente.tipo,
        });
      }
    }
    return jsonResponse({ error: "erro ao convidar: " + msg }, 400);
  }

  // Cria/atualiza a linha em usuarios (nao ha trigger).
  const newId = data.user?.id || null;
  if (newId) {
    const novoPerfil: Record<string, unknown> = {
      id: newId,
      nome,
      email,
      oab: oab || null,
      telefone: telefone || null,
      tipo,
      // Papel comercial. Quem entra como parceiro e parceiro; quem entra como
      // interno pode virar parceiro depois (flag editavel em /parceiros), mas
      // nao nasce assim.
      eh_parceiro: tipo === "parceiro",
      ativo: true,
      // interno ja entra "onboarded" (boas-vindas e fluxo do parceiro).
      onboarded_em: tipo === "interno" ? new Date().toISOString() : null,
      // É daqui que o vínculo nasce no escritório certo (gatilho de
      // sincronização usuarios → membros).
      ...(escritorioId ? { escritorio_origem_id: escritorioId } : {}),
    };
    // percentual_parceiro e "not null default 30": mandar null explicito viola a
    // constraint em vez de cair no default. So inclui a chave quando ha valor.
    if (tipo === "parceiro" && percentual !== null && !Number.isNaN(percentual)) {
      novoPerfil.percentual_parceiro = percentual;
    }

    const { error: upErr } = await admin.from("usuarios").upsert(novoPerfil, {
      onConflict: "id",
    });
    if (upErr) {
      return jsonResponse({
        ok: false,
        id: newId,
        error: "Convite enviado, mas falha ao criar o perfil: " + upErr.message,
      });
    }
  }

  // O gatilho só conhece admin/advogado/parceiro (é o vocabulário das colunas
  // antigas). Papel diferente disso é ajustado no vínculo recém-criado.
  if (newId && escritorioId && papel !== "advogado" && papel !== "parceiro") {
    const { data: p } = await admin.from("papeis").select("id").is("escritorio_id", null).eq("chave", papel).maybeSingle();
    if (p?.id) {
      const { error: papelErr } = await admin.from("membros")
        .update({ papel_id: p.id, convidado_por: quem.uid })
        .eq("escritorio_id", escritorioId).eq("usuario_id", newId);
      if (papelErr) console.error("papel do convidado não aplicado:", papelErr.message);
    }
  }

  return jsonResponse({ ok: true, id: newId, nome, email, tipo, papel });
});
