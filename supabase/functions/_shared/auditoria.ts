// Túnel único da trilha do escritório para as EDGE FUNCTIONS.
//
// Por que existe: em 27/09 quatro functions passaram a registrar na `auditoria`
// e cada uma montou o insert à mão, repetindo `tipo_ator: "membro"`, o
// `escritorio_id`, o `ator_id` e um tratamento de erro diferente — uma delas
// engolia a falha em silêncio. Quatro pontos fazendo a mesma coisa é quatro
// jeitos de errar: basta um esquecer o `escritorio_id` para a linha nascer
// órfã, ou trocar o `tipo_ator` para ela vazar no `qg_auditoria`, que lê
// `plataforma` e `suporte`.
//
// Aqui a entrada é UMA, e o que não pode variar não é parâmetro:
//
//   · `escritorio_id` e `ator_id` vêm do `quem` autenticado — o chamador não
//     tem como passar o escritório de outra pessoa;
//   · `tipo_ator` é sempre `membro`, porque function de produto age pelo
//     escritório. `plataforma`/`suporte` só nascem no lado SQL (família `qg_*`);
//   · `acao` é um tipo fechado: nome novo entra em `AcaoAuditada` primeiro, o
//     que faz o compilador pegar erro de digitação e dá a lista de tudo que se
//     registra num lugar só.
//
// A trilha NUNCA derruba a operação: falha vira `console.error` com prefixo
// uniforme, e quem chamou segue. Perder o rastro é ruim; travar o trabalho do
// escritório por causa do rastro é pior.
//
// Irmão no banco: `private.auditar` (migration_rbac_07/25), que é o túnel das
// RPCs. Os dois escrevem na mesma tabela com as mesmas regras; o que muda é o
// runtime de quem chama.
import type { ChamadorPessoa } from "./auth.ts";

/**
 * As ações que as edge functions registram. Fechada de propósito: é a lista de
 * "o que o produto considera digno de trilha", e cresce por decisão, não por
 * distração. As ações do lado SQL (equipe.*, cliente.*, suporte.*, qg.*) não
 * entram aqui porque não são escritas daqui.
 */
export type AcaoAuditada =
  | "equipe.convidado"
  | "parceiro.convidado"
  | "parceiro.email_alterado"
  | "parceiro.excluido"
  | "integracao.salvar"
  | "integracao.testar"
  | "integracao.token";

export interface EntradaAuditoria {
  acao: AcaoAuditada;
  /** Tabela ou área a que a linha se refere (ex.: "usuarios"). */
  recurso: string;
  /** Id do registro tocado. Nulo só quando a ação não tem um. */
  recurso_id?: string | null;
  /** O que aconteceu, em campos curtos. Antes e depois quando houver os dois. */
  detalhes?: Record<string, unknown>;
}

/**
 * Registra uma linha na trilha do escritório de quem está chamando.
 *
 * Não lança: devolve `true` se gravou, `false` se não deu — o chamador pode
 * ignorar sem risco, e o motivo fica no log.
 */
export async function auditar(quem: ChamadorPessoa, entrada: EntradaAuditoria): Promise<boolean> {
  const escritorioId = quem.perfil.escritorio_id;
  if (!escritorioId) {
    // Banco sem as migrations do RBAC: não há escritório a que pendurar a
    // linha. Não é erro do chamador, e o lado SQL também não audita sem isso.
    console.warn(`[auditoria] ${entrada.acao}: sem escritório no contexto — não registrada`);
    return false;
  }
  if (!entrada.recurso) {
    console.error(`[auditoria] ${entrada.acao}: recurso vazio — não registrada`);
    return false;
  }

  const { error } = await quem.admin.from("auditoria").insert({
    escritorio_id: escritorioId,
    ator_id: quem.uid,
    tipo_ator: "membro",
    acao: entrada.acao,
    recurso: entrada.recurso,
    recurso_id: entrada.recurso_id ?? null,
    detalhes: entrada.detalhes ?? {},
  });
  if (error) {
    console.error(`[auditoria] ${entrada.acao} em ${entrada.recurso}: ${error.message}`);
    return false;
  }
  return true;
}
