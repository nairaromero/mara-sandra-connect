// Cifragem AES-GCM da chave de API BYOK (gap de seguranca #1/#10).
//
// A chave-mestra IA_MASTER_KEY (env secret, base64 de 32 bytes) NUNCA toca o
// banco nem logs. Cifragem/decifragem acontecem so aqui, na edge function.
// Guardamos no banco apenas cipher+iv (base64 opaco) e um "hint" mascarado.

const MASTER = Deno.env.get("IA_MASTER_KEY") ?? "";

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function getKey(): Promise<CryptoKey> {
  if (!MASTER) throw new Error("IA_MASTER_KEY ausente no ambiente da function");
  const raw = b64ToBytes(MASTER);
  if (raw.length !== 32) {
    throw new Error("IA_MASTER_KEY deve ser base64 de exatamente 32 bytes");
  }
  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(
  plain: string,
): Promise<{ cipher: string; iv: string }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return { cipher: bytesToB64(new Uint8Array(ct)), iv: bytesToB64(iv) };
}

export async function decryptSecret(
  cipherB64: string,
  ivB64: string,
): Promise<string> {
  const key = await getKey();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(cipherB64),
  );
  return new TextDecoder().decode(pt);
}

// HMAC para assinar acoes pendentes (confirmacao a prova de TOCTOU, gap #2):
// o servidor assina (ferramenta+args); o confirm so executa se a assinatura
// bater, garantindo que os args confirmados sao os mesmos que foram propostos.
async function hmacKey(): Promise<CryptoKey> {
  if (!MASTER) throw new Error("IA_MASTER_KEY ausente no ambiente da function");
  return await crypto.subtle.importKey(
    "raw",
    b64ToBytes(MASTER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signPayload(data: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToB64(new Uint8Array(sig));
}

export async function verifyPayload(data: string, sig: string): Promise<boolean> {
  try {
    const key = await hmacKey();
    return await crypto.subtle.verify(
      "HMAC",
      key,
      b64ToBytes(sig),
      new TextEncoder().encode(data),
    );
  } catch {
    return false;
  }
}

// Mascara segura de exibir na UI (ex.: "sk-ant...a1b2"). Nunca revela o miolo.
export function hintFor(secret: string): string {
  const s = secret.trim();
  if (s.length <= 10) return "****";
  return s.slice(0, 6) + "..." + s.slice(-4);
}
