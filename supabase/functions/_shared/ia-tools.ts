// Registry de tools — Fase 0: SOMENTE LEITURA.
//
// Seguranca:
//   - Allowlist de COLUNAS por tool. Campos de senha (clientes.senha_meu_inss*)
//     NUNCA aparecem; CPF sai mascarado (gap #1).
//   - Execucao sempre via client RLS-escopado (o parceiro ja fica limitado aos
//     casos dele pelo proprio RLS — gap #4).
//   - Args validados contra enums + busca sanitizada; queries parametrizadas
//     (.eq/.ilike), nunca .or com string do modelo (gap #5).
//
// Cada tool declara `papeis` (quem pode ver/usar). Writes entram na Fase 1.

import {
  maskCpf,
  maskEmail,
  maskEndereco,
  maskTelefone,
  sanitizeBusca,
} from "./ia-redact.ts";
import type { ToolDef } from "./ia-providers.ts";

// deno-lint-ignore no-explicit-any
type SbClient = any;
type UsuarioTipo = "interno" | "parceiro";

export type ToolCtx = { uid: string; tipo: UsuarioTipo };

export type ToolSpec = ToolDef & {
  papeis: UsuarioTipo[];
  tipo: "read" | "write";
  // preview: resumo legivel da acao (usado no card de confirmacao do chat in-app).
  preview?: (args: Record<string, unknown>) => string;
  execute: (
    client: SbClient,
    args: Record<string, unknown>,
    ctx: ToolCtx,
  ) => Promise<unknown>;
};

const FASES = ["analise", "admin", "judicial", "finalizado"];
const STATUS = [
  "aguardando_documentos", "em_analise", "em_revisao", "em_andamento",
  "concluido_exito", "concluido_sem_exito", "arquivado",
];
const STATUS_SOLIC = ["pendente", "atendido", "dispensado"];

function clampLimite(v: unknown, def = 10, max = 20): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

function reqUuid(v: unknown, campo: string): string {
  const s = String(v ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error("'" + campo + "' deve ser um UUID valido");
  return s;
}

function oneOf(v: unknown, allowed: string[]): string | null {
  const s = String(v ?? "").trim();
  return allowed.includes(s) ? s : null;
}

const TIPOS_DOC = [
  "cnis", "ppp", "ctps", "ctc", "rg_cpf", "comprovante_residencia", "laudo_medico",
  "procuracao", "contrato_honorarios", "cat", "carta_concessao_inss", "hiscre",
  "holerite", "ltcat", "carne_gps", "certidao_casamento", "certidao_obito",
  "certidao_nascimento", "declaracao_uniao_estavel", "declaracao_atividade_rural",
  "atestado_medico", "outro", "substabelecimento", "declaracao_hipossuficiencia",
  "declaracao_ausencia_duplicidade",
];

function reqStr(v: unknown, campo: string, max = 4000): string {
  const s = String(v ?? "").trim();
  if (!s) throw new Error("'" + campo + "' e obrigatorio");
  return s.slice(0, max);
}

function optStr(v: unknown, max = 4000): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function reqEnum(v: unknown, allowed: string[], campo: string): string {
  const s = String(v ?? "").trim();
  if (!allowed.includes(s)) {
    throw new Error("'" + campo + "' deve ser um de: " + allowed.join(", "));
  }
  return s;
}

function reqCpf(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 11) throw new Error("CPF deve ter 11 digitos");
  return d;
}

// Pre-checagem de obrigatorios: em vez de erro seco, devolve a lista amigavel
// do que falta para o assistente PERGUNTAR ao usuario antes de criar. Garante
// que nada seja criado pela metade (evita cliente orfao).
function faltamCampos(checks: Array<[boolean, string]>): string[] {
  return checks.filter(([ok]) => !ok).map(([, label]) => label);
}

function respostaFaltam(faltam: string[]) {
  return {
    ok: false,
    faltam_campos_obrigatorios: faltam,
    mensagem:
      "Faltam campos obrigatorios. Pergunte ao usuario e informe antes de cadastrar: " +
      faltam.join("; "),
  };
}

function mapCliente(c: Record<string, unknown> | null | undefined) {
  if (!c) return null;
  return {
    nome: c.nome ?? null,
    cpf: maskCpf(c.cpf),
    telefone: maskTelefone(c.telefone),
    email: maskEmail(c.email),
    endereco: maskEndereco(c.endereco),
    observacoes: c.observacoes ?? null,
  };
}

export const READ_TOOLS: ToolSpec[] = [
  {
    name: "buscar_casos",
    description:
      "Lista casos (acoes previdenciarias). Filtra por nome do cliente, status e fase. " +
      "Retorna no maximo 20. Use para localizar um caso e pegar o id.",
    papeis: ["interno", "parceiro"],
    tipo: "read",
    schema: {
      type: "object",
      properties: {
        busca: { type: "string", description: "Parte do nome do cliente" },
        status: { type: "string", enum: STATUS },
        fase: { type: "string", enum: FASES },
        limite: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    execute: async (client, args) => {
      let q = client
        .from("casos")
        .select("id,tipo_beneficio,fase,status,created_at,clientes!inner(nome,cpf)")
        .order("created_at", { ascending: false })
        .limit(clampLimite(args.limite));
      const status = oneOf(args.status, STATUS);
      const fase = oneOf(args.fase, FASES);
      if (status) q = q.eq("status", status);
      if (fase) q = q.eq("fase", fase);
      if (args.busca) q = q.ilike("clientes.nome", "%" + sanitizeBusca(args.busca) + "%");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id,
        tipo_beneficio: r.tipo_beneficio,
        fase: r.fase,
        status: r.status,
        criado_em: r.created_at,
        cliente: {
          nome: (r.clientes as Record<string, unknown> | null)?.nome ?? null,
          cpf: maskCpf((r.clientes as Record<string, unknown> | null)?.cpf),
        },
      }));
    },
  },

  {
    name: "detalhe_caso",
    description: "Detalhe de um caso pelo id, incluindo dados (mascarados) do cliente.",
    papeis: ["interno", "parceiro"],
    tipo: "read",
    schema: {
      type: "object",
      properties: { caso_id: { type: "string", description: "UUID do caso" } },
      required: ["caso_id"],
    },
    execute: async (client, args) => {
      const id = reqUuid(args.caso_id, "caso_id");
      const { data, error } = await client
        .from("casos")
        .select(
          "id,tipo_beneficio,fase,status,rmi_estimada,atrasados_estimados,observacoes,created_at,updated_at," +
            "clientes(nome,cpf,telefone,email,endereco,observacoes)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { encontrado: false };
      return {
        encontrado: true,
        id: data.id,
        tipo_beneficio: data.tipo_beneficio,
        fase: data.fase,
        status: data.status,
        rmi_estimada: data.rmi_estimada,
        atrasados_estimados: data.atrasados_estimados,
        observacoes: data.observacoes,
        cliente: mapCliente(data.clientes as Record<string, unknown>),
      };
    },
  },

  {
    name: "listar_andamentos",
    description: "Andamentos (timeline) de um caso, mais recentes primeiro.",
    papeis: ["interno", "parceiro"],
    tipo: "read",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        limite: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["caso_id"],
    },
    execute: async (client, args) => {
      const id = reqUuid(args.caso_id, "caso_id");
      const { data, error } = await client
        .from("andamentos")
        .select(
          "titulo,descricao,origem,data_evento,visivel_parceiro,processo_admin_id,processo_judicial_id," +
            "processos_admin(tipo_beneficio,numero_requerimento),processos_judiciais(numero_processo)",
        )
        .eq("caso_id", id)
        .order("data_evento", { ascending: false })
        .limit(clampLimite(args.limite));
      if (error) throw new Error(error.message);
      return (data ?? []).map((a: Record<string, unknown>) => {
        const adm = a.processos_admin as Record<string, unknown> | null;
        const jud = a.processos_judiciais as Record<string, unknown> | null;
        let processo: Record<string, unknown> | string = "Geral (sem processo)";
        if (adm) {
          processo = {
            tipo: "administrativo",
            processo_admin_id: a.processo_admin_id,
            beneficio: adm.tipo_beneficio,
            numero_requerimento: adm.numero_requerimento,
          };
        } else if (jud) {
          processo = {
            tipo: "judicial",
            processo_judicial_id: a.processo_judicial_id,
            numero_processo: jud.numero_processo,
          };
        }
        return {
          titulo: a.titulo,
          descricao: a.descricao,
          origem: a.origem,
          data_evento: a.data_evento,
          visivel_parceiro: a.visivel_parceiro,
          processo,
        };
      });
    },
  },

  {
    name: "listar_processos",
    description:
      "Lista os processos (beneficios) de uma pasta/caso: administrativos e judiciais, com numero, " +
      "tipo de beneficio e o id para vincular andamentos (criar_andamento).",
    papeis: ["interno", "parceiro"],
    tipo: "read",
    schema: {
      type: "object",
      properties: { caso_id: { type: "string", description: "Pasta (caso) do cliente" } },
      required: ["caso_id"],
    },
    execute: async (client, args) => {
      const id = reqUuid(args.caso_id, "caso_id");
      const adm = await client
        .from("processos_admin")
        .select("id,numero_requerimento,tipo_beneficio")
        .eq("caso_id", id);
      if (adm.error) throw new Error(adm.error.message);
      const jud = await client
        .from("processos_judiciais")
        .select("id,numero_processo")
        .eq("caso_id", id);
      if (jud.error) throw new Error(jud.error.message);
      return {
        administrativos: (adm.data ?? []).map((p: Record<string, unknown>) => ({
          processo_admin_id: p.id,
          numero_requerimento: p.numero_requerimento,
          tipo_beneficio: p.tipo_beneficio,
        })),
        judiciais: (jud.data ?? []).map((p: Record<string, unknown>) => ({
          processo_judicial_id: p.id,
          numero_processo: p.numero_processo,
        })),
      };
    },
  },

  {
    name: "buscar_clientes",
    description:
      "Busca clientes por nome. CPF retorna mascarado. NAO retorna senha de nenhum sistema.",
    papeis: ["interno", "parceiro"],
    tipo: "read",
    schema: {
      type: "object",
      properties: {
        busca: { type: "string", description: "Parte do nome" },
        limite: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    execute: async (client, args) => {
      let q = client
        .from("clientes")
        .select("id,nome,cpf,telefone,email")
        .order("nome", { ascending: true })
        .limit(clampLimite(args.limite));
      if (args.busca) q = q.ilike("nome", "%" + sanitizeBusca(args.busca) + "%");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((c: Record<string, unknown>) => ({
        id: c.id,
        nome: c.nome,
        cpf: maskCpf(c.cpf),
        telefone: maskTelefone(c.telefone),
        email: maskEmail(c.email),
      }));
    },
  },

  {
    name: "listar_solicitacoes_documento",
    description: "Solicitacoes de documento de um caso (ou as pendentes em geral).",
    papeis: ["interno", "parceiro"],
    tipo: "read",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        status: { type: "string", enum: STATUS_SOLIC },
        limite: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    execute: async (client, args) => {
      let q = client
        .from("solicitacoes_documento")
        .select("id,caso_id,tipo,descricao,status,origem,data_solicitacao")
        .order("data_solicitacao", { ascending: false })
        .limit(clampLimite(args.limite));
      if (args.caso_id) q = q.eq("caso_id", reqUuid(args.caso_id, "caso_id"));
      const status = oneOf(args.status, STATUS_SOLIC);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },

  {
    name: "listar_comentarios",
    description: "Comentarios de um caso, mais antigos primeiro.",
    papeis: ["interno", "parceiro"],
    tipo: "read",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        limite: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["caso_id"],
    },
    execute: async (client, args) => {
      const id = reqUuid(args.caso_id, "caso_id");
      const { data, error } = await client
        .from("comentarios")
        .select("texto,autor_id,created_at")
        .eq("caso_id", id)
        .order("created_at", { ascending: true })
        .limit(clampLimite(args.limite));
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },
];

// ---------------------------------------------------------------------------
// WRITE_TOOLS (Fase 1) — escrita com confirmacao. Sem delecao. `papeis` reflete
// o RLS real de producao. `ctx.uid` vira autor_id/criado_por/solicitado_por.
// ---------------------------------------------------------------------------
export const WRITE_TOOLS: ToolSpec[] = [
  {
    name: "criar_comentario",
    tipo: "write",
    papeis: ["interno", "parceiro"],
    description: "Adiciona um comentario (mensagem interna) a um caso.",
    schema: {
      type: "object",
      properties: { caso_id: { type: "string" }, texto: { type: "string" } },
      required: ["caso_id", "texto"],
    },
    preview: (a) =>
      'Comentar no caso ' + a.caso_id + ': "' + String(a.texto ?? "").slice(0, 140) + '"',
    execute: async (client, args, ctx) => {
      const caso_id = reqUuid(args.caso_id, "caso_id");
      const texto = reqStr(args.texto, "texto");
      const { data, error } = await client
        .from("comentarios")
        .insert({ caso_id, autor_id: ctx.uid, texto })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ok: true, id: data?.id };
    },
  },

  {
    name: "criar_andamento",
    tipo: "write",
    papeis: ["interno"],
    description:
      "Cria um andamento na timeline. De preferencia VINCULE a um processo (use listar_processos para " +
      "pegar processo_admin_id ou processo_judicial_id) para ele aparecer no processo certo. Sem vinculo, " +
      "cai em 'Andamentos Gerais' da pasta.",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string", description: "Pasta (caso) do cliente" },
        titulo: { type: "string" },
        descricao: { type: "string" },
        processo_admin_id: {
          type: "string",
          description: "Vincula a um processo administrativo (ver listar_processos)",
        },
        processo_judicial_id: {
          type: "string",
          description: "Vincula a um processo judicial (ver listar_processos)",
        },
        visivel_parceiro: { type: "boolean" },
      },
      required: ["caso_id", "titulo"],
    },
    preview: (a) => "Andamento no caso " + a.caso_id + ": " + String(a.titulo ?? ""),
    execute: async (client, args, ctx) => {
      const caso_id = reqUuid(args.caso_id, "caso_id");
      const titulo = reqStr(args.titulo, "titulo", 200);
      const row: Record<string, unknown> = {
        caso_id,
        origem: "interno",
        titulo,
        descricao: optStr(args.descricao),
        criado_por: ctx.uid,
        data_evento: new Date().toISOString(),
        visivel_parceiro: args.visivel_parceiro === false ? false : true,
      };
      if (args.processo_admin_id) {
        row.processo_admin_id = reqUuid(args.processo_admin_id, "processo_admin_id");
      }
      if (args.processo_judicial_id) {
        row.processo_judicial_id = reqUuid(args.processo_judicial_id, "processo_judicial_id");
      }
      const { data, error } = await client
        .from("andamentos")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ok: true, id: data?.id };
    },
  },

  {
    name: "responder_solicitacao_documento",
    tipo: "write",
    papeis: ["interno", "parceiro"],
    description: "Marca uma solicitacao de documento como atendida ou dispensada.",
    schema: {
      type: "object",
      properties: {
        solicitacao_id: { type: "string" },
        status: { type: "string", enum: ["atendido", "dispensado"] },
        comentario: { type: "string" },
      },
      required: ["solicitacao_id", "status"],
    },
    preview: (a) => "Marcar solicitacao " + a.solicitacao_id + " como " + a.status,
    execute: async (client, args) => {
      const id = reqUuid(args.solicitacao_id, "solicitacao_id");
      const status = reqEnum(args.status, ["atendido", "dispensado"], "status");
      const patch: Record<string, unknown> = {
        status,
        data_atendimento: new Date().toISOString(),
      };
      const c = optStr(args.comentario);
      if (c) patch.comentario = c;
      const { error } = await client.from("solicitacoes_documento").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },

  {
    name: "atualizar_caso",
    tipo: "write",
    papeis: ["interno", "parceiro"],
    description: "Atualiza status, fase e/ou observacoes de um caso.",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        status: { type: "string", enum: STATUS },
        fase: { type: "string", enum: FASES },
        observacoes: { type: "string" },
      },
      required: ["caso_id"],
    },
    preview: (a) => {
      const campos = [
        a.status ? "status=" + a.status : null,
        a.fase ? "fase=" + a.fase : null,
        a.observacoes ? "observacoes" : null,
      ].filter(Boolean);
      return "Atualizar caso " + a.caso_id + " (" + campos.join(", ") + ")";
    },
    execute: async (client, args) => {
      const id = reqUuid(args.caso_id, "caso_id");
      const patch: Record<string, unknown> = {};
      if (args.status !== undefined) patch.status = reqEnum(args.status, STATUS, "status");
      if (args.fase !== undefined) patch.fase = reqEnum(args.fase, FASES, "fase");
      if (args.observacoes !== undefined) patch.observacoes = optStr(args.observacoes);
      if (Object.keys(patch).length === 0) throw new Error("informe ao menos um campo");
      const { error } = await client.from("casos").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },

  {
    name: "cadastrar_processo",
    tipo: "write",
    papeis: ["interno", "parceiro"],
    description:
      "Adiciona um PROCESSO (um beneficio) a pasta de um cliente que JA EXISTE. Use para registrar mais " +
      "beneficios do mesmo cliente. Informe caso_id (a pasta do cliente) e tipo_beneficio. Descubra o " +
      "caso_id com buscar_casos/buscar_clientes. tipo padrao: administrativo (requerimento INSS); use " +
      "judicial para acao na Justica.",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string", description: "Pasta (caso) do cliente" },
        tipo_beneficio: { type: "string", description: "Ex.: Aposentadoria por idade, BPC/LOAS" },
        numero_requerimento: {
          type: "string",
          description: "Numero do requerimento (admin) ou do processo (judicial)",
        },
        tipo: { type: "string", enum: ["administrativo", "judicial"] },
      },
      required: ["caso_id", "tipo_beneficio"],
    },
    preview: (a) =>
      "Cadastrar processo (" + String(a.tipo_beneficio ?? "") + ") na pasta " + a.caso_id,
    execute: async (client, args) => {
      const caso_id = reqUuid(args.caso_id, "caso_id");
      const tipo_beneficio = reqStr(args.tipo_beneficio, "tipo_beneficio", 100);
      const tipo = oneOf(args.tipo, ["administrativo", "judicial"]) ?? "administrativo";
      const numero = optStr(args.numero_requerimento);

      if (tipo === "judicial") {
        const row: Record<string, unknown> = { caso_id };
        if (numero) row.numero_processo = numero;
        const ins = await client
          .from("processos_judiciais")
          .insert(row)
          .select("id")
          .maybeSingle();
        if (ins.error) throw new Error(ins.error.message);
        return { ok: true, processo_id: ins.data?.id, tipo };
      }

      const row: Record<string, unknown> = { caso_id, tipo_beneficio };
      if (numero) row.numero_requerimento = numero;
      const ins = await client
        .from("processos_admin")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (ins.error) throw new Error(ins.error.message);
      return { ok: true, processo_id: ins.data?.id, tipo };
    },
  },

  {
    name: "cadastrar_caso",
    tipo: "write",
    papeis: ["interno", "parceiro"],
    description:
      "PORTA DE ENTRADA para cadastrar um cliente NOVO com o PRIMEIRO beneficio. Acione para qualquer " +
      "intencao de criar/registrar/cadastrar/abrir/incluir/lancar/iniciar/dar entrada em cliente, " +
      "processo, beneficio ou atendimento novo (e sinonimos). Cria o cliente (ou reusa por CPF), garante " +
      "a PASTA do cliente (1 caso por cliente, reusando a existente) e registra o beneficio como PROCESSO " +
      "administrativo. Para ADICIONAR mais beneficios a um cliente que ja tem pasta, use cadastrar_processo. " +
      "Obrigatorios: nome, cpf, tipo_beneficio. Se faltar, retorna 'faltam_campos_obrigatorios'.",
    schema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        cpf: { type: "string" },
        tipo_beneficio: {
          type: "string",
          description: "Beneficio do 1o processo. Ex.: Aposentadoria por idade, BPC/LOAS",
        },
        numero_requerimento: {
          type: "string",
          description: "Numero do requerimento INSS, se houver",
        },
        telefone: { type: "string" },
        email: { type: "string" },
        data_nascimento: { type: "string", description: "AAAA-MM-DD" },
        endereco: { type: "string" },
        observacoes: { type: "string", description: "Nota sobre o cliente" },
      },
      required: ["nome", "cpf", "tipo_beneficio"],
    },
    preview: (a) =>
      "Cadastrar cliente " +
      String(a.nome ?? "") +
      " com processo: " +
      String(a.tipo_beneficio ?? ""),
    execute: async (client, args, ctx) => {
      // Pre-checagem: se faltar obrigatorio, devolve a lista (nao cria nada).
      const faltam = faltamCampos([
        [!!String(args.nome ?? "").trim(), "nome (completo)"],
        [String(args.cpf ?? "").replace(/\D/g, "").length === 11, "cpf (11 digitos)"],
        [!!String(args.tipo_beneficio ?? "").trim(), "tipo_beneficio (beneficio pretendido)"],
      ]);
      if (faltam.length) return respostaFaltam(faltam);

      const nome = reqStr(args.nome, "nome", 200);
      const cpf = reqCpf(args.cpf);
      const tipo_beneficio = reqStr(args.tipo_beneficio, "tipo_beneficio", 100);

      // 1) Cliente ja existe? (casa por CPF, no escopo do usuario).
      const existente = await client.from("clientes").select("id").eq("cpf", cpf).maybeSingle();
      let clienteId: string | undefined = existente.data?.id;
      let clienteCriado = false;

      if (!clienteId) {
        const row: Record<string, unknown> = { nome, cpf };
        const tel = optStr(args.telefone);
        if (tel) row.telefone = tel;
        const email = optStr(args.email);
        if (email) row.email = email;
        const dn = optStr(args.data_nascimento);
        if (dn) row.data_nascimento = dn;
        const ender = optStr(args.endereco);
        if (ender) row.endereco = ender;
        const obsCli = optStr(args.observacoes);
        if (obsCli) row.observacoes = obsCli;
        const ins = await client.from("clientes").insert(row).select("id").maybeSingle();
        if (ins.error) {
          throw new Error(
            "Nao consegui criar o cliente (o CPF pode ja existir no sistema, em outro cadastro): " +
              ins.error.message,
          );
        }
        clienteId = ins.data?.id;
        clienteCriado = true;
      }
      if (!clienteId) throw new Error("falha ao obter o cliente");

      // 2) Pasta (caso) do cliente: reusa a existente ou cria 1 (1 por cliente).
      const pastaResp = await client
        .from("casos")
        .select("id")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: true })
        .limit(1);
      if (pastaResp.error) throw new Error(pastaResp.error.message);
      let casoId: string | undefined =
        pastaResp.data && pastaResp.data[0] ? pastaResp.data[0].id : undefined;
      let pastaCriada = false;
      if (!casoId) {
        const casoRow: Record<string, unknown> = {
          cliente_id: clienteId,
          tipo_beneficio: "Pasta do cliente",
        };
        if (ctx.tipo === "parceiro") casoRow.parceiro_id = ctx.uid;
        const casoIns = await client.from("casos").insert(casoRow).select("id").maybeSingle();
        if (casoIns.error) throw new Error(casoIns.error.message);
        casoId = casoIns.data?.id;
        pastaCriada = true;
      }
      if (!casoId) throw new Error("falha ao obter a pasta do cliente");

      // 3) Processo (beneficio) administrativo dentro da pasta.
      const procRow: Record<string, unknown> = { caso_id: casoId, tipo_beneficio };
      const numreq = optStr(args.numero_requerimento);
      if (numreq) procRow.numero_requerimento = numreq;
      const procIns = await client
        .from("processos_admin")
        .insert(procRow)
        .select("id")
        .maybeSingle();
      if (procIns.error) throw new Error(procIns.error.message);

      return {
        ok: true,
        cliente_id: clienteId,
        caso_id: casoId,
        processo_id: procIns.data?.id,
        cliente_criado: clienteCriado,
        pasta_criada: pastaCriada,
      };
    },
  },

  // criar_cliente (avulso) e criar_caso foram REMOVIDOS de proposito. Modelo:
  // cliente -> 1 pasta (caso) -> processos (beneficios) -> andamentos. Cliente
  // novo + 1o beneficio = cadastrar_caso; mais beneficios = cadastrar_processo.

  {
    name: "atualizar_cliente",
    tipo: "write",
    papeis: ["interno"],
    description:
      "Atualiza dados de um cliente: nome, telefone, email, data_nascimento, endereco, observacoes. " +
      "NAO altera o CPF. Exige cliente_id (UUID). Se o usuario der o NOME, use buscar_clientes antes " +
      "para achar o id. ATENCAO: se houver mais de um cliente com nome parecido, NAO atualize - " +
      "pergunte ao usuario qual e o certo confirmando pelo CPF antes de alterar.",
    schema: {
      type: "object",
      properties: {
        cliente_id: { type: "string" },
        nome: { type: "string" },
        telefone: { type: "string" },
        email: { type: "string" },
        data_nascimento: { type: "string" },
        endereco: { type: "string" },
        observacoes: { type: "string" },
      },
      required: ["cliente_id"],
    },
    preview: (a) => "Atualizar cliente " + a.cliente_id,
    execute: async (client, args) => {
      const id = reqUuid(args.cliente_id, "cliente_id");
      const patch: Record<string, unknown> = {};
      if (args.nome !== undefined) patch.nome = reqStr(args.nome, "nome", 200);
      if (args.telefone !== undefined) patch.telefone = optStr(args.telefone);
      if (args.email !== undefined) patch.email = optStr(args.email);
      if (args.data_nascimento !== undefined) patch.data_nascimento = optStr(args.data_nascimento);
      if (args.endereco !== undefined) patch.endereco = optStr(args.endereco);
      if (args.observacoes !== undefined) patch.observacoes = optStr(args.observacoes);
      if (Object.keys(patch).length === 0) throw new Error("informe ao menos um campo");
      const { error } = await client.from("clientes").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },

  {
    name: "criar_solicitacao_documento",
    tipo: "write",
    papeis: ["interno"],
    description: "Cria uma solicitacao de documento para um caso.",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        tipo: { type: "string", enum: TIPOS_DOC },
        descricao: { type: "string" },
      },
      required: ["caso_id", "tipo"],
    },
    preview: (a) => "Solicitar documento (" + a.tipo + ") no caso " + a.caso_id,
    execute: async (client, args, ctx) => {
      const caso_id = reqUuid(args.caso_id, "caso_id");
      const tipo = reqEnum(args.tipo, TIPOS_DOC, "tipo");
      const row: Record<string, unknown> = {
        caso_id,
        tipo,
        status: "pendente",
        solicitado_por: ctx.uid,
      };
      const desc = optStr(args.descricao);
      if (desc) row.descricao = desc;
      const { data, error } = await client
        .from("solicitacoes_documento")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ok: true, id: data?.id };
    },
  },

  {
    name: "preparar_upload_documento",
    tipo: "write",
    papeis: ["interno", "parceiro"],
    description:
      "Prepara o anexo de um documento a um caso e devolve um LINK DE UPLOAD ASSINADO (valido por ~2h) " +
      "para onde o arquivo deve ser enviado via HTTP PUT (corpo = binario). O arquivo vai DIRETO para o " +
      "armazenamento, sem passar pela IA. Use quando quiserem anexar/enviar/juntar/subir um arquivo " +
      "(CNIS, laudo, procuracao, etc.) ao caso. Informe caso_id, tipo e nome do arquivo (com extensao). " +
      "Se for RESPOSTA a um pedido, passe solicitacao_id: a solicitacao e marcada como ATENDIDA e o " +
      "documento e vinculado a ela (use listar_solicitacoes_documento para achar o id).",
    schema: {
      type: "object",
      properties: {
        caso_id: { type: "string", description: "Pasta (caso) do cliente" },
        tipo: { type: "string", enum: TIPOS_DOC },
        nome_arquivo: { type: "string", description: "Nome do arquivo com extensao, ex.: cnis.pdf" },
        solicitacao_id: {
          type: "string",
          description: "Se for resposta a um pedido: marca a solicitacao como atendida e vincula o doc",
        },
        visivel_parceiro: { type: "boolean" },
      },
      required: ["caso_id", "tipo", "nome_arquivo"],
    },
    preview: (a) =>
      "Preparar upload de documento (" + a.tipo + ") no caso " + a.caso_id,
    execute: async (client, args, ctx) => {
      const caso_id = reqUuid(args.caso_id, "caso_id");
      const tipo = reqEnum(args.tipo, TIPOS_DOC, "tipo");
      const nome = reqStr(args.nome_arquivo, "nome_arquivo", 200);
      const safe = nome
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = caso_id + "/" + Date.now() + "_" + safe;

      // 1) Link de upload assinado (arquivo vai direto ao Storage).
      const signed = await client.storage.from("documentos").createSignedUploadUrl(path);
      if (signed.error) throw new Error(signed.error.message);

      // 2) Registro do documento (aponta para o path; arquivo chega pelo link).
      const row: Record<string, unknown> = {
        caso_id,
        tipo,
        nome_arquivo: nome,
        storage_path: path,
        uploaded_by: ctx.uid,
        visivel_parceiro: args.visivel_parceiro === false ? false : true,
      };
      const ins = await client.from("documentos").insert(row).select("id").maybeSingle();
      if (ins.error) throw new Error(ins.error.message);

      // 3) Se em resposta a uma solicitacao: marca ATENDIDA + vincula o documento.
      let solicitacao_atendida = false;
      if (args.solicitacao_id) {
        const sid = reqUuid(args.solicitacao_id, "solicitacao_id");
        const up = await client
          .from("solicitacoes_documento")
          .update({
            status: "atendido",
            data_atendimento: new Date().toISOString(),
            documento_id: ins.data?.id,
          })
          .eq("id", sid);
        if (up.error) throw new Error(up.error.message);
        solicitacao_atendida = true;
      }

      const signedUrl = signed.data?.signedUrl ?? "";
      const pagina_upload =
        "https://marasandraconnect.com/upload?u=" +
        encodeURIComponent(signedUrl) +
        "&n=" +
        encodeURIComponent(nome);
      return {
        ok: true,
        documento_id: ins.data?.id,
        solicitacao_atendida,
        storage_path: path,
        pagina_upload,
        upload_url: signedUrl,
        instrucoes:
          "Compartilhe ou abra 'pagina_upload': uma pagina onde se escolhe o arquivo e ele e enviado " +
          "(serve para o advogado OU para o cliente). Alternativa tecnica: HTTP PUT direto em upload_url. " +
          "O link expira em ~2h. Apos o upload, o documento aparece na aba Documentos do caso.",
      };
    },
  },
];

const ALL_TOOLS: ToolSpec[] = [...READ_TOOLS, ...WRITE_TOOLS];

// incluirEscrita=false -> so leitura (ex.: token MCP com escopo 'leitura').
export function toolsForRole(tipo: UsuarioTipo, incluirEscrita = true): ToolSpec[] {
  return ALL_TOOLS.filter(
    (t) => t.papeis.includes(tipo) && (incluirEscrita || t.tipo === "read"),
  );
}

export function findTool(
  name: string,
  tipo: UsuarioTipo,
  incluirEscrita = true,
): ToolSpec | null {
  const t = ALL_TOOLS.find((x) => x.name === name);
  if (!t) return null;
  if (!t.papeis.includes(tipo)) return null; // gap #4: papel nao autorizado
  if (!incluirEscrita && t.tipo === "write") return null;
  return t;
}
