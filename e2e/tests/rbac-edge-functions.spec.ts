// E2E: RBAC multi-tenant nas EDGE FUNCTIONS.
//
// As functions leem e gravam com service role, que ignora RLS — então o
// isolamento delas não vem de policy nenhuma: vem de `exigirUsuario` (papel e
// escritório ativo pelo vínculo) e de `exigirRecurso` (o id que veio no corpo é
// visível a quem chamou?). Aqui cada uma recebe o id de um recurso do OUTRO
// escritório e tem que responder como se ele não existisse.
//
// Só no banco LOCAL (`bun run local:rbac`). Nenhuma chamada chega a API externa:
// todas são barradas antes.

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const SENHA = ENV.internoPassword;
const FN = `${ENV.supabaseUrl}/functions/v1`;

let ESC1: string;
let ESC2: string;

async function sessao(email: string, escritorio?: string) {
  const sb: SupabaseClient = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: SENHA });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  const jwt = data.session!.access_token;
  return async (fn: string, body: unknown) => {
    const r = await fetch(`${FN}/${fn}`, {
      method: "POST",
      headers: {
        apikey: ENV.anonKey,
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        ...(escritorio ? { "x-escritorio-id": escritorio } : {}),
      },
      body: JSON.stringify(body),
    });
    const texto = await r.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }
    return { status: r.status, json, texto };
  };
}

test.describe.serial("RBAC nas edge functions", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só roda no banco local");
    const { data: escs, error } = await admin.from("escritorios").select("id, slug, padrao_sistema");
    test.skip(!!error || !escs?.some((e) => e.slug === "canario"), "rode `bun run local:rbac`");
    ESC1 = escs!.find((e) => e.padrao_sistema)!.id;
    ESC2 = escs!.find((e) => e.slug === "canario")!.id;
  });

  test("id de recurso de outro escritório = não encontrado", async () => {
    const adv2 = await sessao(`canario+advogado@${DOM}`, ESC2);
    const { data: caso1 } = await admin.from("casos").select("id").eq("escritorio_id", ESC1).limit(1).single();
    const { data: tarefa1 } = await admin.from("tarefas").select("id").eq("escritorio_id", ESC1).limit(1).single();
    const { data: and1 } = await admin.from("andamentos").select("id").eq("escritorio_id", ESC1).limit(1).single();
    const { data: com1 } = await admin.from("comentarios").select("id").eq("escritorio_id", ESC1).limit(1).single();
    const { data: sol1 } = await admin.from("solicitacoes_documento").select("id").eq("escritorio_id", ESC1).limit(1).single();

    const ataques: Array<[string, unknown]> = [
      ["sync-djen-caso", { caso_id: caso1!.id, dry_run: true }],
      ["sync-legalmail-caso", { caso_id: caso1!.id, idprocessos: [1] }],
      ["sync-ti-cliente", { cpf: "39053344705", caso_id: caso1!.id }],
      ["sugerir-proxima-tarefa", { tarefa_id: tarefa1!.id }],
      ["notify-novo-andamento", { andamento_id: and1!.id }],
      ["notify-novo-comentario", { comentario_id: com1!.id }],
      ["notify-solicitacao-doc", { solicitacao_id: sol1!.id }],
    ];
    const respostas: string[] = [];
    for (const [fn, body] of ataques) {
      const r = await adv2(fn, body);
      // 404 = barrado pelo exigirRecurso. No ambiente local algumas functions
      // param ANTES, por falta do segredo da integração (Legalmail, TI) — também
      // serve: não chegaram a tocar no dado. O que não pode é 2xx.
      const semSegredo = (r.status === 500 && /nao configurado|não configurado|ausente/i.test(r.texto))
        || (r.status === 412 && /integracao_nao_configurada/.test(r.texto));
      respostas.push(`${fn}=${r.status}${semSegredo ? "(sem segredo)" : ""}`);
      expect(r.status === 404 || semSegredo, `${fn} com id do escritório 1 → ${r.status} ${r.texto.slice(0, 120)}`).toBe(true);
    }
    console.log("ataques com id alheio:", respostas.join(" · "));
    // ia-analise exige IA configurada ANTES de olhar o caso; sem chave no canário
    // responde 412 — o que importa é nunca ser 200.
    const analise = await adv2("ia-analise", { caso_id: caso1!.id });
    expect([404, 412], `ia-analise → ${analise.texto.slice(0, 120)}`).toContain(analise.status);
  });

  test("header de outro escritório não vira acesso", async () => {
    const forjado = await sessao(`canario+advogado@${DOM}`, ESC1);
    const { data: caso1 } = await admin.from("casos").select("id").eq("escritorio_id", ESC1).limit(1).single();
    const r = await forjado("sync-djen-caso", { caso_id: caso1!.id, dry_run: true });
    expect(r.status, r.texto.slice(0, 120)).toBe(403); // sem escritório ativo
  });

  test("papel vem do vínculo: financeiro não usa IA, parceiro não convida, advogado não convida interno", async () => {
    const fin = await sessao(`canario+financeiro@${DOM}`, ESC2);
    expect((await fin("ia-analise", { caso_id: crypto.randomUUID() })).status).toBe(403);

    const parc = await sessao(`canario+parceiro@${DOM}`, ESC2);
    expect((await parc("convidar-usuario", { nome: "Fulano de Tal", email: "x@example.invalid", tipo: "parceiro" })).status).toBe(403);

    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const r = await adv("convidar-usuario", { nome: "Fulano de Tal", email: "x@example.invalid", tipo: "interno", papel: "admin" });
    expect(r.status, r.texto).toBe(403);
    expect((await adv("update-parceiro", { usuario_id: crypto.randomUUID(), nome: "x" })).status, "editar parceiro é de admin").toBe(403);
  });

  test("admin de um escritório não edita nem exclui gente do outro", async () => {
    const cAdmin = await sessao(`canario+admin@${DOM}`, ESC2);
    const { data: parc1 } = await admin.from("usuarios").select("id, email").eq("email", `e2e+parceiro@${DOM}`).single();

    const upd = await cAdmin("update-parceiro", { usuario_id: parc1!.id, email: "sequestro@example.invalid", enviar_link: false });
    expect(upd.status, upd.texto).toBe(404);
    const del = await cAdmin("excluir-parceiro", { usuario_id: parc1!.id, confirmar: true });
    expect(del.status, del.texto).toBe(404);

    const { data: depois } = await admin.from("usuarios").select("email").eq("id", parc1!.id).single();
    expect(depois!.email).toBe(parc1!.email);
  });

  test("quem atua em dois escritórios não tem o e-mail trocado por terceiros, e sair de um não apaga a conta", async () => {
    const cAdmin = await sessao(`canario+admin@${DOM}`, ESC2);
    const { data: duplo } = await admin.from("usuarios").select("id, email").eq("email", `rbac+duplo@${DOM}`).single();

    const upd = await cAdmin("update-parceiro", { usuario_id: duplo!.id, email: "novo-duplo@example.invalid", enviar_link: false });
    expect(upd.status, upd.texto).toBe(409);

    // excluir do canário: o vínculo sai, a conta e o vínculo do escritório 1 ficam
    const del = await cAdmin("excluir-parceiro", { usuario_id: duplo!.id, confirmar: true });
    expect(del.status, del.texto).toBe(200);
    expect(del.json?.conta_preservada).toBe(true);
    const { data: vinculos } = await admin.from("membros").select("escritorio_id").eq("usuario_id", duplo!.id);
    expect(vinculos!.map((v) => v.escritorio_id)).toEqual([ESC1]);
    const { data: conta } = await admin.from("usuarios").select("id").eq("id", duplo!.id).maybeSingle();
    expect(conta, "a conta não pode ter sido apagada").toBeTruthy();

    // repõe o vínculo (o seed e os outros specs contam com ele) — pelo caminho oficial
    const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-escritorio-id": ESC2 } },
    });
    await sb.auth.signInWithPassword({ email: `canario+admin@${DOM}`, password: SENHA });
    expect((await sb.rpc("vincular_pessoa", { p_email: `rbac+duplo@${DOM}`, p_papel: "parceiro" })).error).toBeNull();
    // os casos dele no canário foram desvinculados pela exclusão: religa
    await admin.from("casos").update({ parceiro_id: duplo!.id }).eq("escritorio_id", ESC2).is("parceiro_id", null)
      .in("cliente_id", (await admin.from("clientes").select("id").eq("escritorio_id", ESC2).like("nome", "Kleber%")).data!.map((c) => c.id));
  });

  test("convite nasce no escritório de quem convida, com o papel pedido", async () => {
    const email = `e2e+rbac-convite-${Date.now()}@${DOM}`;
    const cAdmin = await sessao(`canario+admin@${DOM}`, ESC2);
    const r = await cAdmin("convidar-usuario", { nome: "[E2E] Convidado RBAC", email, tipo: "interno", papel: "assistente" });
    expect(r.status, r.texto).toBe(200);
    expect(r.json?.ok).toBe(true);

    const { data: m } = await admin.from("membros")
      .select("escritorio_id, status, papel:papeis(chave)").eq("usuario_id", r.json!.id as string);
    expect(m).toHaveLength(1);
    expect(m![0].escritorio_id).toBe(ESC2);
    expect((m![0].papel as unknown as { chave: string }).chave).toBe("assistente");

    await admin.from("usuarios").delete().eq("id", r.json!.id as string);
    await admin.auth.admin.deleteUser(r.json!.id as string);
  });

  test("QG: só staff cria escritório; o primeiro admin já entra", async () => {
    const naoStaff = await sessao(`canario+admin@${DOM}`, ESC2);
    expect((await naoStaff("qg-escritorios", { action: "criar_escritorio", nome: "Ataque", slug: "ataque", admin_nome: "Fulano", admin_email: "a@example.invalid" })).status).toBe(403);
    const suporte = await sessao(`qg+suporte@${DOM}`);
    expect((await suporte("qg-escritorios", { action: "criar_escritorio", nome: "Ataque", slug: "ataque", admin_nome: "Fulano", admin_email: "a@example.invalid" })).status).toBe(403);

    const dono = await sessao(`qg+dono@${DOM}`);
    const slug = `e2e-qg-${Date.now()}`;
    const email = `e2e+rbac-primeiro-admin-${Date.now()}@${DOM}`;
    const r = await dono("qg-escritorios", { action: "criar_escritorio", nome: "[E2E] Escritório pelo QG", slug, admin_nome: "[E2E] Primeira Admin", admin_email: email });
    expect(r.status, r.texto).toBe(200);
    const escId = r.json!.escritorio_id as string;

    const { data: esc } = await admin.from("escritorios").select("status").eq("id", escId).single();
    expect(esc!.status).toBe("ativo");
    const { data: m } = await admin.from("membros").select("status, papel:papeis(chave)").eq("escritorio_id", escId);
    expect(m).toHaveLength(1);
    expect((m![0].papel as unknown as { chave: string }).chave).toBe("admin");
    expect((await dono("qg-escritorios", { action: "criar_escritorio", nome: "Repetido", slug, admin_nome: "Fulano de Tal", admin_email: email })).status).toBe(409);

    // limpeza: encerra e elimina pelo caminho oficial (duas pessoas)
    const sbDono = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false } });
    await sbDono.auth.signInWithPassword({ email: `qg+dono@${DOM}`, password: SENHA });
    const sbDono2 = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false } });
    await sbDono2.auth.signInWithPassword({ email: `qg+dono2@${DOM}`, password: SENHA });
    expect((await sbDono.rpc("qg_encerrar_escritorio", { p_id: escId, p_motivo: "limpeza do teste E2E" })).error).toBeNull();
    const ped = await sbDono.rpc("qg_pedir_eliminacao", { p_id: escId });
    expect((await sbDono2.rpc("qg_aprovar_eliminacao", { p_aprovacao_id: ped.data })).error).toBeNull();
    const adminId = r.json!.admin_id as string;
    await admin.from("usuarios").delete().eq("id", adminId);
    await admin.auth.admin.deleteUser(adminId);
  });
});
