// Helpers da Superficie B (Claude/ChatGPT externos):
//   - geracao/hash de Personal Access Token (PAT). Guardamos so o sha256 (hex);
//     o token em claro so existe no momento da criacao.
//   - assinatura de um JWT de usuario (HS256) para que o ia-mcp execute as tools
//     sob o MESMO RLS do app (sem reimplementar autorizacao — gap #4).

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function strToB64Url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Token: "msc_" + 32 bytes aleatorios em base64url. Prefixo p/ identificar na UI.
export function generateToken(): { token: string; prefixo: string } {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = "msc_" + bytesToB64Url(raw);
  return { token, prefixo: token.slice(0, 12) };
}

// Assina um JWT HS256 com as claims que o PostgREST/RLS esperam de um usuario
// autenticado. Curta duracao (default 1h).
export async function signUserJwt(
  secret: string,
  uid: string,
  ttlSec = 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: uid,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + ttlSec,
  };
  const base = strToB64Url(JSON.stringify(header)) + "." +
    strToB64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  return base + "." + bytesToB64Url(new Uint8Array(sig));
}
