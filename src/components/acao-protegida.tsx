// Gate único das ações de escrita: envolve o botão (ou o bloco) e só o mostra
// para quem o SERVIDOR aceitaria.
//
// Em vez de repetir `isInterno && pode("documentos:excluir")` em cada tela — e
// errar a permissão, esquecer o gate ou ignorar o escopo, como a auditoria de
// 24/09 encontrou em ~40 lugares (planning/RBAC_AUDITORIA_TELAS.md) —, aponte
// para o ALVO e deixe a exigência ser resolvida no espelho
// (`src/lib/rbac/exigencias.ts`), que é conferido contra o banco por
// `scripts/rbac-conferir-exigencias.mjs`.
//
//   <AcaoProtegida escrever="tarefas">
//     <Button onClick={novaTarefa}>Nova tarefa</Button>
//   </AcaoProtegida>
//
//   <AcaoProtegida escrever="documentos" operacao="excluir">…</AcaoProtegida>
//   <AcaoProtegida chamar="excluir-parceiro">…</AcaoProtegida>
//
// Para lógica (e não JSX), use o hook `usePodeAcao` no fim deste arquivo.
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { Operacao } from "@/lib/rbac/exigencias";

interface Props {
  /** Tabela em que a ação escreve (resolve permissão e escopo sozinho). */
  escrever?: string;
  /** Operação na tabela; o padrão é inserir. `documentos` exige outra permissão para excluir. */
  operacao?: Operacao;
  /** Nome da RPC ou da edge function que a ação chama. */
  chamar?: string;
  /** Saída de emergência: permissão crua, para o que não é tabela nem chamada (ex.: leitura). */
  permissao?: string;
  /**
   * Exigir que a pessoa seja interna (padrão). A tela do parceiro é outra, com
   * ramos próprios; passe `false` num componente que sirva aos dois.
   */
  exigeInterno?: boolean;
  /** O que mostrar quando não pode (o padrão é não mostrar nada). */
  alternativa?: ReactNode;
  children: ReactNode;
}

/** Resolve a decisão, sem JSX — para `disabled`, menus e early-returns. */
export function usePodeAcao(opcoes: Omit<Props, "children" | "alternativa">): boolean {
  const { usuario, pode, podeEscrever, podeChamar } = useAuth();
  const { escrever, operacao, chamar, permissao, exigeInterno = true } = opcoes;
  if (exigeInterno && usuario?.tipo !== "interno") return false;
  if (escrever && !podeEscrever(escrever, operacao)) return false;
  if (chamar && !podeChamar(chamar)) return false;
  if (permissao && !pode(permissao)) return false;
  return true;
}

export function AcaoProtegida({ children, alternativa = null, ...opcoes }: Props) {
  return usePodeAcao(opcoes) ? <>{children}</> : <>{alternativa}</>;
}
