// Exibição de telefone no padrão brasileiro: (DD) 9XXXX-XXXX / (DD) XXXX-XXXX.
//
// O banco guarda o número como veio (em geral só dígitos, ex.: "17997227424");
// nas telas isso aparecia cru. Esta função é só de EXIBIÇÃO — não altera o
// que está salvo nem substitui as máscaras de input dos formulários.
//
// Aceita DDI 55 na frente (13 dígitos) e descarta. Qualquer outra coisa que
// não seja 10 ou 11 dígitos volta como está (não inventa formato pra número
// estrangeiro, ramal, etc.).
export function formatarTelefone(v: string | null | undefined): string {
  if (!v) return "";
  let d = v.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}
