// Como o CPF aparece na tela. `maskCPFParceiro` é o que o parceiro vê antes de
// pedir o número completo (olhinho).

export function maskCPF(cpf: string): string {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return cpf;
  return c.slice(0, 3) + "." + c.slice(3, 6) + "." + c.slice(6, 9) + "-" + c.slice(9);
}

export function maskCPFParceiro(cpf: string): string {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return cpf;
  return "***." + c.slice(3, 6) + "." + c.slice(6, 9) + "-**";
}
