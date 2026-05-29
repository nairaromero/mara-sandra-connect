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

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Falha rapida se as env vars nao estao configuradas (build cru). */
export function isGoogleDriveConfigured(): boolean {
  return !!CLIENT_ID && !!API_KEY;
}

// ---------------------------------------------------------------------------
// Carregamento dos scripts (idempotente)
// ---------------------------------------------------------------------------
let scriptsLoadingPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("document indisponivel (SSR)"));
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
        reject(new Error("gapi nao disponivel apos carregar api.js"));
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
  if (!CLIENT_ID || !API_KEY) {
    return Promise.reject(
      new Error(
        "Google Drive nao configurado (faltam VITE_GOOGLE_CLIENT_ID e/ou VITE_GOOGLE_API_KEY)",
      ),
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
      client_id: CLIENT_ID,
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
  const picker = new window.google.picker.PickerBuilder()
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
    .setOAuthToken(accessToken)
    .setDeveloperKey(API_KEY)
    // View principal: todos os tipos, com pastas navegaveis
    .addView(
      new window.google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false), // por enquanto so arquivos, nao pastas
    )
    // Localizacao em portugues (best effort)
    .setLocale("pt")
    .setCallback((data: any) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const docs = data.docs || [];
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
        resolve({ files: [], accessToken: "" });
      }
    })
    .build();

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
