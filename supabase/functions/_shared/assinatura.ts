// Assinatura eletrônica (#517): o que a TELA e as FUNCTIONS precisam dizer igual
// sobre um envio — os status, quais contam como "em curso", o formato do
// signatário e que arquivo o ZapSign aceita.
//
// Módulo PURO (só importa outro puro de _shared): a tela importa por
// `@shared/assinatura`, as functions por `../_shared/assinatura.ts`. O banco
// repete só o check de status (`assinaturas_status_check`) e o índice de "um
// envio em curso por documento"; a régua e2e/unit/zapsign-fonte-unica.test.ts
// confere que o SQL diz o mesmo e que ninguém reescreve estas listas.
import { extensaoDe } from "./arquivo-ia.ts";

export const STATUS_ASSINATURA = ["enviando", "enviado", "aberto", "gravando", "assinado", "recusado", "cancelado"] as const;
export type StatusAssinatura = (typeof STATUS_ASSINATURA)[number];

/** Envios que ainda dependem de alguém assinar (ou do PDF chegar): um por documento. */
export const EM_CURSO: ReadonlyArray<StatusAssinatura> = ["enviando", "enviado", "aberto", "gravando"];

export type StatusSignatario = "pendente" | "abriu" | "assinou";

export interface Signatario {
  nome: string;
  papel: "cliente" | "escritorio";
  email: string;
  telefone: string;
  token: string;
  sign_url: string;
  status: StatusSignatario;
  assinado_em: string | null;
}

/** O ZapSign aceita PDF e DOCX; `null` = este arquivo não vai para assinatura. */
export function formatoAssinavel(nomeArquivo: string | null | undefined): "pdf" | "docx" | null {
  const ext = extensaoDe(nomeArquivo);
  return ext === "pdf" || ext === "docx" ? ext : null;
}
