// =============================================================================
// Parsing do card do Trello -> dados de cliente/caso.
//
// O André preenche os cards num modelo ("CPF:", "Senha GOV.BR:", "Zap:", ...),
// mas nem sempre segue à risca — há cards em texto corrido ("Senha INSS: x",
// "Whatsapp: y" no meio de markdown). As regexes vieram do workflow n8n V2.2
// (que rodou nesse board por 2 anos) com tolerância extra pros formatos reais
// vistos em 2026-08 (ver planning/INTEGRACAO_TRELLO.md).
//
// Funções puras, sem I/O — testáveis fora do Deno.
// =============================================================================

export interface CardParseado {
  nome: string;
  cpf: string | null; // só dígitos (11) ou null
  cidade: string | null;
  estado: string | null; // UF maiúscula
  celular: string | null; // só dígitos, 10-11
  senhaMeuInss: string | null;
  /** Descrição do card SEM a linha da senha — vai pro caso; a senha nunca. */
  relato: string;
  driveFolderId: string | null;
}

/** Título do card menos anotações entre parênteses: "Fulano (OKADO)" -> "Fulano". */
export function extrairNome(tituloCard: string): string {
  return tituloCard.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}

export function extrairCpf(desc: string): string | null {
  const m = desc.match(/CPF[^\d\n]*([\d][\d.\s/-]{9,17})/i);
  if (!m) return null;
  const dig = m[1].replace(/\D/g, "");
  return dig.length === 11 ? dig : null;
}

export function extrairCidadeEstado(desc: string): { cidade: string | null; estado: string | null } {
  // Modelo: "Cidade/Estado: Sorocaba / SP" (com ou sem espaços)
  let m = desc.match(/Cidade\s*\/\s*Estado[:\s]+([^/\n]+?)\s*\/\s*([A-Za-z]{2})\b/i);
  if (!m) {
    // Texto corrido: "residente em Sorocaba/SP", "na cidade de Itu/SP"
    m = desc.match(
      /(?:cidade\s+de|residente\s+em|domiciliad[oa]?\s+em|na\s+cidade\s+de)\s+([A-ZÀ-Úa-zà-ú][^/\n,.]{1,50}?)\s*\/\s*([A-Za-z]{2})\b/i,
    );
  }
  if (!m) {
    // Card do TikTok: linha isolada "Santo André/SP"
    m = desc.match(/^\s*([A-ZÀ-Ú][A-Za-zÀ-úà-ú' ]{2,40})\s*\/\s*([A-Z]{2})\s*$/m);
  }
  if (!m) {
    // Editor do Trello às vezes come a barra do valor: "Cidade/Estado: Sorocaba  SP"
    m = desc.match(/Cidade\s*\/\s*Estado[:\s]+([A-ZÀ-Ú][A-Za-zÀ-úà-ú' ]{1,40}?)\s+([A-Z]{2})\s*$/im);
  }
  if (!m) return { cidade: null, estado: null };
  return {
    cidade: m[1].trim().replace(/[,. ]+$/, ""),
    estado: m[2].toUpperCase(),
  };
}

export function extrairCelular(desc: string): string | null {
  const m = desc.match(
    /(?:Zap|Celular|Cel\.?|Tel\.?(?:efones?)?|Whatsapp|Whats|Fone)\**\s*[:\s]\s*\**([\d\s()+.-]{8,20})/i,
  );
  if (!m) return null;
  const dig = m[1].replace(/\D/g, "");
  if (dig.length < 10 || dig.length > 13) return null;
  // 55DD9XXXXXXXX -> fica com os 11 finais (DDD + numero)
  return dig.length >= 11 ? dig.slice(-11) : dig;
}

/**
 * Senha do gov.br / Meu INSS. Formatos reais:
 *   "Senha GOV.BR: abc123"
 *   "Senha [GOV.BR](http://GOV.BR): abc123"   (markdown do Trello)
 *   "_**Senha INSS: abc123**_"
 * Pega o que vem depois do ÚLTIMO ":" da linha (evita capturar o link markdown)
 * e descarta ruído de formatação.
 */
export function extrairSenha(desc: string): string | null {
  const linha = desc.split("\n").find((l) => /senha/i.test(l));
  if (!linha) return null;
  const pos = linha.lastIndexOf(":");
  if (pos === -1) return null;
  const valor = linha
    .slice(pos + 1)
    .replace(/[*_`]/g, "")
    .trim();
  // Linha do modelo em branco ("Senha GOV.BR:") ou só resto de markdown.
  if (!valor || /^https?:\/\//i.test(valor)) return null;
  return valor;
}

/** Remove do texto as linhas que contêm senha — o relato vai pro caso em claro. */
export function removerLinhaSenha(desc: string): string {
  return desc
    .split("\n")
    .filter((l) => !/senha/i.test(l))
    .join("\n")
    .trim();
}

/** ID da pasta do Drive a partir de qualquer formato de URL de anexo. */
export function extrairDriveFolderId(urls: Array<string>): string | null {
  for (const url of urls) {
    if (!url || !url.includes("drive.google.com")) continue;
    const m1 = url.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (m1) return m1[1];
    const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) return m2[1];
  }
  return null;
}

export function parsearCard(
  titulo: string,
  desc: string,
  attachmentUrls: Array<string>,
): CardParseado {
  const { cidade, estado } = extrairCidadeEstado(desc || "");
  return {
    nome: extrairNome(titulo || ""),
    cpf: extrairCpf(desc || ""),
    cidade,
    estado,
    celular: extrairCelular(desc || ""),
    senhaMeuInss: extrairSenha(desc || ""),
    relato: removerLinhaSenha(desc || ""),
    driveFolderId: extrairDriveFolderId(attachmentUrls),
  };
}
