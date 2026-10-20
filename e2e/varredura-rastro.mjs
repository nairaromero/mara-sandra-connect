// A varredura do rastro em caso EMPRESTADO — UM lugar só, para os dois lados.
//
// Por que é .mjs e não .ts: quem precisa dela são as SPECS (TypeScript, pelo
// Playwright) e os FILMES (`e2e/demo/**/*.cjs`, rodados pelo node puro). Um
// módulo ESM atende os dois — a spec importa normalmente e o filme carrega com
// `await import(...)` de dentro de uma função async. Duplicar código que APAGA
// dado em cliente real é exatamente o que não se quer em dois lugares (#445).
//
// O problema que ela resolve: a convenção é que todo dado de teste pendura num
// cliente `[E2E]`. Ela falha quando a TELA cria algo num caso que o teste não
// semeou — a tarefa nasce de um template e leva o nome do CLIENTE REAL
// ("Analise de Indeferimento - Cliente 001327"), sem marcador nenhum. Em 29/09
// havia cinco dessas no staging, mais um relógio aberto por uma delas; é o que
// a Naira via ao abrir o staging para validar. Os filmes nunca passaram por
// aqui, e são a origem mais provável daquelas linhas (#445).
//
// Segurança, porque isto apaga em caso de cliente real:
//  - só em caso que RECEBEU escrita de conta de teste (`created_by`) DEPOIS do
//    início da rodada — não varre caso que ninguém tocou;
//  - a janela de tempo exclui o que já existia e o que vier depois;
//  - some SÓ com linha de autor de teste. A 1ª versão apagava tudo que
//    nascesse na janela naquele caso e levou junto linha de OUTRA pessoa;
//  - recusa rodar contra o projeto de produção, com erro alto.
//
// A régua dos dois lados é `e2e/tests/limpeza-caso-emprestado.spec.ts`.

export const MARCADOR = "[E2E]";

/** Projeto de PRODUÇÃO. A varredura por autor nunca pode rodar contra ele. */
export const REF_PRODUCAO = "llugytkdsfsrciavhrfw";

/** Tabelas com `created_by` — as três que vazaram de verdade no staging. */
const TABELAS = ["tarefas", "agenda_eventos", "relogios_prazo"];

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin client service-role
 * @param {{ url: string, inicio: string, de?: string }} opts
 *   url    endereço do projeto-alvo (a trava de produção lê daqui)
 *   inicio ISO do começo da rodada: nada criado antes disso é tocado
 *   de     rótulo de quem chamou, para o aviso ("suíte" ou "filme")
 * @returns {Promise<number>} linhas apagadas
 */
export async function varrerRastroEmCasosEmprestados(admin, opts) {
  const { url, inicio, de = "cleanup" } = opts ?? {};
  if (!url || !inicio) throw new Error("varredura: faltou `url` ou `inicio`");
  if (url.includes(REF_PRODUCAO)) {
    throw new Error("varredura por autor NUNCA roda contra produção — alvo: " + url);
  }

  const { data: contas, error: eC } = await admin
    .from("usuarios")
    .select("id")
    .or("email.like.e2e+%,email.like.canario+%");
  if (eC) throw new Error(`contas de teste: ${eC.message}`);
  const contaIds = (contas ?? []).map((c) => c.id);
  if (contaIds.length === 0) return 0;

  // 1. casos que receberam escrita de conta de teste nesta rodada
  const casos = new Set();
  for (const tabela of TABELAS) {
    const { data, error } = await admin
      .from(tabela)
      .select("caso_id")
      .in("created_by", contaIds)
      .gte("created_at", inicio);
    if (error) throw new Error(`rastro em ${tabela}: ${error.message}`);
    for (const l of data ?? []) if (l.caso_id) casos.add(l.caso_id);
  }
  if (casos.size === 0) return 0;

  // 2. desses, fica só o que NÃO é de cliente [E2E] (o cleanup normal já pega)
  const { data: doTeste, error: eT } = await admin
    .from("casos")
    .select("id, cliente:cliente_id(nome)")
    .in("id", [...casos]);
  if (eT) throw new Error(`casos do rastro: ${eT.message}`);
  const emprestados = (doTeste ?? [])
    .filter((c) => !String(c.cliente?.nome ?? "").startsWith(MARCADOR))
    .map((c) => c.id);
  if (emprestados.length === 0) return 0;

  // 3. some SÓ com o que tem autor de teste.
  let apagados = 0;
  const achados = [];
  const tarefasApagadas = [];
  for (const tabela of TABELAS) {
    // `titulo` junto: sem ele o aviso diz QUANTAS linhas e não QUAIS, e aí
    // descobrir a origem vira caçada. Nem toda tabela tem título.
    const { data: alvo, error: eA } = await admin
      .from(tabela)
      .select(tabela === "relogios_prazo" ? "id, caso_id" : "id, caso_id, titulo")
      .in("caso_id", emprestados)
      .in("created_by", contaIds)
      .gte("created_at", inicio);
    if (eA) {
      console.warn(`varredura ${tabela}: ${eA.message}`);
      continue;
    }
    const ids = (alvo ?? []).map((l) => l.id);
    if (ids.length === 0) continue;
    for (const l of alvo ?? []) achados.push(`${tabela}: ${l.titulo ?? l.id}`);

    // dependentes primeiro, presos ao id — não ao caso, senão volta o excesso
    if (tabela === "tarefas") {
      await admin.from("pedidos_prorrogacao").delete().in("tarefa_id", ids);
      tarefasApagadas.push(...ids);
    }
    const { error: eD } = await admin.from(tabela).delete().in("id", ids);
    if (eD) {
      console.warn(`varredura ${tabela}: ${eD.message}`);
      continue;
    }
    apagados += ids.length;
  }
  // o gatilho AFTER DELETE em tarefas escreve aqui; é rastro do próprio cleanup
  if (tarefasApagadas.length > 0) {
    await admin.from("tarefas_excluidas").delete().in("tarefa_id", tarefasApagadas);
  }
  if (apagados > 0) {
    // alto de propósito: é sintoma de escrita em caso que ninguém semeou
    console.warn(
      `[${de}] ${apagados} linha(s) de teste em ${emprestados.length} caso(s) de cliente REAL: ` +
        achados.slice(0, 8).join(" · ") +
        (achados.length > 8 ? ` (+${achados.length - 8})` : "") +
        ". Algo criou dado num caso que não semeou — ver e2e/varredura-rastro.mjs.",
    );
  }
  return apagados;
}
