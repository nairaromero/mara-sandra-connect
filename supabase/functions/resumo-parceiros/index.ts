// supabase/functions/resumo-parceiros/index.ts
//
// Resumo periódico para parceiros: um e-mail por parceiro com os andamentos,
// os requerimentos protocolados no INSS e os processos judiciais ajuizados dos
// casos dele no período. Por escritório (dia, hora, blocos, padrão) e por
// parceiro (sempre / nunca / segue o padrão). As regras moram em
// _shared/resumo-parceiros.ts; aqui ficam só as consultas e o envio.
//
// Quem chama:
//   - o cron `msc-resumo-parceiros` (assinatura de sistema), de hora em hora:
//       { acao: "rodar" }  → manda para os escritórios cujo dia e hora chegaram
//   - a tela (/parceiros?tab=resumo), pessoa com `parceiros:gerenciar`:
//       { acao: "estado" }                          config + parceiros + último envio
//       { acao: "salvar_config", config }           grava a config do escritório
//       { acao: "definir_parceiro", parceiro_id, modo }
//       { acao: "previa", parceiro_id }             HTML do e-mail, sem enviar
//       { acao: "teste", parceiro_id }              manda a prévia para QUEM PEDIU
//
// Nunca manda dado de cliente a parceiro sem aceite dos termos vigentes ou com
// vínculo inativo (o mesmo `parceiroSemAceite` dos outros e-mails).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { clienteAdmin, escopado, exigirUsuarioOuSistema } from "../_shared/auth.ts";
import { marcaDoEscritorio, remetente } from "../_shared/marca.ts";
import { emailConfigurado, enviarEmail } from "../_shared/email.ts";
import { parceiroSemAceite } from "../_shared/termos.ts";
import {
  type BlocoResumo,
  type ConfigResumo,
  ehModo,
  estaNaHora,
  type ItemResumo,
  type ModoResumo,
  montarEmailResumo,
  normalizarConfig,
  type Periodo,
  periodoDoResumo,
  recebeResumo,
  relogioDeBrasilia,
  type SecaoResumoId,
} from "../_shared/resumo-parceiros.ts";

const APP_URL = (Deno.env.get("APP_BASE_URL") || Deno.env.get("APP_URL") || "https://marasandraconnect.com").replace(/\/+$/, "");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-escritorio-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

class ErroDeLeitura extends Error {}

function checar<T>(r: { data: T | null; error: { message: string } | null }, onde: string): T {
  if (r.error) throw new ErroDeLeitura(`${onde}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

interface Parceiro {
  id: string;
  nome: string;
  email: string | null;
  emails_copia: string[];
  tipo: string | null;
  onboarded_em: string | null;
  termos_versao: string | null;
  ativo: boolean;
}

// deno-lint-ignore no-explicit-any
type Linha = any;

function nomeCliente(r: Linha): string {
  return r?.casos?.clientes?.nome ?? "Cliente";
}

// ---------------------------------------------------------------------------
// Consultas por bloco. Record<SecaoResumoId, …>: bloco novo sem consulta não compila.
// ---------------------------------------------------------------------------
type Consulta = (sb: SupabaseClient, parceiroId: string, p: Periodo) => Promise<ItemResumo[]>;

const CONSULTAS: Record<SecaoResumoId, Consulta> = {
  async andamentos(sb, parceiroId, p) {
    const linhas = checar<Linha[]>(
      await sb
        .from("andamentos")
        .select("id, titulo, descricao, data_evento, created_at, caso_id, casos!inner(parceiro_id, clientes(nome))")
        .eq("casos.parceiro_id", parceiroId)
        .eq("visivel_parceiro", true)
        .gt("created_at", p.inicioIso)
        .lte("created_at", p.fimIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 999),
      "andamentos",
    );
    return linhas.map((r) => ({
      casoId: r.caso_id,
      cliente: nomeCliente(r),
      titulo: r.titulo || "Andamento",
      detalhe: r.descricao ? String(r.descricao).replace(/\s+/g, " ").slice(0, 160) : "",
      data: r.data_evento ?? r.created_at,
    }));
  },

  async requerimentos(sb, parceiroId, p) {
    const linhas = checar<Linha[]>(
      await sb
        .from("processos_admin")
        .select("id, numero_requerimento, data_protocolo, tipo_beneficio, etapa_tipo, caso_id, casos!inner(parceiro_id, clientes(nome))")
        .eq("casos.parceiro_id", parceiroId)
        .gte("data_protocolo", p.inicioDia)
        .lte("data_protocolo", p.fimDia)
        .order("data_protocolo", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 999),
      "requerimentos",
    );
    return linhas.map((r) => ({
      casoId: r.caso_id,
      cliente: nomeCliente(r),
      titulo: r.tipo_beneficio ? `Requerimento de ${r.tipo_beneficio}` : "Requerimento protocolado",
      detalhe: r.numero_requerimento ? `Protocolo nº ${r.numero_requerimento}` : "",
      data: r.data_protocolo,
    }));
  },

  async judiciais(sb, parceiroId, p) {
    // Distribuído no período; sem data de distribuição, vale o cadastro.
    const linhas = checar<Linha[]>(
      await sb
        .from("processos_judiciais")
        .select("id, numero_processo, vara, comarca, uf, data_distribuicao, created_at, caso_id, casos!inner(parceiro_id, clientes(nome))")
        .eq("casos.parceiro_id", parceiroId)
        .or(
          `and(data_distribuicao.gte.${p.inicioDia},data_distribuicao.lte.${p.fimDia}),` +
            `and(data_distribuicao.is.null,created_at.gt.${p.inicioIso},created_at.lte.${p.fimIso})`,
        )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 999),
      "judiciais",
    );
    return linhas.map((r) => ({
      casoId: r.caso_id,
      cliente: nomeCliente(r),
      titulo: r.numero_processo ? `Processo nº ${r.numero_processo}` : "Processo judicial",
      detalhe: [r.vara, r.comarca && r.uf ? `${r.comarca}/${r.uf}` : r.comarca].filter(Boolean).join(" · "),
      data: r.data_distribuicao ?? r.created_at,
    }));
  },
};

// ---------------------------------------------------------------------------
// Leituras do escritório
// ---------------------------------------------------------------------------
async function lerConfig(sb: SupabaseClient): Promise<ConfigResumo> {
  const r = await sb.from("resumo_parceiros_config").select("ativo, dia_semana, hora, padrao_parceiros, secoes").maybeSingle();
  if (r.error) throw new ErroDeLeitura(`config: ${r.error.message}`);
  return normalizarConfig(r.data ?? {});
}

/** Parceiros com vínculo neste escritório (ativos e inativos: a tela mostra os dois). */
async function lerParceiros(sb: SupabaseClient, escritorioId: string): Promise<Parceiro[]> {
  const linhas = checar<Linha[]>(
    await sb
      .from("membros")
      .select(
        "status, usuario:usuarios!membros_usuario_id_fkey(id, nome, email, emails_copia, tipo, onboarded_em, termos_versao), papel:papeis!inner(tipo_acesso)",
      )
      .eq("escritorio_id", escritorioId)
      .eq("papel.tipo_acesso", "parceiro")
      .range(0, 4999),
    "membros",
  );
  return linhas
    .filter((m) => m.usuario?.id)
    .map((m) => ({
      id: m.usuario.id,
      nome: m.usuario.nome || m.usuario.email || "Parceiro",
      email: m.usuario.email ?? null,
      emails_copia: Array.isArray(m.usuario.emails_copia) ? m.usuario.emails_copia : [],
      tipo: m.usuario.tipo ?? null,
      onboarded_em: m.usuario.onboarded_em ?? null,
      termos_versao: m.usuario.termos_versao ?? null,
      ativo: m.status === "ativo",
    }))
    .sort((a, z) => a.nome.localeCompare(z.nome, "pt-BR"));
}

async function lerModos(sb: SupabaseClient): Promise<Map<string, ModoResumo>> {
  const linhas = checar<Linha[]>(
    await sb.from("resumo_parceiros_preferencia").select("parceiro_id, modo").range(0, 4999),
    "preferencias",
  );
  return new Map(linhas.filter((l) => ehModo(l.modo)).map((l) => [l.parceiro_id, l.modo as ModoResumo]));
}

async function montarResumo(sb: SupabaseClient, escritorioId: string, cfg: ConfigResumo, parceiro: Parceiro, agora: Date) {
  const periodo = periodoDoResumo(agora);
  const blocos: BlocoResumo[] = [];
  for (const id of cfg.secoes) blocos.push({ id, itens: await CONSULTAS[id](sb, parceiro.id, periodo) });
  const marca = await marcaDoEscritorio(sb, escritorioId);
  return { periodo, marca, ...montarEmailResumo({ marca, parceiroNome: parceiro.nome, periodo, blocos, appUrl: APP_URL }) };
}

/** Por que este parceiro não recebe dado de cliente (ou null se pode). */
function bloqueio(p: Parceiro): string | null {
  if (!p.ativo) return "vínculo inativo";
  if (!p.email) return "sem e-mail";
  if (parceiroSemAceite(p)) return "sem aceite dos termos vigentes";
  return null;
}

// ---------------------------------------------------------------------------
// Cron: um escritório
// ---------------------------------------------------------------------------
async function rodarEscritorio(admin: SupabaseClient, escritorioId: string, agora: Date, forcar: boolean) {
  const sb = escopado(admin, escritorioId);
  const cfg = await lerConfig(sb);
  if (!forcar && !estaNaHora(cfg, agora)) return { escritorio: escritorioId, fora_da_hora: true };
  const [parceiros, modos] = await Promise.all([lerParceiros(sb, escritorioId), lerModos(sb)]);
  const referencia = relogioDeBrasilia(agora).data;
  const resultado = { escritorio: escritorioId, enviados: 0, sem_novidade: 0, pulados: 0, falhas: 0 };

  for (const p of parceiros) {
    if (!recebeResumo(cfg, modos.get(p.id) ?? "padrao")) continue;
    if (bloqueio(p)) { resultado.pulados++; continue; }

    const periodo = periodoDoResumo(agora);
    // Reserva o dia: o mesmo resumo não sai duas vezes (cron repetido, chamada manual).
    const reserva = await sb.from("resumo_parceiros_envios").insert({
      parceiro_id: p.id,
      referencia,
      periodo_inicio: periodo.inicioIso,
      periodo_fim: periodo.fimIso,
    }).select("id").maybeSingle();
    if (reserva.error) {
      if (reserva.error.code === "23505") continue; // já enviado hoje
      throw new ErroDeLeitura(`reserva: ${reserva.error.message}`);
    }
    const envioId = reserva.data!.id as string;
    try {
      const r = await montarResumo(sb, escritorioId, cfg, p, agora);
      if (r.total === 0) {
        await sb.from("resumo_parceiros_envios").update({ status: "sem_novidade" }).eq("id", envioId);
        resultado.sem_novidade++;
        continue;
      }
      const envio = await enviarEmail({
        de: remetente(r.marca),
        para: [p.email!, ...p.emails_copia.filter((e) => e && e !== p.email)],
        assunto: r.assunto,
        html: r.html,
        texto: r.texto,
      });
      await sb.from("resumo_parceiros_envios").update(
        envio.ok
          ? { status: "enviado", itens: r.total }
          : { status: "falhou", itens: r.total, detalhe: `${envio.status}: ${envio.detalhe.slice(0, 300)}` },
      ).eq("id", envioId);
      if (envio.ok) resultado.enviados++;
      else {
        resultado.falhas++;
        console.error(`[resumo-parceiros] envio falhou (${p.id}):`, envio.status, envio.detalhe);
      }
    } catch (e) {
      resultado.falhas++;
      console.error(`[resumo-parceiros] montagem falhou (${p.id}):`, e);
      await sb.from("resumo_parceiros_envios").update({ status: "falhou", detalhe: String(e).slice(0, 300) }).eq("id", envioId);
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const quem = await exigirUsuarioOuSistema(req, "cron:resumo-parceiros", { tipo: "interno", permissao: "parceiros:gerenciar" });
  if (quem instanceof Response) return quem;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }
  const acao = String(body.acao ?? "");
  const agora = new Date();

  try {
    // ---- Sistema -----------------------------------------------------------
    if (quem.tipo === "sistema") {
      if (acao !== "rodar") return json({ error: "ação de sistema desconhecida" }, 400);
      if (!emailConfigurado()) return json({ error: "RESEND_API_KEY ausente" }, 500);
      const admin = clienteAdmin();
      const configs = checar<Linha[]>(
        await admin.from("resumo_parceiros_config").select("escritorio_id").eq("ativo", true),
        "configs",
      );
      // `forcar` só para teste local/staging: ignora dia e hora (a trava do dia continua).
      const forcar = body.forcar === true;
      const resultados = [];
      for (const c of configs) {
        try {
          resultados.push(await rodarEscritorio(admin, c.escritorio_id, agora, forcar));
        } catch (e) {
          console.error(`[resumo-parceiros] escritório ${c.escritorio_id}:`, e);
          resultados.push({ escritorio: c.escritorio_id, erro: String(e) });
        }
      }
      return json({ ok: true, resultados });
    }

    // ---- Pessoa (parceiros:gerenciar no escritório ativo) -------------------
    const escritorioId = quem.perfil.escritorio_id;
    if (!escritorioId) return json({ error: "sem escritório ativo" }, 400);
    const sb = escopado(quem.admin, escritorioId);

    const acharParceiro = async () => {
      const id = String(body.parceiro_id ?? "");
      const p = (await lerParceiros(sb, escritorioId)).find((x) => x.id === id);
      return p ?? null;
    };

    if (acao === "estado") {
      const [cfg, parceiros, modos, envios] = await Promise.all([
        lerConfig(sb),
        lerParceiros(sb, escritorioId),
        lerModos(sb),
        sb.from("resumo_parceiros_envios").select("parceiro_id, status, itens, criado_em").order("criado_em", { ascending: false }).range(0, 1999),
      ]);
      const ultimos = new Map<string, Linha>();
      for (const e of checar<Linha[]>(envios, "envios")) if (!ultimos.has(e.parceiro_id)) ultimos.set(e.parceiro_id, e);
      return json({
        config: cfg,
        parceiros: parceiros.map((p) => {
          const modo = modos.get(p.id) ?? "padrao";
          return {
            id: p.id,
            nome: p.nome,
            email: p.email,
            ativo: p.ativo,
            modo,
            recebe: recebeResumo(cfg, modo),
            bloqueio: bloqueio(p),
            ultimo_envio: ultimos.get(p.id) ?? null,
          };
        }),
      });
    }

    if (acao === "salvar_config") {
      const cfg = normalizarConfig(body.config);
      const r = await sb.from("resumo_parceiros_config").upsert(
        { escritorio_id: escritorioId, ...cfg, atualizado_por: quem.uid, atualizado_em: agora.toISOString() },
        { onConflict: "escritorio_id" },
      );
      if (r.error) throw new ErroDeLeitura(`salvar config: ${r.error.message}`);
      return json({ ok: true, config: cfg });
    }

    if (acao === "definir_parceiro") {
      const modo = body.modo;
      if (!ehModo(modo)) return json({ error: "modo inválido" }, 400);
      const p = await acharParceiro();
      if (!p) return json({ error: "parceiro não encontrado neste escritório" }, 404);
      const r = modo === "padrao"
        ? await sb.from("resumo_parceiros_preferencia").delete().eq("parceiro_id", p.id)
        : await sb.from("resumo_parceiros_preferencia").upsert(
          { escritorio_id: escritorioId, parceiro_id: p.id, modo, atualizado_por: quem.uid, atualizado_em: agora.toISOString() },
          { onConflict: "escritorio_id,parceiro_id" },
        );
      if (r.error) throw new ErroDeLeitura(`definir parceiro: ${r.error.message}`);
      return json({ ok: true, modo });
    }

    if (acao === "previa" || acao === "teste") {
      const p = await acharParceiro();
      if (!p) return json({ error: "parceiro não encontrado neste escritório" }, 404);
      // A prévia usa os blocos marcados (mesmo com o resumo desligado): é para conferir antes de ligar.
      const cfg = await lerConfig(sb);
      const r = await montarResumo(sb, escritorioId, cfg, p, agora);
      if (acao === "previa") return json({ assunto: r.assunto, html: r.html, total: r.total, periodo: r.periodo.rotulo });
      if (!emailConfigurado()) return json({ error: "envio de e-mail não configurado" }, 500);
      if (!quem.perfil.email) return json({ error: "você não tem e-mail cadastrado" }, 400);
      const envio = await enviarEmail({
        de: remetente(r.marca),
        para: quem.perfil.email,
        assunto: `[Teste — resumo de ${p.nome}] ${r.assunto}`,
        html: r.html,
        texto: r.texto,
      });
      if (!envio.ok) return json({ error: "o envio falhou", status: envio.status }, 502);
      return json({ ok: true, para: quem.perfil.email });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error("[resumo-parceiros]", e);
    return json({ error: e instanceof ErroDeLeitura ? "falha ao ler os dados do resumo" : "falha inesperada" }, 500);
  }
});
