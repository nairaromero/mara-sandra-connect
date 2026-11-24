// E2E: o nome do cliente fica em CAIXA ALTA, digite como digitar
// (migration_clientes_nome_caixa_alta, pedido da Naira em 23/11).
//
// O gatilho é do banco, então a prova é pela API com a sessão de quem cadastra:
// a equipe cria e edita; o parceiro edita o cliente do caso dele.
//
// Só no banco local.
import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import { clienteComo, contaDoCanario, escritorioCanario, idDoCanario, limpezaLocal } from "../rbac";

const admin = adminClient();
const CPF = `999${String(Date.now()).slice(-8)}`;
let ESC: string;
let CRIADO: string | null = null;
let DO_PARCEIRO: { id: string; nome: string } | null = null;

test.beforeAll(async () => {
  test.skip(!ENV.local, "só no banco local");
  ESC = await escritorioCanario();
});

test.afterAll(limpezaLocal(async () => {
  if (CRIADO) await admin.from("clientes").delete().eq("id", CRIADO);
  // o nome antigo volta pela service role; o gatilho deixa em caixa alta, que é o padrão agora
  if (DO_PARCEIRO) await admin.from("clientes").update({ nome: DO_PARCEIRO.nome }).eq("id", DO_PARCEIRO.id);
}));

test("a equipe cadastra e edita em caixa baixa ou alternada; fica em caixa alta", async () => {
  const sb = await clienteComo(contaDoCanario("admin"), ESC);
  const ins = await sb.from("clientes").insert({ nome: "  joão dA sIlva  ", cpf: CPF }).select("id, nome").single();
  expect(ins.error).toBeNull();
  CRIADO = ins.data!.id as string;
  expect(ins.data!.nome).toBe("JOÃO DA SILVA");

  const upd = await sb.from("clientes").update({ nome: "Conceição de Araújo" }).eq("id", CRIADO).select("nome").single();
  expect(upd.error).toBeNull();
  expect(upd.data!.nome).toBe("CONCEIÇÃO DE ARAÚJO");
});

test("o parceiro edita o cliente do caso dele; fica em caixa alta", async () => {
  const parceiro = await idDoCanario("parceiro");
  const caso = await admin.from("casos").select("cliente_id, clientes(nome)").eq("parceiro_id", parceiro).limit(1).single();
  expect(caso.error).toBeNull();
  const clienteId = caso.data!.cliente_id as string;
  DO_PARCEIRO = { id: clienteId, nome: (caso.data!.clientes as unknown as { nome: string }).nome };

  const sb = await clienteComo(contaDoCanario("parceiro"), ESC);
  const upd = await sb.from("clientes").update({ nome: "maria das dores" }).eq("id", clienteId).select("nome").single();
  expect(upd.error).toBeNull();
  expect(upd.data!.nome).toBe("MARIA DAS DORES");
});
