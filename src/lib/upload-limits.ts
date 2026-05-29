// =============================================================================
// Limites e validacao de upload.
//
// Tem que bater com `migration_aumenta_limite_upload.sql` (storage.buckets
// file_size_limit). Se mudar aqui, mudar la tambem (e vice-versa).
// =============================================================================

/** Limite por arquivo em MB. Buckets `documentos`, `cnis-uploads`, `contratos`. */
export const MAX_FILE_SIZE_MB = 50;

/** Mesmo valor em bytes — util pra comparar com File.size direto. */
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** Formata bytes em string legivel (KB/MB). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Valida tamanho de arquivo antes de chamar supabase.storage.upload().
 * Retorna `null` se ok, ou string com mensagem de erro pra exibir ao usuario.
 *
 * Exemplo:
 *   const erro = validateFileSize(file);
 *   if (erro) { toast.error(erro); return; }
 */
export function validateFileSize(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return (
      'O arquivo "' +
      file.name +
      '" tem ' +
      formatFileSize(file.size) +
      ", maior que o limite de " +
      MAX_FILE_SIZE_MB +
      " MB. Tente reduzir/comprimir o PDF ou dividir em partes."
    );
  }
  return null;
}

/**
 * Valida uma lista de arquivos. Retorna array de mensagens de erro (vazio se
 * todos ok). Usa-se quando o upload e multiplo — agrega os arquivos invalidos.
 */
export function validateFileSizes(files: File[]): string[] {
  const erros: string[] = [];
  for (const f of files) {
    const e = validateFileSize(f);
    if (e) erros.push(e);
  }
  return erros;
}
