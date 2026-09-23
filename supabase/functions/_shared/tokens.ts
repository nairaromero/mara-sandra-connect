// Helpers da Superficie B (Claude/ChatGPT externos):
//   - geracao/hash de Personal Access Token (PAT). Guardamos so o sha256 (hex);
//     o token em claro so existe no momento da criacao.
//
// O ia-mcp cunhava aqui um JWT HS256 com SUPABASE_JWT_SECRET para rodar as tools
// sob RLS. O Supabase não injeta mais esse segredo (chaves assimétricas), e o
// ia-mcp caía calado para service role (#374). Agora ele troca o token por uma
// sessão de verdade da pessoa — ver `abrirSessaoDe` em auth.ts.

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
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
