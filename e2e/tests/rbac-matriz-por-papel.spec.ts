// E2E: a matriz de permissões cobrada onde ninguém estava olhando.
//
// Por que esta spec existe: cruzando a superfície do RBAC (policies `perm_*`,
// RPCs e permissões do banco) com o que as specs exercitavam, sobraram quatro
// tabelas com policy de permissão que nenhum teste tocava — `analises_tecnicas`,
// `alertas_duplicidade`, `lead_comentarios`, `ia_integracoes` — e sete
// permissões nunca afirmadas: `analises:ler`, `andamentos:ler_internos`,
// `publicacoes:ler`, `comercial:gerenciar`, `etiquetas:gerenciar`,
// `escritorio:configurar` e `integracoes:gerenciar`.
//
// A régua é a matriz que está no BANCO (`papel_permissoes`), lida no beforeAll:
// se a matriz mudar, o teste muda com ela em vez de mentir.
//
// Leitura recusada pela RLS vem como ZERO LINHAS, não como erro — por isso as
// asserções de leitura comparam contagem, e cada caso cria a linha que deveria
// ser vista, para "0" significar "escondeu" e não "não havia nada".
//
// Só no banco local/staging com o seed do Canário (`bun run local:rbac`).
import { test, expect } from "@playwright/test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "../supabase-admin";
import {
  clienteComo, contaDoCanario, escreveu, escritorioCanario, idDe, type PapelCanario,
} from "../rbac";

const admin = adminClient();
const MARCA = "[E2E matriz]";

let ESC: string;
let casoId: string;
let matriz: Record<string, string[]> = {};
const sessoes: Record<string, SupabaseClient> = {};

/** Uma sessão por papel, reaproveitada: o login é caro e o teste é serial. */
async function como(papel: PapelCanario): Promise<SupabaseClient> {
  sessoes[papel] ??= await clienteComo(contaDoCanario(papel), ESC);
  return sessoes[papel];
}

/** O que a matriz do banco diz: este papel tem esta permissão? */
const tem = (papel: string, permissao: string) => (matriz[permissao] ?? []).includes(papel);

async function limpar() {
  if (!ESC) return; // beforeAll não chegou a rodar
  await admin.from("analises_tecnicas").delete().like("resumo_parceiro", `${MARCA}%`);
  await admin.from("analises_tecnicas").delete().like("beneficio_recomendado", `${MARCA}%`);
  await admin.from("alertas_duplicidade").delete().like("cpf_tentado", "999%");
  await admin.from("lead_comentarios").delete().like("texto", `${MARCA}%`);
  await admin.from("leads").delete().like("nome", `${MARCA}%`);
  await admin.from("etiquetas").delete().like("nome", `${MARCA}%`);
  await admin.from("andamentos").delete().like("titulo", `${MARCA}%`);
  await admin.from("publicacoes_dje").delete().like("djen_id", "e2e-matriz-%");
}

test.describe.serial("matriz de permissões por papel", () => {
  test.beforeAll(async () => {
    ESC = await escritorioCanario();
    const { data: caso } = await admin.from("casos").select("id").eq("escritorio_id", ESC).limit(1).single();
    casoId = caso!.id as string;

    const { data: pp, error } = await admin
      .from("papel_permissoes")
      .select("permissao, papel:papeis!inner(chave)");
    if (error) throw new Error(`matriz: ${error.message}`);
    matriz = {};
    for (const r of pp ?? []) {
      const chave = (r.papel as unknown as { chave: string }).chave;
      (matriz[r.permissao as string] ??= []).push(chave);
    }
    // se a leitura da matriz falhar, o resto do teste vira teatro
    expect(matriz["casos:editar"], "matriz lida do banco").toContain("advogado");
    await limpar();
  });

  test.afterAll(limpar);

  test("analises_tecnicas e alertas_duplicidade: quem não edita caso não escreve (classe inversa)", async () => {
    // `analises_tecnicas` é única por (caso, versão): sem versão própria por
    // papel, a segunda tentativa colide em 23505 antes da RLS responder — e aí
    // o teste não estaria medindo permissão nenhuma.
    let versao = 900;
    for (const papel of ["advogado", "financeiro"] as PapelCanario[]) {
      const sb = await como(papel);
      const esperado = tem(papel, "casos:editar");
      versao += 1;

      expect(
        await escreveu(sb, "analises_tecnicas",
          { caso_id: casoId, escritorio_id: ESC, versao, resumo_parceiro: `${MARCA} ${papel}` },
          `${papel} escrevendo análise`),
        `${papel} escrevendo análise (matriz: ${esperado})`,
      ).toBe(esperado);

      expect(
        await escreveu(sb, "alertas_duplicidade",
          { cpf_tentado: `999${Date.now()}`.slice(0, 11), escritorio_id: ESC },
          `${papel} escrevendo alerta`),
        `${papel} escrevendo alerta (matriz: ${esperado})`,
      ).toBe(esperado);
    }
  });

  test("lead_comentarios: só quem gerencia o comercial", async () => {
    const { data: lead } = await admin.from("leads").insert({
      escritorio_id: ESC, tipo: "cliente", nome: `${MARCA} lead`, whatsapp: "11999990000",
    }).select("id").single();

    for (const papel of ["advogado", "assistente"] as PapelCanario[]) {
      const sb = await como(papel);
      const esperado = tem(papel, "comercial:gerenciar");
      expect(
        await escreveu(sb, "lead_comentarios",
          { lead_id: lead!.id, texto: `${MARCA} ${papel}`, escritorio_id: ESC },
          `${papel} comentando no lead`),
        `${papel} comentando no lead (matriz: ${esperado})`,
      ).toBe(esperado);
    }
  });

  test("ia_integracoes: escrever a chave de IA exige ia:usar", async () => {
    for (const papel of ["assistente", "financeiro"] as PapelCanario[]) {
      const sb = await como(papel);
      const esperado = tem(papel, "ia:usar");
      const uid = await idDe(contaDoCanario(papel));
      const passou = await escreveu(sb, "ia_integracoes", {
        usuario_id: uid, escritorio_id: ESC, provider: "anthropic", modelo: "claude-x",
        api_key_cipher: "xx", api_key_iv: "xx",
      }, `${papel} gravando integração de IA`);
      expect(passou, `${papel} gravando integração de IA (matriz: ${esperado})`).toBe(esperado);
      if (passou) await admin.from("ia_integracoes").delete().eq("usuario_id", uid).eq("modelo", "claude-x");
    }
  });

  test("etiquetas: só quem gerencia etiquetas cria", async () => {
    for (const papel of ["advogado", "assistente"] as PapelCanario[]) {
      const sb = await como(papel);
      const esperado = tem(papel, "etiquetas:gerenciar");
      expect(
        await escreveu(sb, "etiquetas", { nome: `${MARCA} ${papel}`, escritorio_id: ESC },
          `${papel} criando etiqueta`),
        `${papel} criando etiqueta (matriz: ${esperado})`,
      ).toBe(esperado);
    }
  });

  test("leitura: análise, andamento interno e publicação obedecem a matriz", async () => {
    // as linhas existem — então "0" só pode significar que a RLS escondeu
    // Duas análises, porque a policy tem dois ramos:
    //   resumo_parceiro IS NOT NULL  OR  tem_permissao('analises:ler')
    // A interna é que separa quem tem `analises:ler`. Medir só a com resumo
    // dava verde para o financeiro e não provava nada.
    //
    // E o ramo `resumo_parceiro IS NOT NULL` não é "de todos": a permissiva
    // `analises_select` continua exigindo `is_interno()`, então ele serve ao
    // INTERNO sem `analises:ler` (o financeiro vê o resumo, não a análise
    // inteira). O parceiro não lê esta tabela — o que ele vê chega por outro
    // caminho. Medido abaixo, nos dois sentidos.
    const { data: an } = await admin.from("analises_tecnicas")
      .insert({ caso_id: casoId, escritorio_id: ESC, versao: 990, resumo_parceiro: null,
                beneficio_recomendado: `${MARCA} interna` })
      .select("id").single();
    const { data: anParc } = await admin.from("analises_tecnicas")
      .insert({ caso_id: casoId, escritorio_id: ESC, versao: 991, resumo_parceiro: `${MARCA} para o parceiro` })
      .select("id").single();
    const { data: and } = await admin.from("andamentos").insert({
      caso_id: casoId, escritorio_id: ESC, titulo: `${MARCA} andamento interno`,
      descricao: "interno", origem: "interno", data_evento: new Date().toISOString(),
      visivel_parceiro: false,
    }).select("id").single();
    const { data: pub } = await admin.from("publicacoes_dje").insert({
      escritorio_id: ESC, djen_id: `e2e-matriz-${Date.now()}`, texto: `${MARCA} publicação`,
    }).select("id").single();
    expect(an && and && pub, "as três linhas de leitura nasceram").toBeTruthy();

    for (const papel of ["advogado", "assistente", "financeiro", "parceiro"] as PapelCanario[]) {
      const sb = await como(papel);

      const vAn = await sb.from("analises_tecnicas").select("id").eq("id", an!.id);
      expect(vAn.error, `análise: erro de query não é zero (${papel})`).toBeNull();
      expect((vAn.data ?? []).length > 0, `${papel} lendo análise INTERNA (matriz: ${tem(papel, "analises:ler")})`)
        .toBe(tem(papel, "analises:ler"));

      const vAnParc = await sb.from("analises_tecnicas").select("id").eq("id", anParc!.id);
      expect(vAnParc.error).toBeNull();
      const interno = papel !== "parceiro";
      expect((vAnParc.data ?? []).length > 0,
        `${papel} lendo a análise COM resumo ao parceiro (interno vê; parceiro não lê a tabela)`)
        .toBe(interno);

      const vAnd = await sb.from("andamentos").select("id").eq("id", and!.id);
      expect(vAnd.error, `andamento: erro de query não é zero (${papel})`).toBeNull();
      expect((vAnd.data ?? []).length > 0, `${papel} lendo andamento interno (matriz: ${tem(papel, "andamentos:ler_internos")})`)
        .toBe(tem(papel, "andamentos:ler_internos"));

      // `publicacoes:ler` + ser interno. A matriz dá a permissão ao parceiro,
      // mas a permissiva da tabela é `is_interno()`, então ele não lê ESTA
      // tabela — o que chega a ele vem por outro caminho. Falha fechada, e
      // anotada em planning/AUDITABILIDADE.md como inconsistência latente da
      // matriz (permissão concedida que nenhuma policy usa).
      const vPub = await sb.from("publicacoes_dje").select("id").eq("id", pub!.id);
      expect(vPub.error, `publicação: erro de query não é zero (${papel})`).toBeNull();
      expect((vPub.data ?? []).length > 0,
        `${papel} lendo publicação (matriz: ${tem(papel, "publicacoes:ler")}, interno: ${interno})`)
        .toBe(tem(papel, "publicacoes:ler") && interno);
    }
  });

  test("as duas sensíveis do escritório: marca e integrações são só de quem administra", async () => {
    for (const papel of ["advogado", "assistente", "financeiro"] as PapelCanario[]) {
      const sb = await como(papel);

      const marca = await sb.rpc("escritorio_definir_marca", { p_nome_exibicao: `${MARCA} ${papel}` });
      expect(marca.error?.message ?? "", `${papel} não configura o escritório`)
        .toMatch(/[Ss]em permissão|só quem configura o escritório/);

      const gmail = await sb.rpc("gmail_inss_status");
      expect(gmail.error?.message ?? "", `${papel} não mexe em integrações`)
        .toMatch(/[Ss]em permissão|integraç|permission/i);
    }

    // e a admin faz as duas
    const adm = await como("admin");
    const { data: antes } = await admin.from("escritorio_config").select("marca").eq("escritorio_id", ESC).maybeSingle();
    const nomeAtual = (antes?.marca as { nome_exibicao?: string } | null)?.nome_exibicao ?? "Canário Advocacia";
    expect((await adm.rpc("escritorio_definir_marca", { p_nome_exibicao: nomeAtual })).error,
      "admin configura o escritório").toBeNull();
    expect((await adm.rpc("gmail_inss_status")).error, "admin lê o status das integrações").toBeNull();
  });
});
