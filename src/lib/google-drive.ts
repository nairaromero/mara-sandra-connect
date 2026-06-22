// =============================================================================
// Google Drive Picker integration (Fase 51).
//
// Padrao usado: vanilla script tag loading + Google Identity Services + Picker.
// Sem dependencias adicionais no package.json.
//
// Doc oficial: https://developers.google.com/drive/picker/reference/picker
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

// Credenciais publicas do Google Drive Picker. Sao publicas por design
// (Picker eh client-side, browser ja teria acesso de qualquer jeito).
// A protecao real vem das restricoes configuradas no Google Cloud Console:
//   - Origens JavaScript autorizadas no OAuth Client (3 dominios)
//   - HTTP referrer restrictions + API restrictions na API Key
//   - Test users na tela de consentimento OAuth (Mara + Naira)
//
// IMPORTANTE: Hardcoded SEM fallback pra env var, porque Vite/Cloudflare
// estavam injetando valor truncado de VITE_GOOGLE_CLIENT_ID e o tree-shaking
// removia o fallback hardcoded. Pra rotacionar credenciais: troca aqui +
// push. Pra revogar acesso: deleta o OAuth Client no Google Cloud.
const EFFECTIVE_CLIENT_ID =
  "978674501365-09qagpatgq5qb0m1hqq593isi486egjl.apps.googleusercontent.com";
const EFFECTIVE_API_KEY = "AIzaSyDJmRookKnEBkg_aLxirFY4lJH13vgCfkQ";

// drive.file: acesso só aos arquivos que o app criou ou que o usuário
// abriu via Picker. Suficiente pra:
//  - listar/baixar pastas vinculadas (Picker registra escopo na pasta)
//  - subir novos arquivos
//  - renomear/deletar os subidos pelo app
// Mais seguro que escopo "drive" (acesso total) que exigiria revisão
// de segurança do Google.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Falha rapida se as env vars nao estao configuradas (build cru). */
export function isGoogleDriveConfigured(): boolean {
  return !!EFFECTIVE_CLIENT_ID && !!EFFECTIVE_API_KEY;
}

// ---------------------------------------------------------------------------
// Carregamento dos scripts (idempotente)
// ---------------------------------------------------------------------------
let scriptsLoadingPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("document indisponível (SSR)"));
      return;
    }
    const existing = document.querySelector(
      `script[src="${src}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      if ((existing as any)._loaded) {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error("Falha ao carregar " + src)),
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      (script as any)._loaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Falha ao carregar " + src));
    document.head.appendChild(script);
  });
}

async function loadGoogleScripts(): Promise<void> {
  if (scriptsLoadingPromise) return scriptsLoadingPromise;

  scriptsLoadingPromise = (async () => {
    // 1) Google API JS (pra gapi.load do picker)
    await loadScript("https://apis.google.com/js/api.js");

    // 2) Google Identity Services (auth)
    await loadScript("https://accounts.google.com/gsi/client");

    // 3) Carrega o modulo picker do gapi
    await new Promise<void>((resolve, reject) => {
      if (!window.gapi) {
        reject(new Error("gapi não disponível após carregar api.js"));
        return;
      }
      window.gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Falha ao carregar gapi.picker")),
      });
    });
  })();

  return scriptsLoadingPromise;
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------
export interface DrivePickedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number; // 0 se nao informado
  iconUrl?: string;
  /** "file" ou "folder" */
  type: string;
  /**
   * Quando vem de listagem recursiva, indica a subpasta dentro da pasta raiz.
   * Ex.: "Subpasta A/Outra" ou "" (vazio) se esta na raiz.
   */
  pastaRelativa?: string;
}

export interface DrivePickerResult {
  files: DrivePickedFile[];
  accessToken: string;
}

/**
 * Abre o Google Picker. Retorna promise que resolve com arquivos selecionados
 * + access token (necessario pra baixar os arquivos depois).
 *
 * Se o usuario cancelar, resolve com files=[] e accessToken="".
 */
export function abrirDrivePicker(): Promise<DrivePickerResult> {
  if (!EFFECTIVE_CLIENT_ID || !EFFECTIVE_API_KEY) {
    return Promise.reject(
      new Error("Google Drive não configurado (credenciais ausentes)"),
    );
  }

  return new Promise(async (resolve, reject) => {
    try {
      await loadGoogleScripts();
    } catch (err) {
      reject(err);
      return;
    }

    // Token client OAuth (Google Identity Services)
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: EFFECTIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp.error) {
          reject(new Error("Falha OAuth: " + resp.error));
          return;
        }
        const accessToken = resp.access_token as string;
        if (!accessToken) {
          reject(new Error("Sem access_token na resposta OAuth"));
          return;
        }
        abrirPickerComToken(accessToken, resolve);
      },
    });

    // Pede consentimento. Na primeira vez abre o popup OAuth do Google;
    // depois geralmente reusa sessao silenciosa.
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

function abrirPickerComToken(
  accessToken: string,
  resolve: (r: DrivePickerResult) => void,
) {
  // Debug logging (Fase 51 troubleshooting)
  console.log("[DrivePicker] abrirPickerComToken called, building picker");

  const picker = new window.google.picker.PickerBuilder()
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
    .setOAuthToken(accessToken)
    .setDeveloperKey(EFFECTIVE_API_KEY)
    .addView(
      new window.google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false),
    )
    .setLocale("pt")
    .setCallback((data: any) => {
      console.log("[DrivePicker] picker callback action:", data.action, "data:", data);
      if (data.action === window.google.picker.Action.PICKED) {
        const docs = data.docs || [];
        console.log("[DrivePicker] PICKED, files count:", docs.length);
        const files: DrivePickedFile[] = docs.map((d: any) => ({
          id: d.id,
          name: d.name,
          mimeType: d.mimeType,
          sizeBytes: parseInt(d.sizeBytes || "0", 10) || 0,
          iconUrl: d.iconUrl,
          type: d.type || "file",
        }));
        resolve({ files, accessToken });
      } else if (data.action === window.google.picker.Action.CANCEL) {
        console.log("[DrivePicker] CANCEL");
        resolve({ files: [], accessToken: "" });
      }
    })
    .build();

  console.log("[DrivePicker] calling picker.setVisible(true)");
  picker.setVisible(true);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Baixa um arquivo do Drive usando access token. Retorna Blob pra upload
 * direto pro Supabase Storage.
 *
 * Para Google Docs/Sheets/Slides (mimeType application/vnd.google-apps.*),
 * a API requer "export" em vez de "download direto" - tratamos isso aqui.
 */
export async function downloadDriveFile(
  file: DrivePickedFile,
  accessToken: string,
): Promise<Blob> {
  let url: string;
  const isGoogleDoc = file.mimeType.startsWith("application/vnd.google-apps.");

  if (isGoogleDoc) {
    // Exporta Google Docs/Sheets em formato PDF (assumimos PDF como universal)
    const exportMime = "application/pdf";
    url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${
      encodeURIComponent(exportMime)
    }`;
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  }

  const resp = await fetch(url, {
    headers: {
      Authorization: "Bearer " + accessToken,
    },
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(
      "Falha ao baixar " + file.name + ": HTTP " + resp.status + " - " + detail,
    );
  }
  return resp.blob();
}

/**
 * Para Google Docs convertidos pra PDF, ajusta o nome do arquivo
 * (adiciona .pdf se nao tem extensao).
 */
export function nomeDownloadFinal(file: DrivePickedFile): string {
  const isGoogleDoc = file.mimeType.startsWith("application/vnd.google-apps.");
  if (isGoogleDoc && !/\.[a-z0-9]{2,5}$/i.test(file.name)) {
    return file.name + ".pdf";
  }
  return file.name;
}

// =============================================================================
// Folder Picker + Listagem de pasta (Fase 52 - sync semi-automatico)
// =============================================================================

export interface DrivePickedFolder {
  id: string;
  name: string;
  accessToken: string;
}

/**
 * Abre o Picker do Google configurado pra ESCOLHER UMA PASTA. Usado pra
 * vincular pasta do Drive a um caso (botao "Vincular pasta").
 *
 * Resolve com a pasta escolhida ou folder.id === "" se cancelou.
 */
export function abrirDrivePickerPasta(): Promise<DrivePickedFolder> {
  if (!EFFECTIVE_CLIENT_ID || !EFFECTIVE_API_KEY) {
    return Promise.reject(
      new Error("Google Drive não configurado (credenciais ausentes)"),
    );
  }

  return new Promise(async (resolve, reject) => {
    try {
      await loadGoogleScripts();
    } catch (err) {
      reject(err);
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: EFFECTIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp.error) {
          reject(new Error("Falha OAuth: " + resp.error));
          return;
        }
        const accessToken = resp.access_token as string;
        if (!accessToken) {
          reject(new Error("Sem access_token na resposta OAuth"));
          return;
        }
        abrirPickerPastaComToken(accessToken, resolve);
      },
    });

    tokenClient.requestAccessToken({ prompt: "" });
  });
}

function abrirPickerPastaComToken(
  accessToken: string,
  resolve: (r: DrivePickedFolder) => void,
) {
  // View que mostra so pastas e permite selecionar pasta.
  const view = new window.google.picker.DocsView()
    .setIncludeFolders(true)
    .setMimeTypes("application/vnd.google-apps.folder")
    .setSelectFolderEnabled(true);

  const picker = new window.google.picker.PickerBuilder()
    .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
    .setOAuthToken(accessToken)
    .setDeveloperKey(EFFECTIVE_API_KEY)
    .addView(view)
    .setLocale("pt")
    .setTitle("Escolha a pasta do cliente para vincular")
    .setCallback((data: any) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const doc = (data.docs || [])[0];
        if (doc) {
          resolve({ id: doc.id, name: doc.name, accessToken });
        } else {
          resolve({ id: "", name: "", accessToken: "" });
        }
      } else if (data.action === window.google.picker.Action.CANCEL) {
        resolve({ id: "", name: "", accessToken: "" });
      }
    })
    .build();

  picker.setVisible(true);
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Lista UM nivel de uma pasta no Drive. Retorna arquivos E subpastas.
 * Usado internamente pela versao recursiva.
 */
async function listarUmNivel(
  folderId: string,
  accessToken: string,
): Promise<Array<{
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  iconLink?: string;
}>> {
  const q = `'${folderId}' in parents and trashed=false`;
  const fields = "files(id,name,mimeType,size,iconLink)";
  const url =
    "https://www.googleapis.com/drive/v3/files" +
    "?q=" + encodeURIComponent(q) +
    "&fields=" + encodeURIComponent(fields) +
    "&pageSize=200" +
    "&supportsAllDrives=true&includeItemsFromAllDrives=true";

  const resp = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(
      "Falha ao listar pasta do Drive: HTTP " + resp.status + " - " + detail,
    );
  }
  const data = await resp.json() as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      iconLink?: string;
    }>;
  };
  return data.files || [];
}

/**
 * Lista arquivos dentro de uma pasta RECURSIVAMENTE (entra nas subpastas).
 *
 * Limites de seguranca:
 *   - Max 5 niveis de profundidade
 *   - Max 500 arquivos no total
 *
 * Cada arquivo retornado tem `pastaRelativa` indicando o caminho desde a
 * pasta raiz (ex.: "Subpasta A/Documentos").
 */
export async function listarArquivosDaPasta(
  folderId: string,
  accessToken: string,
  opts?: { maxDepth?: number; maxFiles?: number },
): Promise<Array<DrivePickedFile>> {
  const maxDepth = opts?.maxDepth ?? 5;
  const maxFiles = opts?.maxFiles ?? 500;
  const arquivos: Array<DrivePickedFile> = [];

  async function recurse(
    currentFolderId: string,
    depth: number,
    pathPrefix: string,
  ): Promise<void> {
    if (depth > maxDepth || arquivos.length >= maxFiles) return;
    let itens: Awaited<ReturnType<typeof listarUmNivel>>;
    try {
      itens = await listarUmNivel(currentFolderId, accessToken);
    } catch (err) {
      console.warn(
        "[listarArquivosDaPasta] erro lendo subpasta",
        currentFolderId,
        err,
      );
      return;
    }
    // Processa primeiro arquivos, depois subpastas (estabilidade na ordem)
    const files = itens.filter((it) => it.mimeType !== FOLDER_MIME);
    const folders = itens.filter((it) => it.mimeType === FOLDER_MIME);
    for (const f of files) {
      if (arquivos.length >= maxFiles) return;
      arquivos.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: parseInt(f.size || "0", 10) || 0,
        iconUrl: f.iconLink,
        type: "file",
        pastaRelativa: pathPrefix || undefined,
      });
    }
    for (const folder of folders) {
      if (arquivos.length >= maxFiles) return;
      const novoPath = pathPrefix
        ? pathPrefix + "/" + folder.name
        : folder.name;
      await recurse(folder.id, depth + 1, novoPath);
    }
  }

  await recurse(folderId, 0, "");
  // Log de diagnostico - quantos arquivos por pasta encontrou
  const porPasta = arquivos.reduce(
    (acc: Record<string, number>, f) => {
      const k = f.pastaRelativa ?? "(raiz)";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    },
    {},
  );
  console.log(
    "[Drive] listarArquivosDaPasta encontrou",
    arquivos.length,
    "arquivo(s):",
    porPasta,
  );
  return arquivos;
}

// =============================================================================
// Upload pro Drive (Fase 53 - bidirecional, app → Drive)
// =============================================================================

export interface DriveUploadResult {
  id: string;          // gdrive_file_id
  name: string;
  webViewLink?: string;
}

/**
 * Sobe um arquivo pro Drive na pasta especificada.
 *
 * Usa multipart upload (limite ~5MB; suficiente pro MVP — docs do INSS
 * raramente passam disso). Pra arquivos maiores, migrar pra resumable
 * upload no futuro.
 *
 * Requer scope drive.file (já configurado em DRIVE_SCOPE).
 */
export async function uploadDriveFile(
  blob: Blob,
  nome: string,
  pastaPaiId: string,
  accessToken: string,
): Promise<DriveUploadResult> {
  const metadata = {
    name: nome,
    parents: [pastaPaiId],
    mimeType: blob.type || "application/octet-stream",
  };

  // multipart com boundary fixo. Spec: RFC 2387.
  const boundary = "msc_drive_boundary_" + Math.floor(Math.random() * 1e9);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metaPart =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata);
  const filePartHeader =
    delimiter + `Content-Type: ${metadata.mimeType}\r\n\r\n`;

  // Concat manual pra preservar binary do blob.
  const body = new Blob([
    metaPart,
    filePartHeader,
    blob,
    closeDelimiter,
  ]);

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(
      `Falha ao subir "${nome}" pro Drive: HTTP ${resp.status} - ${detail}`,
    );
  }
  const data = (await resp.json()) as DriveUploadResult;
  return data;
}

/**
 * Renomeia um arquivo no Drive. Usado pra propagar rename feito no app.
 */
export async function renomearArquivoDrive(
  fileId: string,
  novoNome: string,
  accessToken: string,
): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: novoNome }),
    },
  );
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(
      `Falha ao renomear no Drive: HTTP ${resp.status} - ${detail}`,
    );
  }
}

/**
 * Move um arquivo do Drive pra lixeira (delete soft). Reversível pelo
 * próprio usuário no Drive em até 30 dias.
 */
export async function deletarArquivoDrive(
  fileId: string,
  accessToken: string,
): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: true }),
    },
  );
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(
      `Falha ao apagar no Drive: HTTP ${resp.status} - ${detail}`,
    );
  }
}

/**
 * Helper bidirecional: se o caso tem pasta Drive vinculada, sobe o blob
 * lá também e retorna o gdrive_file_id. Se não tem pasta, retorna null
 * silenciosamente. Falhas no Drive são lançadas (caller decide se rolla
 * back ou só loga warning).
 *
 * Mantém o app como fonte de verdade: o Storage do Supabase sempre é o
 * primeiro a receber o arquivo. Drive é espelho.
 */
export async function uploadDocumentoDriveSeNecessario(
  blob: Blob,
  nome: string,
  gdriveFolderId: string | null | undefined,
): Promise<string | null> {
  if (!gdriveFolderId) return null;
  if (!isGoogleDriveConfigured()) return null;
  const token = await obterAccessToken();
  const result = await uploadDriveFile(blob, nome, gdriveFolderId, token);
  return result.id;
}

/**
 * Pega um access token sem abrir popup (ou abre se necessario). Usado pelo
 * fluxo Sync - precisa de token pra chamar Drive API mas nao precisa do Picker.
 */
export function obterAccessToken(): Promise<string> {
  if (!EFFECTIVE_CLIENT_ID) {
    return Promise.reject(
      new Error("Google Drive não configurado (credenciais ausentes)"),
    );
  }
  return new Promise(async (resolve, reject) => {
    try {
      await loadGoogleScripts();
    } catch (err) {
      reject(err);
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: EFFECTIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp.error) {
          reject(new Error("Falha OAuth: " + resp.error));
          return;
        }
        if (!resp.access_token) {
          reject(new Error("Sem access_token na resposta OAuth"));
          return;
        }
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });
}
