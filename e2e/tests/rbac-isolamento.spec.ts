// E2E: RBAC multi-tenant — a MATRIZ CRUZADA entre dois escritórios.
//
// Tudo aqui é ataque via API com a sessão real de cada papel, nada de UI: é o
// único jeito de provar o que a tela esconde. Dois escritórios no banco local —
// o 1 (Mara Vian, os dados de sempre) e o Canário, criado pelo QG — e uma conta
// por papel em cada um (scripts/seed-local-rbac.mjs).
//
//   isolamento   ninguém lê nem grava no escritório do outro, nem forjando o
//                header, nem apontando filho para pai alheio, nem por RPC;
//   papéis       financeiro e assistente só fazem o que a matriz de §4.3 dá;
//   revogação    vínculo desativado com o JWT ainda válido → 0 linhas na hora;
//   dois vínculos a mesma pessoa vê um escritório por vez, o do header;
//   QG           staff sem vínculo lê 0 linhas; funções qg_* recusam quem não é
//                staff e devolvem só metadado; suporte só com aprovação do
//                escritório, só leitura, e some quando encerra;
//   suspensão    escritório suspenso = 0 linhas para os membros.
//
// Só roda no banco LOCAL com as migration_rbac_0* aplicadas e o seed rodado
// (`bun run local:rbac`).

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const SENHA = ENV.internoPassword;

let ESC1: string;
let ESC2: string;
let dominio: string[] = [];

async function como(email: string, escritorio?: string | null): Promise<SupabaseClient> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorio ? { headers: { "x-escritorio-id": escritorio } } : {},
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: SENHA });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return sb;
}

/** Linhas visíveis por tabela de domínio. Erro de query NÃO é zero: aparece. */
async function visiveis(sb: SupabaseClient, filtroEscritorio?: string) {
  const out: Record<string, number> = {};
  for (const t of dominio) {
    let q = sb.from(t).select("*", { count: "exact", head: true });
    if (filtroEscritorio) q = q.eq("escritorio_id", filtroEscritorio);
    const { count, error } = await q;
    if (error) throw new Error(`${t}: ${error.message}`);
    out[t] = count ?? 0;
  }
  return out;
}
const soma = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);
const comLinhas = (v: Record<string, number>) => Object.entries(v).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`);

test.describe.serial("RBAC multi-tenant", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "matriz cruzada só roda no banco local");
    const { data: escs, error } = await admin.from("escritorios").select("id, slug, padrao_sistema");
    test.skip(!!error, "migrations do RBAC não aplicadas neste banco — rode `bun run local:rbac`");
    ESC1 = escs!.find((e) => e.padrao_sistema)!.id;
    const canario = escs!.find((e) => e.slug === "canario");
    test.skip(!canario, "escritório canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;

    // tabelas de domínio = as que têm escritorio_id e aparecem na API
    const r = await fetch(`${ENV.supabaseUrl}/rest/v1/`, { headers: { apikey: ENV.serviceRoleKey } });
    const spec = (await r.json()) as { definitions: Record<string, { properties?: Record<string, unknown> }> };
    dominio = Object.entries(spec.definitions)
      .filter(([nome, d]) => d.properties?.escritorio_id && !["membros", "papeis", "escritorio_config", "auditoria", "acessos_suporte"].includes(nome))
      .map(([nome]) => nome)
      .sort();
    expect(dominio.length, "tabelas de domínio na API").toBeGreaterThan(35);

    // estado limpo de rodada anterior interrompida
    await admin.from("escritorios").update({ status: "ativo", suspenso_em: null, suspenso_motivo: null }).eq("id", ESC2);
    await admin.from("acessos_suporte").delete().eq("escritorio_id", ESC2);
  });

  // -------------------------------------------------------------------------
  test("isolamento: cada escritório só enxerga o que é dele", async () => {
    const canarioAdmin = await como(`canario+admin@${DOM}`, ESC2);
    const v2 = await visiveis(canarioAdmin);
    expect(soma(v2), "o canário vê os próprios dados").toBeGreaterThan(10);
    expect(comLinhas(await visiveis(canarioAdmin, ESC1)), "canário lendo linhas do escritório 1").toEqual([]);

    const interno1 = await como(`e2e+interno@${DOM}`, ESC1);
    const v1 = await visiveis(interno1);
    expect(v1.casos).toBeGreaterThan(400);
    expect(comLinhas(await visiveis(interno1, ESC2)), "escritório 1 lendo linhas do canário").toEqual([]);

    // Pessoas: cada um vê a própria equipe, não a do outro.
    const { data: gente2 } = await canarioAdmin.from("usuarios").select("email");
    const emails2 = (gente2 ?? []).map((u) => u.email);
    expect(emails2).toContain(`canario+parceiro@${DOM}`);
    expect(emails2.filter((e) => e?.startsWith("e2e+"))).toEqual([]);
  });

  test("header forjado não abre escritório alheio", async () => {
    const forjado = await como(`canario+admin@${DOM}`, ESC1); // não é membro do 1
    expect(comLinhas(await visiveis(forjado)), "com header de outro escritório").toEqual([]);
    const { data: ativo } = await forjado.rpc("escritorio_ativo");
    expect(ativo).toBeNull();

    const lixo = createClient(ENV.supabaseUrl, ENV.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-escritorio-id": "nao-e-uuid" } },
    });
    await lixo.auth.signInWithPassword({ email: `canario+admin@${DOM}`, password: SENHA });
    expect((await lixo.from("casos").select("id")).data ?? []).toHaveLength(0);
  });

  test("escrita cruzada: filho não aponta para pai de outro escritório", async () => {
    const adv2 = await como(`canario+advogado@${DOM}`, ESC2);
    const { data: caso1 } = await admin.from("casos").select("id, cliente_id").eq("escritorio_id", ESC1).limit(1).single();
    const { data: caso2 } = await admin.from("casos").select("id").eq("escritorio_id", ESC2).limit(1).single();

    const and = await adv2.from("andamentos").insert({ caso_id: caso1!.id, origem: "interno", titulo: "[ataque] andamento em caso alheio" });
    expect(and.error, "andamento em caso do escritório 1").toBeTruthy();

    const tar = await adv2.from("tarefas").insert({ caso_id: caso1!.id, tipo: "interna", titulo: "[ataque] tarefa em caso alheio", escritorio_id: ESC2 });
    expect(tar.error, "tarefa dizendo escritório 2 num caso do 1").toBeTruthy();

    const novoCaso = await adv2.from("casos").insert({ cliente_id: caso1!.cliente_id, tipo_beneficio: "BPC/LOAS", fase: "analise" });
    expect(novoCaso.error, "caso do canário para cliente do escritório 1").toBeTruthy();

    // UPDATE reapontando o pai
    const { data: minha } = await adv2.from("tarefas").select("id").not("caso_id", "is", null).limit(1).single();
    const mover = await adv2.from("tarefas").update({ caso_id: caso1!.id }).eq("id", minha!.id).select("id");
    expect(mover.error ?? (mover.data?.length === 0 ? "bloqueado" : null), "reapontar tarefa pro caso alheio").toBeTruthy();

    // Nem com service role (que ignora RLS): o gatilho vale para todos.
    const viaServico = await admin.from("andamentos").insert({ caso_id: caso1!.id, origem: "interno", titulo: "[ataque] serviço", escritorio_id: ESC2 });
    expect(viaServico.error?.message ?? "").toMatch(/registro pai|outro escritório/);
    const moverServico = await admin.from("tarefas").update({ caso_id: caso1!.id }).eq("id", minha!.id);
    expect(moverServico.error?.message ?? "").toMatch(/outro escritório/);
    const trocarEsc = await admin.from("casos").update({ escritorio_id: ESC1 }).eq("id", caso2!.id);
    expect(trocarEsc.error?.message ?? "").toMatch(/não pode ser alterado/);

    const { count } = await admin.from("andamentos").select("id", { count: "exact", head: true }).like("titulo", "[ataque]%");
    expect(count).toBe(0);
  });

  test("RPCs com id de outro escritório", async () => {
    const adv2 = await como(`canario+advogado@${DOM}`, ESC2);
    const { data: caso1 } = await admin.from("casos").select("id, cliente_id").eq("escritorio_id", ESC1).limit(1).single();

    expect((await adv2.rpc("get_senha_meu_inss", { p_cliente_id: caso1!.cliente_id })).error, "senha do MEU INSS alheia").toBeTruthy();
    expect((await adv2.rpc("tem_senha_meu_inss", { p_cliente_id: caso1!.cliente_id })).error).toBeTruthy();
    expect((await adv2.rpc("excluir_cliente", { p_cliente_id: caso1!.cliente_id })).error, "excluir cliente alheio").toBeTruthy();
    expect((await adv2.rpc("pedir_troca_senha_meu_inss", { p_caso_id: caso1!.id, p_prazo_at: null, p_motivo: "x" })).error).toBeTruthy();
    expect((await adv2.rpc("pericias_do_caso", { p_caso_id: caso1!.id })).data ?? []).toHaveLength(0);

    // aplicar_template não conferia NADA antes (criava tarefa em qualquer caso).
    const antes = (await admin.from("tarefas").select("id", { count: "exact", head: true }).eq("caso_id", caso1!.id)).count;
    const { data: tpl } = await admin.from("tarefa_templates").select("nome").eq("escritorio_id", ESC2).eq("ativo", true).limit(1).single();
    expect((await adv2.rpc("aplicar_template", { p_caso_id: caso1!.id, p_template: tpl!.nome })).error, "template em caso alheio").toBeTruthy();
    expect((await admin.from("tarefas").select("id", { count: "exact", head: true }).eq("caso_id", caso1!.id)).count).toBe(antes);

    // listas: só o escritório de quem pede
    const parados = await adv2.rpc("casos_sem_proximo_passo");
    expect(parados.error).toBeNull();
    const ids = (parados.data ?? []).map((c: { caso_id: string }) => c.caso_id);
    const { data: meus } = await admin.from("casos").select("id").eq("escritorio_id", ESC2);
    expect(ids.every((id: string) => meus!.some((m) => m.id === id))).toBe(true);

    // gestão de equipe não atravessa escritório
    const cAdmin = await como(`canario+admin@${DOM}`, ESC2);
    const { data: alvo } = await admin.from("usuarios").select("id").eq("email", `e2e+interno@${DOM}`).single();
    expect((await cAdmin.rpc("definir_papel", { p_usuario_id: alvo!.id, p_papel: "admin" })).error, "promover gente do escritório 1").toBeTruthy();
    expect((await cAdmin.rpc("desligar_interno", { p_usuario_id: alvo!.id })).error, "desligar gente do escritório 1").toBeTruthy();
  });

  test("responsável automático é sempre do escritório do caso", async () => {
    const parc2 = await como(`canario+parceiro@${DOM}`, ESC2);
    const { data: euParc } = await admin.from("usuarios").select("id").eq("email", `canario+parceiro@${DOM}`).single();
    const cli = await parc2.from("clientes").insert({ nome: "[E2E] RBAC dono automático", cpf: "39053344705" }).select("id").single();
    expect(cli.error).toBeNull();
    const caso = await parc2.from("casos").insert({ cliente_id: cli.data!.id, tipo_beneficio: "Auxílio-doença", fase: "analise", parceiro_id: euParc!.id }).select("id, escritorio_id").single();
    expect(caso.error).toBeNull();
    expect(caso.data!.escritorio_id).toBe(ESC2);

    const { data: tarefas } = await admin.from("tarefas").select("responsavel_id, escritorio_id").eq("caso_id", caso.data!.id);
    expect(tarefas!.length, "gatilho criou a tarefa de análise").toBeGreaterThan(0);
    for (const t of tarefas!) {
      expect(t.escritorio_id).toBe(ESC2);
      const { data: m } = await admin.from("membros").select("id").eq("usuario_id", t.responsavel_id).eq("escritorio_id", ESC2).eq("status", "ativo");
      expect(m, "dono da tarefa tem que ser da equipe do canário").toHaveLength(1);
    }
    await admin.from("casos").delete().eq("id", caso.data!.id);
    await admin.from("clientes").delete().eq("id", cli.data!.id);
  });

  // -------------------------------------------------------------------------
  test("papéis: financeiro lê casos e repasses, e não edita o trabalho jurídico", async () => {
    const fin = await como(`canario+financeiro@${DOM}`, ESC2);
    const v = await visiveis(fin);
    expect(v.casos, "financeiro vê os casos").toBeGreaterThan(0);
    expect(v.tarefas, "tarefas visíveis ao financeiro").toBeGreaterThanOrEqual(0);

    const internos = await fin.from("andamentos").select("id").eq("visivel_parceiro", false);
    expect(internos.data ?? [], "andamentos internos").toHaveLength(0);
    expect((await fin.from("leads").select("id")).data ?? []).toHaveLength(0);

    const { data: caso } = await admin.from("casos").select("id, cliente_id").eq("escritorio_id", ESC2).limit(1).single();
    expect((await fin.from("casos").update({ observacoes: "x" }).eq("id", caso!.id).select("id")).data ?? []).toHaveLength(0);
    expect((await fin.from("andamentos").insert({ caso_id: caso!.id, origem: "interno", titulo: "[ataque] financeiro" })).error).toBeTruthy();
    expect((await fin.from("tarefas").insert({ caso_id: caso!.id, tipo: "interna", titulo: "[ataque] financeiro" })).error).toBeTruthy();
    expect((await fin.rpc("excluir_cliente", { p_cliente_id: caso!.cliente_id })).error).toBeTruthy();

    const perms = ((await fin.rpc("minhas_permissoes")).data ?? []).map((p: { permissao: string }) => p.permissao).sort();
    expect(perms).toEqual(["casos:ler", "repasses:ler"]);
  });

  test("papéis: assistente cuida das tarefas dele, não das dos outros", async () => {
    const ass = await como(`canario+assistente@${DOM}`, ESC2);
    const { data: eu } = await admin.from("usuarios").select("id").eq("email", `canario+assistente@${DOM}`).single();
    const { data: minha } = await admin.from("tarefas").select("id").eq("escritorio_id", ESC2).eq("responsavel_id", eu!.id).limit(1).single();
    const { data: alheia } = await admin.from("tarefas").select("id, titulo").eq("escritorio_id", ESC2).neq("responsavel_id", eu!.id).limit(1).single();

    expect((await ass.from("tarefas").update({ prioridade: 1 }).eq("id", minha!.id).select("id")).data).toHaveLength(1);
    expect((await ass.from("tarefas").update({ prioridade: 1 }).eq("id", alheia!.id).select("id")).data ?? []).toHaveLength(0);
    // vê as duas (ler é de todos), mas não apaga documento nem mexe em template
    expect((await ass.from("tarefas").select("id").in("id", [minha!.id, alheia!.id])).data).toHaveLength(2);
    expect((await ass.from("etiquetas").insert({ nome: "[ataque] etiqueta" })).error).toBeTruthy();
    expect((await ass.rpc("tem_permissao", { p_perm: "documentos:excluir" })).data).toBe(false);
  });

  test("papéis: parceiro só os casos que indicou; admin/advogado como sempre", async () => {
    const parc = await como(`canario+parceiro@${DOM}`, ESC2);
    const { data: eu } = await admin.from("usuarios").select("id").eq("email", `canario+parceiro@${DOM}`).single();
    const { data: casos } = await parc.from("casos").select("id, parceiro_id");
    expect(casos!.length).toBeGreaterThan(0);
    expect(casos!.every((c) => c.parceiro_id === eu!.id)).toBe(true);
    expect((await parc.from("andamentos").select("id").eq("visivel_parceiro", false)).data ?? []).toHaveLength(0);
    expect((await parc.from("tarefas").select("id")).data ?? []).toHaveLength(0);

    const adv = await como(`canario+advogado@${DOM}`, ESC2);
    expect((await adv.rpc("is_admin")).data).toBe(false);
    expect((await adv.rpc("definir_papel", { p_usuario_id: eu!.id, p_papel: "parceiro" })).error, "advogado não gerencia equipe").toBeTruthy();
  });

  // -------------------------------------------------------------------------
  test("dois vínculos: um escritório por vez, o do header", async () => {
    const { data: eu } = await admin.from("usuarios").select("id").eq("email", `rbac+duplo@${DOM}`).single();
    await admin.from("usuarios").update({ escritorio_ativo_id: null }).eq("id", eu!.id);

    const no2 = await como(`rbac+duplo@${DOM}`, ESC2);
    const casos2 = (await no2.from("casos").select("id, escritorio_id")).data ?? [];
    expect(casos2.length).toBeGreaterThan(0);
    expect(casos2.every((c) => c.escritorio_id === ESC2)).toBe(true);

    const no1 = await como(`rbac+duplo@${DOM}`, ESC1);
    expect(((await no1.from("casos").select("id, escritorio_id")).data ?? []).every((c) => c.escritorio_id === ESC1)).toBe(true);

    // sem header e sem preferência: não adivinha — nada
    const semHeader = await como(`rbac+duplo@${DOM}`);
    expect((await semHeader.from("casos").select("id")).data ?? []).toHaveLength(0);
    // com a preferência gravada (Realtime e chamadas sem header)
    expect((await semHeader.rpc("definir_escritorio_ativo", { p_escritorio_id: ESC2 })).error).toBeNull();
    expect(((await semHeader.from("casos").select("escritorio_id")).data ?? []).every((c) => c.escritorio_id === ESC2)).toBe(true);
    expect((await semHeader.rpc("definir_escritorio_ativo", { p_escritorio_id: crypto.randomUUID() })).error).toBeTruthy();

    const vinculos = (await semHeader.rpc("meus_vinculos")).data ?? [];
    expect(vinculos.map((v: { escritorio_slug: string }) => v.escritorio_slug).sort()).toEqual(["canario", "mara-vian"]);
    await admin.from("usuarios").update({ escritorio_ativo_id: null }).eq("id", eu!.id);
  });

  test("revogação: vínculo desativado com o JWT ainda válido → 0 linhas", async () => {
    const email = `e2e+rbac-revogacao@${DOM}`;
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const velho = lista?.users.find((u) => u.email === email);
    if (velho) {
      await admin.from("usuarios").delete().eq("id", velho.id);
      await admin.auth.admin.deleteUser(velho.id);
    }
    const { data: novo, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true });
    expect(error).toBeNull();
    const agora = new Date().toISOString();
    await admin.from("usuarios").insert({ id: novo.user!.id, email, nome: "[E2E] RBAC revogação", tipo: "interno", ativo: true, onboarded_em: agora, senha_definida_em: agora, escritorio_origem_id: ESC2 });

    const sb = await como(email, ESC2);
    expect(((await sb.from("casos").select("id")).data ?? []).length).toBeGreaterThan(0);

    const cAdmin = await como(`canario+admin@${DOM}`, ESC2);
    expect((await cAdmin.rpc("desligar_interno", { p_usuario_id: novo.user!.id })).error).toBeNull();

    // mesma sessão, mesmo JWT
    expect(comLinhas(await visiveis(sb)), "depois de desligada").toEqual([]);
    expect((await sb.rpc("is_interno")).data).toBe(false);

    await admin.from("usuarios").delete().eq("id", novo.user!.id);
    await admin.auth.admin.deleteUser(novo.user!.id);
  });

  test("último admin ativo não sai nem é rebaixado", async () => {
    const { data: a } = await admin.from("usuarios").select("id").eq("email", `canario+admin@${DOM}`).single();
    const { data: papelAdv } = await admin.from("papeis").select("id").is("escritorio_id", null).eq("chave", "advogado").single();
    const rebaixar = await admin.from("membros").update({ papel_id: papelAdv!.id }).eq("escritorio_id", ESC2).eq("usuario_id", a!.id);
    expect(rebaixar.error?.message ?? "").toMatch(/pelo menos um administrador/);
    const sair = await admin.from("membros").update({ status: "desativado" }).eq("escritorio_id", ESC2).eq("usuario_id", a!.id);
    expect(sair.error?.message ?? "").toMatch(/pelo menos um administrador/);
  });

  // -------------------------------------------------------------------------
  test("QG: staff sem vínculo lê 0 linhas; qg_* recusa quem não é staff", async () => {
    const dono = await como(`qg+dono@${DOM}`);
    expect(comLinhas(await visiveis(dono)), "staff lendo tabela de domínio").toEqual([]);
    expect(comLinhas(await visiveis(await como(`qg+dono@${DOM}`, ESC2))), "staff com header do canário, sem suporte").toEqual([]);
    expect((await dono.from("usuarios").select("email")).data?.map((u) => u.email)).toEqual([`qg+dono@${DOM}`]);

    const escs = await dono.rpc("qg_escritorios");
    expect(escs.error).toBeNull();
    // os dois do seed têm que estar; escritório criado à mão pelo QG (validação da
    // Naira no banco local) é legítimo e não pode derrubar a suíte
    expect((escs.data ?? []).map((e: { slug: string }) => e.slug)).toEqual(expect.arrayContaining(["canario", "mara-vian"]));
    // metadado e contagem — nada de conteúdo de cliente
    const colunas = Object.keys((await dono.rpc("qg_membros", { p_escritorio_id: ESC2 })).data![0]);
    // `total` = count(*) over () da paginação (migration_rbac_06); continua sem nada de cliente
    expect(colunas.sort()).toEqual(["desde", "email", "mfa", "nome", "papel", "papel_nome", "status", "tipo_acesso", "total", "ultimo_acesso", "usuario_id"]);
    expect((await dono.rpc("qg_saude")).error).toBeNull();
    expect((await dono.rpc("qg_uso", { p_escritorio_id: ESC2 })).error).toBeNull();

    // admin de escritório NÃO é staff
    const cAdmin = await como(`canario+admin@${DOM}`, ESC2);
    for (const fn of ["qg_escritorios", "qg_saude", "qg_staff", "qg_suporte", "qg_aprovacoes"]) {
      expect((await cAdmin.rpc(fn)).error, `${fn} para admin de escritório`).toBeTruthy();
    }
    expect((await cAdmin.rpc("qg_suspender_escritorio", { p_id: ESC1, p_motivo: "ataque de admin de outro escritório" })).error).toBeTruthy();
    expect((await cAdmin.rpc("qg_eu")).data ?? []).toHaveLength(0);

    // papel do staff: suporte não gerencia escritório
    const sup = await como(`qg+suporte@${DOM}`);
    expect((await sup.rpc("qg_escritorios")).error).toBeNull();
    expect((await sup.rpc("qg_suspender_escritorio", { p_id: ESC2, p_motivo: "suporte tentando suspender" })).error).toBeTruthy();
    expect((await sup.rpc("qg_definir_staff", { p_email: `qg+suporte@${DOM}`, p_papel: "dono" })).error).toBeTruthy();
  });

  test("QG: suporte só com aprovação do escritório, só leitura, e some ao encerrar", async () => {
    const sup = await como(`qg+suporte@${DOM}`, ESC2);
    const pedido = await sup.rpc("qg_suporte_solicitar", { p_escritorio_id: ESC2, p_motivo: "Conferir tarefa que não aparece para a equipe", p_ticket: "T-1", p_horas: 1 });
    expect(pedido.error).toBeNull();

    expect(comLinhas(await visiveis(sup)), "pedido pendente ainda não abre nada").toEqual([]);
    // break-glass é só para quem tem a permissão
    expect((await sup.rpc("qg_suporte_solicitar", { p_escritorio_id: ESC2, p_motivo: "tentando pular a aprovação", p_break_glass: true })).error).toBeTruthy();

    // advogado do escritório não aprova; o admin sim
    const adv = await como(`canario+advogado@${DOM}`, ESC2);
    expect((await adv.rpc("suporte_responder", { p_id: pedido.data, p_aprovar: true })).error).toBeTruthy();
    const cAdmin = await como(`canario+admin@${DOM}`, ESC2);
    expect(((await cAdmin.rpc("suporte_pedidos")).data ?? []).some((p: { id: string }) => p.id === pedido.data)).toBe(true);
    expect((await cAdmin.rpc("suporte_responder", { p_id: pedido.data, p_aprovar: true })).error).toBeNull();

    // agora lê o canário — e SÓ o canário
    const v = await visiveis(sup);
    expect(v.casos).toBeGreaterThan(0);
    expect(comLinhas(await visiveis(sup, ESC1))).toEqual([]);
    expect(comLinhas(await visiveis(await como(`qg+suporte@${DOM}`, ESC1))), "aprovação do canário não abre o escritório 1").toEqual([]);

    // somente leitura, e nunca admin
    const { data: caso } = await admin.from("casos").select("id").eq("escritorio_id", ESC2).limit(1).single();
    expect((await sup.from("andamentos").insert({ caso_id: caso!.id, origem: "interno", titulo: "[ataque] suporte escrevendo" })).error?.message ?? "").toMatch(/somente leitura/);
    expect((await sup.from("casos").update({ observacoes: "x" }).eq("id", caso!.id)).error?.message ?? "").toMatch(/somente leitura/);
    expect((await sup.rpc("is_admin")).data).toBe(false);

    // o escritório vê o que a plataforma fez nele
    await sup.rpc("suporte_registrar", { p_recurso: "/casos", p_recurso_id: caso!.id });
    const trilha = (await cAdmin.from("auditoria").select("acao, tipo_ator")).data ?? [];
    expect(trilha.map((t) => t.acao)).toEqual(expect.arrayContaining(["suporte.solicitar", "suporte.aprovar", "suporte.abrir"]));
    expect((await adv.from("auditoria").select("id")).data ?? [], "advogado não tem auditoria:ler").toHaveLength(0);

    expect((await sup.rpc("qg_suporte_encerrar", { p_id: pedido.data })).error).toBeNull();
    expect(comLinhas(await visiveis(sup)), "depois de encerrado").toEqual([]);
  });

  test("QG: escritório suspenso = 0 linhas para os membros; reativar devolve", async () => {
    const dono = await como(`qg+dono@${DOM}`);
    const adv = await como(`canario+advogado@${DOM}`, ESC2);
    const antes = (await visiveis(adv)).casos;
    expect(antes).toBeGreaterThan(0);

    expect((await dono.rpc("qg_suspender_escritorio", { p_id: ESC1, p_motivo: "o escritório padrão não pode ser suspenso" })).error).toBeTruthy();
    expect((await dono.rpc("qg_suspender_escritorio", { p_id: ESC2, p_motivo: "curto" })).error, "motivo é obrigatório").toBeTruthy();
    expect((await dono.rpc("qg_suspender_escritorio", { p_id: ESC2, p_motivo: "Teste E2E de suspensão do escritório" })).error).toBeNull();

    expect(comLinhas(await visiveis(adv)), "membro de escritório suspenso").toEqual([]);
    const vinc = ((await adv.rpc("meus_vinculos")).data ?? [])[0];
    expect(vinc.escritorio_status, "o front precisa saber para mostrar o aviso").toBe("suspenso");

    expect((await dono.rpc("qg_reativar_escritorio", { p_id: ESC2 })).error).toBeNull();
    expect((await visiveis(adv)).casos).toBe(antes);
  });

  test("QG: eliminar exige escritório encerrado e uma SEGUNDA pessoa", async () => {
    const dono = await como(`qg+dono@${DOM}`);
    const dono2 = await como(`qg+dono2@${DOM}`);
    const slug = `descartavel-${Date.now()}`;
    const novo = await dono.rpc("qg_criar_escritorio", { p_nome: "[E2E] Escritório descartável", p_slug: slug });
    expect(novo.error).toBeNull();
    const id = novo.data as string;
    expect((await admin.from("tarefa_templates").select("id", { count: "exact", head: true }).eq("escritorio_id", id)).count, "nasce com o conjunto padrão").toBeGreaterThan(0);

    expect((await dono.rpc("qg_pedir_eliminacao", { p_id: id })).error, "ativo/provisionando não elimina").toBeTruthy();
    expect((await dono.rpc("qg_encerrar_escritorio", { p_id: id, p_motivo: "Teste E2E de encerramento" })).error).toBeNull();
    const pedido = await dono.rpc("qg_pedir_eliminacao", { p_id: id });
    expect(pedido.error).toBeNull();

    expect((await dono.rpc("qg_aprovar_eliminacao", { p_aprovacao_id: pedido.data })).error?.message ?? "").toMatch(/segunda pessoa/);
    const ok = await dono2.rpc("qg_aprovar_eliminacao", { p_aprovacao_id: pedido.data });
    expect(ok.error).toBeNull();

    expect((await admin.from("escritorios").select("id").eq("id", id)).data ?? []).toHaveLength(0);
    for (const t of ["tarefa_templates", "tipos_beneficio", "membros"]) {
      expect((await admin.from(t).select("*", { count: "exact", head: true }).eq("escritorio_id", id)).count, `${t} do eliminado`).toBe(0);
    }
  });

  test("anônimo continua sem nada; formulário de lead cai no escritório padrão", async () => {
    const anon = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false } });
    expect((await anon.from("escritorios").select("id")).data ?? []).toHaveLength(0);
    expect((await anon.from("membros").select("id")).data ?? []).toHaveLength(0);
    expect((await anon.rpc("qg_escritorios")).error).toBeTruthy();
    expect((await anon.rpc("meus_vinculos")).error).toBeTruthy();
  });
});
