// Resumo periódico para parceiros — o que a TELA e a FUNCTION precisam dizer
// igual: os blocos do e-mail, os modos do parceiro, quem recebe, quando é a
// hora e o próprio e-mail.
//
// Módulo PURO (sem Deno, sem rede): a tela importa por `@shared/resumo-parceiros`
// (prévia e opções), a function `resumo-parceiros` por `../_shared/…`. O banco
// repete só os checks (migration_resumo_parceiros.sql); a régua
// e2e/unit/resumo-parceiros.test.ts confere que dizem o mesmo.
//
// BLOCO NOVO (ex.: perícias agendadas): uma entrada em SECOES_RESUMO, a consulta
// dela em `CONSULTAS` da function (o tsc cobra) e o valor no check
// `resumo_parceiros_config_secoes_check` (a régua cobra).

export const SECOES_RESUMO = [
  {
    id: "andamentos",
    rotulo: "Andamentos dos processos",
    explicacao: "Os andamentos visíveis ao parceiro lançados no período.",
    vazio: "Nenhum andamento novo no período.",
  },
  {
    id: "requerimentos",
    rotulo: "Requerimentos protocolados no INSS",
    explicacao: "Requerimentos administrativos com data de protocolo no período.",
    vazio: "Nenhum requerimento protocolado no período.",
  },
  {
    id: "judiciais",
    rotulo: "Processos judiciais ajuizados",
    explicacao: "Processos judiciais distribuídos (ou cadastrados) no período.",
    vazio: "Nenhum processo judicial ajuizado no período.",
  },
] as const;

export type SecaoResumoId = (typeof SECOES_RESUMO)[number]["id"];
export const IDS_SECOES: ReadonlyArray<SecaoResumoId> = SECOES_RESUMO.map((s) => s.id);

/** O que o parceiro escolheu. `padrao` = sem linha no banco, segue o escritório. */
export const MODOS_RESUMO = ["padrao", "sempre", "nunca"] as const;
export type ModoResumo = (typeof MODOS_RESUMO)[number];
export const ROTULO_MODO: Record<ModoResumo, string> = {
  padrao: "Segue o padrão do escritório",
  sempre: "Sempre recebe",
  nunca: "Nunca recebe",
};

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export interface ConfigResumo {
  ativo: boolean;
  /** 0 = domingo … 6 = sábado, no horário de Brasília. */
  dia_semana: number;
  /** 0–23, horário de Brasília. */
  hora: number;
  /** Parceiro sem escolha própria recebe? */
  padrao_parceiros: boolean;
  secoes: SecaoResumoId[];
}

/** Escritório que nunca configurou: desligado, sexta às 20h, todos os blocos. */
export const CONFIG_PADRAO: ConfigResumo = {
  ativo: false,
  dia_semana: 5,
  hora: 20,
  padrao_parceiros: false,
  secoes: [...IDS_SECOES],
};

/** Período coberto: os 7 dias que terminam no envio. */
export const DIAS_DO_PERIODO = 7;

/** Lê o que veio do banco ou da tela; o que não for válido cai no padrão. */
export function normalizarConfig(raw: unknown): ConfigResumo {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inteiro = (v: unknown, min: number, max: number, padrao: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
  };
  const secoes = Array.isArray(r.secoes)
    ? IDS_SECOES.filter((id) => (r.secoes as unknown[]).includes(id))
    : [...CONFIG_PADRAO.secoes];
  return {
    ativo: r.ativo === true,
    dia_semana: inteiro(r.dia_semana, 0, 6, CONFIG_PADRAO.dia_semana),
    hora: inteiro(r.hora, 0, 23, CONFIG_PADRAO.hora),
    padrao_parceiros: r.padrao_parceiros === true,
    secoes,
  };
}

export function ehModo(v: unknown): v is ModoResumo {
  return typeof v === "string" && (MODOS_RESUMO as ReadonlyArray<string>).includes(v);
}

/**
 * A ÚNICA regra de quem recebe. Desligado no escritório = ninguém; senão a
 * escolha do parceiro, e sem escolha o padrão do escritório. Aceite e vínculo
 * ativo são conferidos à parte (a function não manda dado de cliente a quem não
 * aceitou os termos — `parceiroSemAceite`).
 */
export function recebeResumo(cfg: ConfigResumo, modo: ModoResumo): boolean {
  if (!cfg.ativo || cfg.secoes.length === 0) return false;
  if (modo === "sempre") return true;
  if (modo === "nunca") return false;
  return cfg.padrao_parceiros;
}

// Brasília sem horário de verão desde 2019: UTC-3 fixo (mesma conta do digest-diario).
const OFFSET_BRASILIA_MS = 3 * 60 * 60 * 1000;

export interface Relogio {
  /** 0 = domingo … 6 = sábado */
  dia: number;
  hora: number;
  /** AAAA-MM-DD */
  data: string;
}

export function relogioDeBrasilia(agora: Date): Relogio {
  const br = new Date(agora.getTime() - OFFSET_BRASILIA_MS);
  return { dia: br.getUTCDay(), hora: br.getUTCHours(), data: br.toISOString().slice(0, 10) };
}

/** O cron roda de hora em hora; manda quem tem o dia e a hora de agora. */
export function estaNaHora(cfg: ConfigResumo, agora: Date): boolean {
  const r = relogioDeBrasilia(agora);
  return cfg.ativo && r.dia === cfg.dia_semana && r.hora === cfg.hora;
}

export interface Periodo {
  inicioIso: string;
  fimIso: string;
  /** Dias (Brasília) para os campos `date` — protocolo e distribuição. */
  inicioDia: string;
  fimDia: string;
  /** "17/11 a 23/11/2026" */
  rotulo: string;
}

function ddmm(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

export function periodoDoResumo(agora: Date): Periodo {
  const inicio = new Date(agora.getTime() - DIAS_DO_PERIODO * 24 * 60 * 60 * 1000);
  const fimDia = relogioDeBrasilia(agora).data;
  // o dia seguinte ao início: "7 dias" = de sábado a sexta, não de sexta a sexta
  const inicioDia = relogioDeBrasilia(new Date(inicio.getTime() + 24 * 60 * 60 * 1000)).data;
  return {
    inicioIso: inicio.toISOString(),
    fimIso: agora.toISOString(),
    inicioDia,
    fimDia,
    rotulo: `${ddmm(inicioDia)} a ${ddmm(fimDia)}/${fimDia.slice(0, 4)}`,
  };
}

/** Um item do e-mail, já resolvido pela consulta do bloco. */
export interface ItemResumo {
  casoId: string;
  cliente: string;
  titulo: string;
  /** Linha de baixo: número, vara, benefício… */
  detalhe: string;
  /** AAAA-MM-DD ou ISO; só para mostrar e ordenar. */
  data: string | null;
}

export interface BlocoResumo {
  id: SecaoResumoId;
  itens: ItemResumo[];
}

export interface MarcaDoEmail {
  nome: string;
  logoUrl: string | null;
  cor: string | null;
}

export function totalDeItens(blocos: BlocoResumo[]): number {
  return blocos.reduce((n, b) => n + b.itens.length, 0);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dataCurta(d: string | null): string {
  if (!d) return "";
  const dia = d.length > 10 ? relogioDeBrasilia(new Date(d)).data : d;
  return ddmm(dia);
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome;
}

/**
 * O e-mail. Andamentos vêm agrupados por cliente (são muitos: ~150 numa semana
 * de um parceiro grande); protocolos, um por linha. Cada item leva ao caso.
 */
export function montarEmailResumo(o: {
  marca: MarcaDoEmail;
  parceiroNome: string;
  periodo: Periodo;
  blocos: BlocoResumo[];
  appUrl: string;
}): { assunto: string; html: string; texto: string; total: number } {
  const cor = o.marca.cor && /^#[0-9a-f]{3,8}$/i.test(o.marca.cor) ? o.marca.cor : "#c9a14a";
  const app = o.appUrl.replace(/\/+$/, "");
  const linkCaso = (id: string) => `${app}/casos/${id}`;
  const total = totalDeItens(o.blocos);
  const contagem = (id: SecaoResumoId) => o.blocos.find((b) => b.id === id)?.itens.length;

  const resumoTopo = o.blocos
    .map((b) => {
      const s = SECOES_RESUMO.find((x) => x.id === b.id)!;
      return `<td style="padding:10px 8px;text-align:center;background:#faf8f3;border-radius:6px">` +
        `<div style="font-size:22px;font-weight:600;color:#111">${b.itens.length}</div>` +
        `<div style="font-size:11px;color:#6b7280;line-height:1.3">${esc(s.rotulo)}</div></td>`;
    })
    .join(`<td style="width:8px"></td>`);

  const secoesHtml = o.blocos.map((b) => {
    const s = SECOES_RESUMO.find((x) => x.id === b.id)!;
    const titulo = `<h3 style="margin:28px 0 8px;font-size:15px;color:#111;border-left:3px solid ${cor};padding-left:8px">` +
      `${esc(s.rotulo)} <span style="color:#9ca3af;font-weight:normal">(${b.itens.length})</span></h3>`;
    if (b.itens.length === 0) {
      return titulo + `<p style="color:#9ca3af;font-size:13px;margin:4px 0 0">${esc(s.vazio)}</p>`;
    }
    if (b.id === "andamentos") {
      const porCaso = new Map<string, ItemResumo[]>();
      for (const i of b.itens) porCaso.set(i.casoId, [...(porCaso.get(i.casoId) ?? []), i]);
      const grupos = [...porCaso.values()]
        .sort((a, z) => a[0].cliente.localeCompare(z[0].cliente, "pt-BR"))
        .map((itens) => {
          const linhas = itens
            .map((i) =>
              `<div style="font-size:13px;color:#374151;margin:3px 0 0 0">` +
              `<span style="color:#9ca3af">${esc(dataCurta(i.data))}</span>&nbsp; ${esc(i.titulo)}` +
              (i.detalhe ? `<div style="font-size:12px;color:#6b7280;margin-left:42px">${esc(i.detalhe)}</div>` : "") +
              `</div>`
            )
            .join("");
          return `<div style="padding:10px 0;border-bottom:1px solid #f0ede6">` +
            `<a href="${linkCaso(itens[0].casoId)}" style="color:#111;font-weight:600;font-size:14px;text-decoration:none">` +
            `${esc(itens[0].cliente)}</a> <span style="color:#9ca3af;font-size:12px">· ${itens.length} andamento${itens.length === 1 ? "" : "s"}</span>` +
            linhas + `</div>`;
        })
        .join("");
      return titulo + grupos;
    }
    const linhas = b.itens
      .map((i) =>
        `<div style="padding:10px 0;border-bottom:1px solid #f0ede6">` +
        `<a href="${linkCaso(i.casoId)}" style="color:#111;font-weight:600;font-size:14px;text-decoration:none">${esc(i.cliente)}</a>` +
        `<span style="color:#9ca3af;font-size:12px"> · ${esc(dataCurta(i.data))}</span>` +
        `<div style="font-size:13px;color:#374151;margin-top:2px">${esc(i.titulo)}</div>` +
        (i.detalhe ? `<div style="font-size:12px;color:#6b7280">${esc(i.detalhe)}</div>` : "") +
        `</div>`
      )
      .join("");
    return titulo + linhas;
  }).join("");

  const cabecalho = o.marca.logoUrl
    ? `<img src="${esc(o.marca.logoUrl)}" alt="${esc(o.marca.nome)}" style="max-height:48px;max-width:220px">`
    : `<div style="font-size:18px;font-weight:600;color:#111">${esc(o.marca.nome)}</div>`;

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Resumo da semana</title></head>` +
    `<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px 12px">` +
    `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">` +
    cabecalho +
    `<h2 style="margin:20px 0 4px;font-size:20px;color:#111">Resumo da semana</h2>` +
    `<p style="margin:0;color:#6b7280;font-size:13px">${esc(o.periodo.rotulo)}</p>` +
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.5">Olá, ${esc(primeiroNome(o.parceiroNome))}. ` +
    `Este é o resumo do que aconteceu nos casos que você indicou nos últimos ${DIAS_DO_PERIODO} dias.</p>` +
    `<table role="presentation" style="width:100%;border-collapse:separate;margin:18px 0 0"><tr>${resumoTopo}</tr></table>` +
    secoesHtml +
    `<p style="margin:28px 0 0"><a href="${app}" style="background:${cor};color:#fff;padding:10px 20px;border-radius:6px;` +
    `text-decoration:none;display:inline-block;font-size:14px">Abrir o sistema</a></p>` +
    `</div>` +
    `<p style="color:#9ca3af;font-size:12px;text-align:center;margin:16px 0 0">${esc(o.marca.nome)} · Legal Connect<br>` +
    `Você recebe este resumo porque o escritório o ativou para você.</p>` +
    `</div></body></html>`;

  const partes = [
    contagem("andamentos") !== undefined ? `${contagem("andamentos")} andamentos` : null,
    contagem("requerimentos") !== undefined ? `${contagem("requerimentos")} requerimentos` : null,
    contagem("judiciais") !== undefined ? `${contagem("judiciais")} processos ajuizados` : null,
  ].filter(Boolean);
  const assunto = `Resumo da semana ${o.periodo.rotulo} — ${partes.join(" · ")}`;

  const texto = [
    `Resumo da semana (${o.periodo.rotulo})`,
    ...o.blocos.flatMap((b) => {
      const s = SECOES_RESUMO.find((x) => x.id === b.id)!;
      return [
        "",
        `${s.rotulo} (${b.itens.length})`,
        ...(b.itens.length === 0 ? [s.vazio] : b.itens.map((i) => `- ${dataCurta(i.data)} ${i.cliente}: ${i.titulo}${i.detalhe ? ` (${i.detalhe})` : ""}`)),
      ];
    }),
    "",
    app,
  ].join("\n");

  return { assunto, html, texto, total };
}
