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
import { createClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const FN = `${ENV.supabaseUrl}/functions/v1`;

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

async function jwtDe(email: string): Promise<string> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return data.session.access_token;
}

async function chamar(nome: string, jwt: string, corpo: Record<string, unknown>) {
  const r = await fetch(`${FN}/${nome}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`, apikey: ENV.anonKey,
      "content-type": "application/json", "x-escritorio-id": ESC,
    },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, texto: (await r.text()).slice(0, 160) };
}

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
    const { data: esc } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    if (!esc) throw new Error("escritório Canário ausente — rode `bun run local:rbac`");
    ESC = esc.id as string;
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
    const jwt = await jwtDe(`canario+financeiro@${DOM}`);
    for (const fn of FUNCOES_DE_IA) {
      const r = await chamar(fn, jwt, corpoDe(fn));
      expect(r.status, `${fn} devia recusar o financeiro — respondeu ${r.status}: ${r.texto}`).toBe(403);
    }
  });

  test("parceiro não passa em nenhuma das seis (não é interno e não tem ia:usar)", async () => {
    const jwt = await jwtDe(`canario+parceiro@${DOM}`);
    for (const fn of FUNCOES_DE_IA) {
      const r = await chamar(fn, jwt, corpoDe(fn));
      expect(r.status, `${fn} devia recusar o parceiro — respondeu ${r.status}: ${r.texto}`).toBe(403);
    }
  });

  test("advogado passa da autorização nas seis", async () => {
    const jwt = await jwtDe(`canario+advogado@${DOM}`);
    for (const fn of FUNCOES_DE_IA) {
      const r = await chamar(fn, jwt, corpoDe(fn));
      expect(r.status, `${fn} recusou quem tem ia:usar — ${r.texto}`).not.toBe(403);
    }
  });

  test("tirar ia:usar do advogado fecha as seis na hora; devolver reabre", async () => {
    const { data: diego } = await admin.from("usuarios").select("id").eq("email", `canario+advogado@${DOM}`).single();
    const adm = createClient(ENV.supabaseUrl, ENV.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-escritorio-id": ESC } },
    });
    const { error: eLogin } = await adm.auth.signInWithPassword({
      email: `canario+admin@${DOM}`, password: ENV.internoPassword,
    });
    expect(eLogin).toBeNull();

    try {
      expect((await adm.rpc("definir_permissao_do_membro", {
        p_usuario_id: diego!.id, p_permissao: "ia:usar", p_estado: "remover",
      })).error).toBeNull();

      // o mesmo JWT de antes: a permissão é lida no servidor a cada chamada
      const jwt = await jwtDe(`canario+advogado@${DOM}`);
      for (const fn of FUNCOES_DE_IA) {
        const r = await chamar(fn, jwt, corpoDe(fn));
        expect(r.status, `${fn} devia recusar depois do ajuste — ${r.texto}`).toBe(403);
      }

      expect((await adm.rpc("definir_permissao_do_membro", {
        p_usuario_id: diego!.id, p_permissao: "ia:usar", p_estado: "papel",
      })).error).toBeNull();
      const depois = await chamar("ia-analise", jwt, corpoDe("ia-analise"));
      expect(depois.status, "voltou ao papel, a porta reabre").not.toBe(403);
    } finally {
      await admin.from("membro_permissoes").delete().eq("escritorio_id", ESC);
    }
  });
});
