// O link da pasta do parceiro abre para nós? (card #434, pedido da Naira 20/10)
//
// Por que existe: o parceiro cola o link do OneDrive e segue a vida. Se ele
// esqueceu de liberar o compartilhamento, ninguém descobre na hora — só dias
// depois, quando alguém da equipe abre e leva um pedido de login. Aqui o
// sistema tenta abrir na hora, SEM credencial nenhuma, e diz o que viu.
//
// O que dá para saber, honestamente:
//   aberto     — respondeu página, sem mandar para tela de login
//   fechado    — mandou para login, ou recusou (401/403)
//   indefinido — não deu para dizer (fora do ar, formato estranho, provedor
//                que não conhecemos). Nunca chuta.
//
// SSRF: a URL vem de fora, então só HOSTS CONHECIDOS são buscados. Sem isso,
// um link `http://169.254.169.254/...` faria a function bater em endereço
// interno da nuvem por nós. Provedor fora da lista nem é chamado.

import { exigirUsuario } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Provedor que RESPONDE A VERDADE de fora: sem acesso, ele manda para a tela
// de login ou recusa. Nesses dá para dizer "aberto" com honestidade.
const CONFERIVEIS = [
  "1drv.ms",
  "onedrive.live.com",
  "sharepoint.com",
  "drive.google.com",
  "docs.google.com",
];

// Provedor OPACO: devolve 200 e uma página de aplicativo para qualquer link,
// exista ele ou não, tenha acesso ou não. Visto no teste: um link falso do
// Dropbox respondia 200 e seria anunciado como "compartilhado" — justamente o
// erro que não pode acontecer, porque manda a equipe dormir tranquila. Para
// esses a resposta honesta é "não deu para conferir".
const OPACOS = ["dropbox.com", "mega.nz", "icloud.com", "wetransfer.com"];

const PROVEDORES = [...CONFERIVEIS, ...OPACOS];

/** Para onde esses provedores mandam quem não tem acesso. */
const LOGIN = [
  "login.microsoftonline.com",
  "login.live.com",
  "login.windows.net",
  "accounts.google.com",
  "signin.aws.amazon.com",
  "www.dropbox.com/login",
  "mega.nz/login",
  "idmsa.apple.com",
];

const TEMPO_LIMITE_MS = 8_000;
const MAX_SALTOS = 4;

type Status = "aberto" | "fechado" | "indefinido";

function hostConhecido(host: string): boolean {
  return PROVEDORES.some((p) => host === p || host.endsWith("." + p));
}

function ehLogin(url: string): boolean {
  const u = url.toLowerCase();
  return LOGIN.some((l) => u.includes(l));
}

async function checar(bruto: string): Promise<{ status: Status; detalhe: string }> {
  let alvo: URL;
  try {
    alvo = new URL(bruto);
  } catch {
    return { status: "indefinido", detalhe: "endereço inválido" };
  }
  if (alvo.protocol !== "https:" && alvo.protocol !== "http:") {
    return { status: "indefinido", detalhe: "endereço inválido" };
  }
  const host = alvo.hostname.toLowerCase();
  if (!hostConhecido(host)) {
    return { status: "indefinido", detalhe: `não sei conferir link de ${alvo.hostname}` };
  }
  if (OPACOS.some((p) => host === p || host.endsWith("." + p))) {
    return {
      status: "indefinido",
      detalhe: "esse provedor responde igual com ou sem acesso — confira abrindo o link",
    };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    let url = alvo.toString();
    for (let salto = 0; salto < MAX_SALTOS; salto++) {
      // `manual`: os saltos são lidos por nós — é no destino do salto que o
      // provedor revela se está pedindo login.
      const r = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controle.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LegalConnect/1.0)" },
      });

      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get("location");
        if (!destino) return { status: "indefinido", detalhe: "redirecionamento sem destino" };
        url = new URL(destino, url).toString();
        if (ehLogin(url)) return { status: "fechado", detalhe: "o link pede login" };
        continue;
      }
      if (r.status === 401 || r.status === 403) {
        return { status: "fechado", detalhe: "o provedor recusou o acesso" };
      }
      if (r.status === 404 || r.status === 410) {
        return { status: "indefinido", detalhe: "o link não existe mais" };
      }
      if (r.status >= 200 && r.status < 300) {
        // Alguns provedores devolvem 200 com a tela de login dentro.
        const corpo = (await r.text()).slice(0, 8000).toLowerCase();
        const pedeLogin = [
          "accounts.google.com/servicelogin",
          "login.microsoftonline.com",
          "login.live.com",
          "você precisa fazer login",
          "faça login",
          "request access",
          "solicitar acesso",
        ].some((m) => corpo.includes(m));
        if (ehLogin(url) || pedeLogin) {
          return { status: "fechado", detalhe: "o link pede login" };
        }
        return { status: "aberto", detalhe: "abriu sem pedir login" };
      }
      return { status: "indefinido", detalhe: `o provedor respondeu ${r.status}` };
    }
    return { status: "indefinido", detalhe: "redirecionou demais" };
  } catch (e) {
    const msg = (e as Error)?.name === "AbortError" ? "o provedor não respondeu a tempo" : "não consegui abrir o link";
    return { status: "indefinido", detalhe: msg };
  } finally {
    clearTimeout(relogio);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "use POST" }, 405);

  // Quem cola o link é quem confere: equipe e parceiro, com `casos:editar`.
  const quem = await exigirUsuario(req, { permissao: "casos:editar" });
  if (quem instanceof Response) return quem;

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body inválido" }, 400);
  }
  if (!body.url) return jsonResponse({ error: "url obrigatória" }, 400);

  return jsonResponse(await checar(body.url));
});
