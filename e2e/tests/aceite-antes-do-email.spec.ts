// E2E do #249: parceiro sem aceite dos termos não recebe dado de cliente.
//
// Quem não assinou os termos vigentes recebe, no lugar do e-mail do caso, um
// aviso genérico ("há novidades, entre e assine os termos") — sem nome de
// cliente nem texto do andamento — e no máximo UM por dia. Depois de assinar,
// volta a receber o e-mail normal.
//
// Só no banco local, com o mock dos provedores (:8787) fazendo o papel do
// Resend: `node e2e/demo/mocks/provedores.cjs`. Cria parceiro, cliente, caso e
// andamento próprios e apaga tudo no fim.

import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient, cpfValido } from "../supabase-admin";
import { chamarComoSistema, escritorioPadrao, limpezaLocal, segredoDeSistemaLocal } from "../rbac";
import { TERMOS_VERSAO } from "../../supabase/functions/_shared/termos";

const admin = adminClient();
const MOCK = "http://localhost:8787";
const EMAIL = "e2e+semaceite@marasandraconnect.com";
const CLIENTE = "[E2E aceite] Cliente Sigiloso";
const TITULO = "[E2E aceite] Perícia designada";

interface EmailMock { to: string | string[]; subject: string; html: string; text?: string; recebido_em: string }
// Só os desta rodada: o mock guarda o que recebeu desde que subiu (e não dá
// para zerá-lo no meio da suíte sem atrapalhar outra spec).
let INICIO = "";
async function emailsPara(email: string): Promise<EmailMock[]> {
  const r = await fetch(`${MOCK}/_emails`).then((x) => x.json()) as { emails: EmailMock[] };
  return r.emails.filter((e) => [e.to].flat().includes(email) && e.recebido_em >= INICIO);
}

let ESC: string;
let PARCEIRO: string | null = null;
let CLIENTE_ID: string | null = null;
let CASO: string | null = null;
let ANDAMENTO: string | null = null;

async function limpar() {
  if (CASO) {
    await admin.from("whatsapp_outbox").delete().eq("caso_id", CASO);
    await admin.from("andamentos").delete().eq("caso_id", CASO);
    await admin.from("casos").delete().eq("id", CASO);
  }
  if (CLIENTE_ID) await admin.from("clientes").delete().eq("id", CLIENTE_ID);
  const { data: u } = await admin.from("usuarios").select("id").eq("email", EMAIL).maybeSingle();
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = (u?.id as string | undefined) ?? lista?.users.find((x) => x.email === EMAIL)?.id;
  if (id) {
    await admin.from("usuarios").delete().eq("id", id); // avisos_aceite_pendente vai junto (cascade)
    await admin.auth.admin.deleteUser(id);
  }
}

const notificar = () =>
  chamarComoSistema("notify-novo-andamento", "pgnet:notify-novo-andamento", { andamento_id: ANDAMENTO });

test.describe.serial("parceiro sem aceite dos termos (#249)", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local || !segredoDeSistemaLocal(), "só no local, com MSC_SYSTEM_SECRET no supabase/functions/.env");
    const vivo = await fetch(`${MOCK}/_health`).then((r) => r.ok).catch(() => false);
    test.skip(!vivo, "mock dos provedores (:8787) fora do ar");
    ESC = await escritorioPadrao();
    await limpar();
    INICIO = new Date().toISOString();

    const { data: au, error: eAu } = await admin.auth.admin.createUser({ email: EMAIL, password: ENV.parceiroPassword, email_confirm: true });
    if (eAu || !au.user) throw new Error(`parceiro descartável: ${eAu?.message}`);
    PARCEIRO = au.user.id;
    // Convidado que ainda não entrou: sem onboarded_em, sem versão.
    const { error: eU } = await admin.from("usuarios").upsert({
      id: PARCEIRO, email: EMAIL, nome: "[E2E aceite] Parceira", tipo: "parceiro", eh_parceiro: true, ativo: true,
      onboarded_em: null, termos_versao: null,
    });
    if (eU) throw new Error(`perfil: ${eU.message}`);
    const { data: cli, error: eC } = await admin.from("clientes").insert({ escritorio_id: ESC, nome: CLIENTE, cpf: cpfValido() }).select("id").single();
    if (eC) throw new Error(`cliente: ${eC.message}`);
    CLIENTE_ID = cli.id;
    const { data: caso, error: eCa } = await admin.from("casos").insert({
      escritorio_id: ESC, cliente_id: CLIENTE_ID, parceiro_id: PARCEIRO, fase: "analise", tipo_beneficio: "aposentadoria_idade",
    }).select("id").single();
    if (eCa) throw new Error(`caso: ${eCa.message}`);
    CASO = caso.id;
    const { data: and, error: eA } = await admin.from("andamentos").insert({
      caso_id: CASO, origem: "interno", titulo: TITULO, descricao: "texto que só quem assinou pode ler",
      data_evento: new Date().toISOString(), visivel_parceiro: true,
    }).select("id").single();
    if (eA) throw new Error(`andamento: ${eA.message}`);
    ANDAMENTO = and.id;
  });
  test.afterAll(limpezaLocal(limpar));

  test("sem aceite: vai o aviso genérico, sem o nome do cliente nem o andamento", async () => {
    const r = await notificar();
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    expect(r.json).toMatchObject({ enviado: true, aviso_sem_aceite: true });

    const recebidos = await emailsPara(EMAIL);
    expect(recebidos).toHaveLength(1);
    const corpo = `${recebidos[0].subject}\n${recebidos[0].html}\n${recebidos[0].text ?? ""}`;
    expect(corpo).toMatch(/assine os termos/i);
    for (const segredo of ["Cliente Sigiloso", "Perícia designada", "só quem assinou"]) {
      expect(corpo, `o aviso não pode levar "${segredo}"`).not.toContain(segredo);
    }
  });

  test("no mesmo dia, o segundo evento não manda outro aviso", async () => {
    const r = await notificar();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ enviado: false, aviso_sem_aceite: true });
    expect(await emailsPara(EMAIL)).toHaveLength(1);
    const { data: linha, error } = await admin.from("avisos_aceite_pendente").select("total").eq("usuario_id", PARCEIRO!).single();
    expect(error).toBeNull();
    expect(linha!.total).toBe(1);
  });

  test("o WhatsApp também não sai: a linha dele na fila vira 'cancelado'", async () => {
    const { data: linha, error } = await admin.from("whatsapp_outbox").insert({
      escritorio_id: ESC, parceiro_id: PARCEIRO, caso_id: CASO, telefone: "5511999990001", tipo: "comentario.novo",
      texto: `${TITULO} — ${CLIENTE}`, status: "pendente", proxima_tentativa_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw new Error(`outbox: ${error.message}`);
    const r = await chamarComoSistema("whatsapp-outbox-enviar", "cron:whatsapp-outbox", { limite: 100 });
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    expect(Number(r.json?.sem_aceite)).toBeGreaterThanOrEqual(1);
    const { data: depois } = await admin.from("whatsapp_outbox").select("status, erro").eq("id", linha.id).single();
    expect(depois).toMatchObject({ status: "cancelado" });
    expect(depois!.erro).toMatch(/sem aceite/);
  });

  test("depois de assinar os termos, volta o e-mail do caso", async () => {
    const { error } = await admin.from("usuarios").update({ onboarded_em: new Date().toISOString(), termos_versao: TERMOS_VERSAO }).eq("id", PARCEIRO!);
    expect(error).toBeNull();
    const r = await notificar();
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    expect(r.json?.enviado).toBe(true);
    expect(r.json?.aviso_sem_aceite).toBeUndefined();
    const recebidos = await emailsPara(EMAIL);
    expect(recebidos).toHaveLength(2);
    expect(`${recebidos[1].subject}\n${recebidos[1].html}`).toContain("Cliente Sigiloso");
  });
});
