// E2E: as SEIS functions de IA exigem `ia:usar` no SERVIDOR, não só na tela.
//
// Por que esta spec existe: até 24/09 a tela era o único freio — a API
// respondia a qualquer pessoa autenticada (planning/RBAC_CLASSE_INVERSA.md). O
// conserto pôs `permissao: "ia:usar"` em seis functions, e a suíte cobria UMA
// (`ia-analise`, em rbac-edge-functions). As outras cinco podiam perder a
// exigência numa reescrita e nada acusaria.
//
// Quem tem `ia:usar` (matriz §4.3): admin, advogado, assistente.
// Quem não tem: financeiro e parceiro — e parceiro nem é interno.
//
// A asserção é sobre a AUTORIZAÇÃO, não sobre a IA: quem não pode leva 403;
// quem pode passa da porta (qualquer coisa MENOS 403 — sem chave de IA no
// escritório a function responde 412/404/500, e isso já prova que autorizou).
//
// Só no banco local/staging com o seed do Canário (`bun run local:rbac`).
import { test, expect } from "@playwright/test";
import { adminClient } from "../supabase-admin";
import {
  chamarFuncao, clienteComo, contaDoCanario, escritorioCanario, idDoCanario, sessaoComo,
} from "../rbac";

const admin = adminClient();

/** As seis, com um corpo mínimo que chega até a checagem de permissão. */
const FUNCOES_DE_IA = [
  "ia-analise",
  "ia-assistant",
  "ia-triagem-andamentos",
  "sugerir-proxima-tarefa",
  "mensagem-parceiro-exigencia",
  "extrair-agendamento-pericia",
] as const;

let ESC: string;
let casoId: string;
let tarefaId: string;

const jwtDe = async (papel: Parameters<typeof contaDoCanario>[0]) =>
  (await sessaoComo(contaDoCanario(papel), ESC)).jwt;

const chamar = async (nome: string, jwt: string, corpo: Record<string, unknown>) => {
  const r = await chamarFuncao(nome, jwt, ESC, corpo);
  return { status: r.status, texto: r.texto.slice(0, 160) };
};

/** Corpo por function: o suficiente para passar do parse e chegar na permissão. */
function corpoDe(nome: string): Record<string, unknown> {
  switch (nome) {
    case "ia-analise": return { caso_id: casoId };
    case "ia-assistant": return { caso_id: casoId, mensagem: "e aí?" };
    case "ia-triagem-andamentos": return { caso_id: casoId };
    case "sugerir-proxima-tarefa": return { tarefa_id: tarefaId };
    case "mensagem-parceiro-exigencia": return { caso_id: casoId, exigencia: "documento faltando" };
    case "extrair-agendamento-pericia": return { caso_id: casoId, texto: "perícia dia 10/10 às 14h" };
    default: return {};
  }
}

test.describe("IA: a permissão é cobrada no servidor", () => {
  test.beforeAll(async () => {
    ESC = await escritorioCanario();
    const { data: caso } = await admin.from("casos").select("id").eq("escritorio_id", ESC).limit(1).single();
    casoId = caso!.id as string;
    const { data: tarefa } = await admin.from("tarefas").select("id").eq("escritorio_id", ESC).limit(1).maybeSingle();
    if (tarefa) {
      tarefaId = tarefa.id as string;
    } else {
      const { data: nova } = await admin.from("tarefas").insert({
        escritorio_id: ESC, caso_id: casoId, titulo: "[E2E ia] tarefa", tipo: "interna",
      }).select("id").single();
      tarefaId = nova!.id as string;
    }
  });

  test.afterAll(async () => {
    await admin.from("tarefas").delete().like("titulo", "[E2E ia]%");
  });

  test("financeiro não passa em nenhuma das seis (não tem ia:usar)", async () => {
    const jwt = await jwtDe("financeiro");
    for (const fn of FUNCOES_DE_IA) {
      const r = await chamar(fn, jwt, corpoDe(fn));
      expect(r.status, `${fn} devia recusar o financeiro — respondeu ${r.status}: ${r.texto}`).toBe(403);
    }
  });

  test("parceiro não passa em nenhuma das seis (não é interno e não tem ia:usar)", async () => {
    const jwt = await jwtDe("parceiro");
    for (const fn of FUNCOES_DE_IA) {
      const r = await chamar(fn, jwt, corpoDe(fn));
      expect(r.status, `${fn} devia recusar o parceiro — respondeu ${r.status}: ${r.texto}`).toBe(403);
    }
  });

  test("advogado passa da autorização nas seis", async () => {
    const jwt = await jwtDe("advogado");
    for (const fn of FUNCOES_DE_IA) {
      const r = await chamar(fn, jwt, corpoDe(fn));
      expect(r.status, `${fn} recusou quem tem ia:usar — ${r.texto}`).not.toBe(403);
    }
  });

  test("tirar ia:usar do advogado fecha as seis na hora; devolver reabre", async () => {
    const diegoId = await idDoCanario("advogado");
    const adm = await clienteComo(contaDoCanario("admin"), ESC);

    try {
      expect((await adm.rpc("definir_permissao_do_membro", {
        p_usuario_id: diegoId, p_permissao: "ia:usar", p_estado: "remover",
      })).error).toBeNull();

      // o mesmo JWT de antes: a permissão é lida no servidor a cada chamada
      const jwt = await jwtDe("advogado");
      for (const fn of FUNCOES_DE_IA) {
        const r = await chamar(fn, jwt, corpoDe(fn));
        expect(r.status, `${fn} devia recusar depois do ajuste — ${r.texto}`).toBe(403);
      }

      expect((await adm.rpc("definir_permissao_do_membro", {
        p_usuario_id: diegoId, p_permissao: "ia:usar", p_estado: "papel",
      })).error).toBeNull();
      const depois = await chamar("ia-analise", jwt, corpoDe("ia-analise"));
      expect(depois.status, "voltou ao papel, a porta reabre").not.toBe(403);
    } finally {
      await admin.from("membro_permissoes").delete().eq("escritorio_id", ESC);
    }
  });
});
