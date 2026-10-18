// E2E: o que MUDA ACESSO ou APAGA DADO deixa rastro — as trilhas das
// migration_rbac_25 e 26.
//
// Por que esta spec existe: em 27/09 a troca de papel de uma pessoa foi aceita
// e não deixou registro nenhum. Conceder UMA permissão já era auditado desde a
// migration_rbac_20, mas trocar o PAPEL — que muda as 26 de uma vez — não era,
// e as reativações ainda APAGAVAM o `desativado_por` da linha, o único rastro
// que restava do desligamento. O conserto saiu com prova em script
// descartável; sem esta spec, a próxima reescrita dessas funções perde a
// trilha e ninguém percebe (planning/AUDITABILIDADE.md).
//
// Cobre, além das trilhas, três RPCs que nenhuma spec exercitava:
// `desligar_parceiro`, `reativar_parceiro` e `reativar_interno`.
//
// Só no banco local/staging com o seed do Canário (`bun run local:rbac`).
import { test, expect } from "@playwright/test";
import { adminClient } from "../supabase-admin";
import {
  clienteComo, contaDoCanario, contaPadrao, escritorioCanario, escritorioPadrao,
  idDoCanario, ultimaLinhaDaTrilha,
} from "../rbac";

const admin = adminClient();
const MARCA = "[E2E trilha]";

let ESC: string;
let ESC1: string;
let carla: string;
let diego: string;
let elisa: string;
let gilda: string;
let fabio: string;

/** Cliente descartável com N casos, para as cenas destrutivas. */
async function clienteDescartavel(casos: number) {
  const { data: tb } = await admin.from("tipos_beneficio").select("chave").eq("escritorio_id", ESC).limit(1).maybeSingle();
  const { data: cli, error } = await admin.from("clientes").insert({
    escritorio_id: ESC, nome: `${MARCA} cliente`, cpf: String(Date.now()).slice(0, 11),
  }).select("id").single();
  if (error) throw new Error(`cliente descartável: ${error.message}`);
  for (let i = 0; i < casos; i++) {
    const { error: e } = await admin.from("casos").insert({
      escritorio_id: ESC, cliente_id: cli.id, fase: "analise",
      tipo_beneficio: tb?.chave ?? "aposentadoria_idade",
    });
    if (e) throw new Error(`caso descartável: ${e.message}`);
  }
  return cli.id as string;
}

async function limpar() {
  if (!ESC) return; // beforeAll não chegou a rodar
  await admin.from("auditoria").delete().eq("escritorio_id", ESC).like("detalhes->>nome", `${MARCA}%`);
  await admin.from("documentos_excluidos").delete().like("nome_arquivo", `${MARCA}%`);
  await admin.from("andamentos_excluidos").delete().like("titulo", `${MARCA}%`);
  const { data: clis } = await admin.from("clientes").select("id").like("nome", `${MARCA}%`);
  for (const c of clis ?? []) {
    const { data: casos } = await admin.from("casos").select("id").eq("cliente_id", c.id);
    for (const caso of casos ?? []) {
      await admin.from("documentos").delete().eq("caso_id", caso.id);
      await admin.from("andamentos").delete().eq("caso_id", caso.id);
      await admin.from("tarefas").delete().eq("caso_id", caso.id);
    }
    await admin.from("casos").delete().eq("cliente_id", c.id);
    await admin.from("clientes").delete().eq("id", c.id);
  }
}

test.describe.serial("trilha de quem mudou acesso e de quem apagou", () => {
  test.beforeAll(async () => {
    ESC = await escritorioCanario();
    ESC1 = await escritorioPadrao();
    carla = await idDoCanario("admin");
    diego = await idDoCanario("advogado");
    elisa = await idDoCanario("assistente");
    gilda = await idDoCanario("parceiro");
    fabio = await idDoCanario("financeiro");
    await limpar();
  });

  test.afterAll(async () => {
    await limpar();
    // papéis e status de volta ao que o seed deixa
    const papel = async (chave: string) =>
      (await admin.from("papeis").select("id").is("escritorio_id", null).eq("chave", chave).single()).data!.id;
    await admin.from("membros").update({ papel_id: await papel("advogado") }).eq("escritorio_id", ESC).eq("usuario_id", diego);
    await admin.from("membros").update({ papel_id: await papel("assistente"), status: "ativo", desativado_em: null, desativado_por: null }).eq("escritorio_id", ESC).eq("usuario_id", elisa);
    await admin.from("membros").update({ status: "ativo", desativado_em: null, desativado_por: null }).eq("escritorio_id", ESC).eq("usuario_id", gilda);
    await admin.from("membro_permissoes").delete().eq("escritorio_id", ESC);
    for (const id of [elisa, gilda]) await admin.auth.admin.updateUserById(id, { ban_duration: "none" }).catch(() => {});
  });

  test("trocar o papel registra de → para, e quantos ajustes caíram", async () => {
    const adm = await clienteComo(contaDoCanario("admin"), ESC);
    // um ajuste individual para provar que a contagem sai certa
    expect((await adm.rpc("definir_permissao_do_membro", {
      p_usuario_id: diego, p_permissao: "clientes:excluir", p_estado: "conceder",
    })).error).toBeNull();

    expect((await adm.rpc("definir_papel", { p_usuario_id: diego, p_papel: "assistente" })).error).toBeNull();

    const l = await ultimaLinhaDaTrilha(ESC, "equipe.papel_alterado");
    expect(l, "a troca de papel tem de deixar linha").not.toBeNull();
    expect(l!.detalhes.de).toBe("advogado");
    expect(l!.detalhes.para).toBe("assistente");
    expect(l!.detalhes.usuario_id).toBe(diego);
    expect(l!.detalhes.ajustes_removidos, "o ajuste individual caiu com a troca").toBe(1);

    // volta, e a volta também fica registrada
    expect((await adm.rpc("definir_papel", { p_usuario_id: diego, p_papel: "advogado" })).error).toBeNull();
    expect((await ultimaLinhaDaTrilha(ESC, "equipe.papel_alterado"))!.detalhes.para).toBe("advogado");
  });

  test("desligar e reativar interno: a trilha sobrevive à reativação que apaga o rastro da linha", async () => {
    const adm = await clienteComo(contaDoCanario("admin"), ESC);

    // Desligar MOVE as tarefas abertas da pessoa, e reativar não as devolve.
    // Sem guardar quais eram, esta spec deixava a assistente sem tarefa e
    // quebrava a `rbac-isolamento`, que confere exatamente isso — teste que
    // suja o ambiente do vizinho é teste ruim, mesmo passando.
    const { data: antesTarefas } = await admin.from("tarefas")
      .select("id").eq("escritorio_id", ESC).eq("responsavel_id", elisa)
      .in("status", ["a_fazer", "fazendo"]);
    const devolver = (antesTarefas ?? []).map((t) => t.id as string);

    const r = await adm.rpc("desligar_interno", { p_usuario_id: elisa, p_novo_responsavel_id: diego });
    expect(r.error).toBeNull();

    const desl = await ultimaLinhaDaTrilha(ESC, "equipe.desligado");
    expect(desl, "o desligamento tem de deixar linha").not.toBeNull();
    expect(desl!.detalhes.usuario_id).toBe(elisa);
    expect(desl!.detalhes.assumiu).toBe(diego);
    expect(typeof desl!.detalhes.tarefas_movidas).toBe("number");

    // a linha do vínculo guarda quem desativou…
    const { data: antes } = await admin.from("membros").select("desativado_por").eq("escritorio_id", ESC).eq("usuario_id", elisa).single();
    expect(antes!.desativado_por).toBe(carla);

    expect((await adm.rpc("reativar_interno", { p_usuario_id: elisa })).error).toBeNull();

    // …e a reativação APAGA esse rastro da linha — é por isso que a trilha importa
    const { data: depois } = await admin.from("membros").select("desativado_por, status").eq("escritorio_id", ESC).eq("usuario_id", elisa).single();
    expect(depois!.desativado_por, "a reativação limpa a coluna").toBeNull();
    expect(depois!.status).toBe("ativo");
    expect(await ultimaLinhaDaTrilha(ESC, "equipe.desligado"), "mas a trilha continua lá").not.toBeNull();
    const rea = await ultimaLinhaDaTrilha(ESC, "equipe.reativado");
    expect(rea).not.toBeNull();
    expect(rea!.detalhes.papel, "volta com o papel que tinha").toBe("assistente");

    // devolve as tarefas que o desligamento moveu
    if (devolver.length > 0) {
      const { error } = await admin.from("tarefas").update({ responsavel_id: elisa }).in("id", devolver);
      expect(error, "devolver as tarefas movidas").toBeNull();
    }
  });

  test("desligar e reativar parceiro: registra, e quem não gerencia parceiros é recusado", async () => {
    const assistente = await clienteComo(contaDoCanario("assistente"), ESC);
    const semPermissao = await assistente.rpc("desligar_parceiro", { p_usuario_id: gilda });
    expect(semPermissao.error?.message ?? "", "assistente não tem parceiros:gerenciar").toMatch(/[Ss]em permissão/);

    const adv = await clienteComo(contaDoCanario("advogado"), ESC);
    const r = await adv.rpc("desligar_parceiro", { p_usuario_id: gilda });
    expect(r.error, "advogado gerencia parceiros").toBeNull();
    const desl = await ultimaLinhaDaTrilha(ESC, "parceiro.desligado");
    expect(desl).not.toBeNull();
    expect(desl!.detalhes.usuario_id).toBe(gilda);
    expect(typeof desl!.detalhes.casos_preservados, "diz quantos casos ficaram").toBe("number");

    expect((await adv.rpc("reativar_parceiro", { p_usuario_id: gilda })).error).toBeNull();
    expect(await ultimaLinhaDaTrilha(ESC, "parceiro.reativado")).not.toBeNull();
  });

  test("excluir cliente registra nome e quantos casos foram junto", async () => {
    const cliente = await clienteDescartavel(2);
    const adm = await clienteComo(contaDoCanario("admin"), ESC);
    const r = await adm.rpc("excluir_cliente", { p_cliente_id: cliente });
    expect(r.error).toBeNull();

    const l = await ultimaLinhaDaTrilha(ESC, "cliente.excluido");
    expect(l, "a exclusão irreversível tem de deixar linha").not.toBeNull();
    expect(l!.detalhes.nome).toContain(MARCA);
    expect(l!.detalhes.casos, "os dois casos contados").toBe(2);
    // e o cliente foi mesmo
    expect((await admin.from("clientes").select("id").eq("id", cliente)).data ?? []).toHaveLength(0);
  });

  test("apagar documento e andamento deixa a linha inteira, e ninguém escreve na trilha", async () => {
    const cliente = await clienteDescartavel(1);
    const { data: caso } = await admin.from("casos").select("id").eq("cliente_id", cliente).limit(1).single();
    const { data: doc } = await admin.from("documentos").insert({
      caso_id: caso!.id, escritorio_id: ESC, tipo: "outro",
      nome_arquivo: `${MARCA} CNIS.pdf`, storage_path: `e2e-trilha/${caso!.id}/cnis.pdf`,
    }).select("id").single();
    const { data: and } = await admin.from("andamentos").insert({
      caso_id: caso!.id, escritorio_id: ESC, titulo: `${MARCA} andamento`,
      descricao: "linha do tempo", origem: "interno", data_evento: new Date().toISOString(),
    }).select("id").single();

    const adv = await clienteComo(contaDoCanario("advogado"), ESC);
    expect((await adv.from("documentos").delete().eq("id", doc!.id).select("id")).data ?? []).toHaveLength(1);
    expect((await adv.from("andamentos").delete().eq("id", and!.id).select("id")).data ?? []).toHaveLength(1);

    const td = await adv.from("documentos_excluidos").select("nome_arquivo, excluido_por, dados").eq("documento_id", doc!.id).maybeSingle();
    expect(td.data, "documento apagado tem de virar linha na trilha").not.toBeNull();
    expect(td.data!.excluido_por).toBe(diego);
    expect((td.data!.dados as { storage_path?: string }).storage_path, "a linha inteira fica guardada").toContain("e2e-trilha/");

    const ta = await adv.from("andamentos_excluidos").select("titulo, excluido_por").eq("andamento_id", and!.id).maybeSingle();
    expect(ta.data, "andamento apagado também").not.toBeNull();
    expect(ta.data!.excluido_por).toBe(diego);

    // a trilha não se escreve nem se apaga de fora: quem tenta leva 42501
    const escrita = await adv.from("documentos_excluidos").insert({
      documento_id: doc!.id, dados: {}, escritorio_id: ESC,
    }).select("id");
    expect(escrita.error?.code, "escrever na trilha é recusado").toBe("42501");
    const apagar = await adv.from("documentos_excluidos").delete().eq("documento_id", doc!.id).select("id");
    expect(apagar.error?.code ?? "sem erro", "apagar da trilha é recusado").toBe("42501");

    // e não atravessa escritório
    const deOutro = await clienteComo(contaPadrao("admin"), ESC1);
    expect((await deOutro.from("documentos_excluidos").select("id").eq("documento_id", doc!.id)).data ?? [],
      "trilha de outro escritório não aparece").toHaveLength(0);

    // parceiro não lê a trilha (é da equipe interna, como tarefas_excluidas)
    const parc = await clienteComo(contaDoCanario("parceiro"), ESC);
    expect((await parc.from("documentos_excluidos").select("id")).data ?? [], "parceiro não lê a trilha").toHaveLength(0);
    // financeiro é interno: lê
    const fin = await clienteComo(contaDoCanario("financeiro"), ESC);
    expect((await fin.from("documentos_excluidos").select("id").eq("documento_id", doc!.id)).data ?? [],
      "financeiro é interno e lê").toHaveLength(1);
    expect(fabio).toBeTruthy();
  });
});
