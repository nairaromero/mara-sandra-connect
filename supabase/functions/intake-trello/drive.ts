// =============================================================================
// Google Drive (leitura) pro intake do Trello.
//
// Access token vem do refresh token guardado em `usuario_gmail_oauth`
// (mesma conexão Google do Gmail; escopo drive.readonly adicionado em
// gmail-oauth-start). A listagem imita o alcance do robô n8n V2.2: pasta do
// cliente + até 2 níveis de subpasta.
// =============================================================================

export interface DriveArquivo {
  id: string;
  name: string;
  mimeType: string;
  size: number; // bytes; 0 quando o Drive não informa
  /** Caminho relativo dentro da pasta do cliente, só informativo ("Laudos/x.pdf"). */
  caminho: string;
}

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Docs nativos do Google (Docs/Sheets/...) não têm binário pra baixar direto. */
function ehNativoGoogle(mime: string): boolean {
  return mime.startsWith("application/vnd.google-apps");
}

/** O robô antigo ignorava Word — mantemos: são minutas, não documentos do cliente. */
function ehWord(mime: string, nome: string): boolean {
  return (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx?$/i.test(nome)
  );
}

async function listarFilhos(
  accessToken: string,
  folderId: string,
): Promise<Array<{ id: string; name: string; mimeType: string; size?: string }>> {
  const resultado: Array<{ id: string; name: string; mimeType: string; size?: string }> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const resp = await fetch(`${FILES_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      throw new Error(`Drive list ${folderId}: HTTP ${resp.status} ${await resp.text()}`);
    }
    const json = (await resp.json()) as {
      nextPageToken?: string;
      files?: Array<{ id: string; name: string; mimeType: string; size?: string }>;
    };
    resultado.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return resultado;
}

/**
 * Lista os arquivos baixáveis da pasta do cliente, descendo até `profundidade`
 * níveis de subpasta (2 = igual ao n8n). Word e docs nativos do Google ficam
 * de fora; o chamador ainda deve aplicar o limite de tamanho do bucket.
 */
export async function listarArquivosPasta(
  accessToken: string,
  folderId: string,
  profundidade = 2,
  prefixo = "",
): Promise<Array<DriveArquivo>> {
  const filhos = await listarFilhos(accessToken, folderId);
  const arquivos: Array<DriveArquivo> = [];
  for (const f of filhos) {
    if (f.mimeType === FOLDER_MIME) {
      if (profundidade > 0) {
        arquivos.push(
          ...(await listarArquivosPasta(
            accessToken,
            f.id,
            profundidade - 1,
            `${prefixo}${f.name}/`,
          )),
        );
      }
      continue;
    }
    if (ehNativoGoogle(f.mimeType) || ehWord(f.mimeType, f.name)) continue;
    arquivos.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: Number(f.size ?? 0),
      caminho: `${prefixo}${f.name}`,
    });
  }
  return arquivos;
}

export async function baixarArquivo(accessToken: string, fileId: string): Promise<Uint8Array> {
  const resp = await fetch(`${FILES_URL}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(90_000),
  });
  if (!resp.ok) {
    throw new Error(`Drive download ${fileId}: HTTP ${resp.status} ${await resp.text()}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

/** Troca o refresh token (descriptografado pelo chamador) por um access token. */
export async function obterAccessTokenGoogle(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Google token: HTTP ${resp.status} ${await resp.text()}`);
  }
  const json = (await resp.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google token: resposta sem access_token");
  return json.access_token;
}
