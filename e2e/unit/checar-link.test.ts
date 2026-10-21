// A checagem do link da pasta do parceiro (#434), sem rede: o `buscar` é
// simulado. Rodar:
//   bun test e2e/unit/checar-link.test.ts
//
// O que mais importa aqui é a PORTA contra SSRF: na revisão de 21/10, só a URL
// colada passava pela lista de provedores — o destino de um redirecionamento
// era buscado sem conferência nenhuma.
import { describe, expect, test } from "bun:test";
import { checarLink } from "../../supabase/functions/_shared/checar-link";
import { provedorDaPasta } from "../../src/lib/documentos/pasta-externa";

type Resposta = { status: number; location?: string; corpo?: string };

/** Um `fetch` de mentira que responde por endereço e anota o que foi buscado. */
function rede(mapa: Record<string, Resposta>) {
  const buscados: string[] = [];
  const buscar = (async (entrada: string | URL | Request) => {
    const url = String(entrada);
    buscados.push(url);
    const r = mapa[url];
    if (!r) throw new Error(`endereço não simulado: ${url}`);
    const headers = new Headers(r.location ? { location: r.location } : {});
    return new Response(r.corpo ?? "", { status: r.status, headers });
  }) as typeof fetch;
  return { buscar, buscados };
}

describe("checagem do link da pasta", () => {
  test("redirecionamento para endereço interno NÃO é buscado", async () => {
    const { buscar, buscados } = rede({
      "https://1drv.ms/f/abc": { status: 302, location: "http://169.254.169.254/latest/meta-data/" },
    });
    const r = await checarLink("https://1drv.ms/f/abc", buscar);
    expect(r.status).toBe("indefinido");
    expect(buscados).toEqual(["https://1drv.ms/f/abc"]);
  });

  test("redirecionamento para host fora da lista NÃO é buscado", async () => {
    const { buscar, buscados } = rede({
      "https://onedrive.live.com/x": { status: 301, location: "https://evil.example.com/" },
    });
    const r = await checarLink("https://onedrive.live.com/x", buscar);
    expect(r.status).toBe("indefinido");
    expect(buscados).toHaveLength(1);
  });

  test("endereço colado fora da lista, com usuário na URL ou em http não é buscado", async () => {
    for (const url of [
      "https://evil.example.com/pasta",
      "https://onedrive.live.com@169.254.169.254/",
      "https://onedrive.live.com.evil.com/",
      "http://onedrive.live.com/x",
      "https://onedrive.live.com:8443/x",
    ]) {
      const { buscar, buscados } = rede({});
      const r = await checarLink(url, buscar);
      expect(r.status, url).toBe("indefinido");
      expect(buscados, url).toEqual([]);
    }
  });

  test("redirecionamento para a tela de login: não compartilhado", async () => {
    const { buscar } = rede({
      "https://1drv.ms/f/abc": { status: 302, location: "https://login.live.com/login.srf?wa=1" },
    });
    expect((await checarLink("https://1drv.ms/f/abc", buscar)).status).toBe("fechado");
  });

  test("endereço que só CITA o login num parâmetro não é tela de login", async () => {
    const { buscar } = rede({
      "https://onedrive.live.com/?ru=https%3A%2F%2Flogin.live.com": { status: 200, corpo: "<html>pasta</html>" },
    });
    const r = await checarLink("https://onedrive.live.com/?ru=https%3A%2F%2Flogin.live.com", buscar);
    expect(r.status).toBe("aberto");
  });

  test("redirecionamento dentro do provedor é seguido até a página", async () => {
    const { buscar, buscados } = rede({
      "https://1drv.ms/f/abc": { status: 302, location: "https://onedrive.live.com/redir?id=1" },
      "https://onedrive.live.com/redir?id=1": { status: 200, corpo: "<html>arquivos</html>" },
    });
    expect((await checarLink("https://1drv.ms/f/abc", buscar)).status).toBe("aberto");
    expect(buscados).toHaveLength(2);
  });

  test("página com a tela de login dentro: não compartilhado", async () => {
    const { buscar } = rede({
      "https://drive.google.com/drive/folders/x": { status: 200, corpo: "<a href='https://accounts.google.com/ServiceLogin'>" },
    });
    expect((await checarLink("https://drive.google.com/drive/folders/x", buscar)).status).toBe("fechado");
  });

  test("provedor opaco responde 'não sei' sem buscar", async () => {
    const { buscar, buscados } = rede({});
    const r = await checarLink("https://www.dropbox.com/scl/fo/x", buscar);
    expect(r.status).toBe("indefinido");
    expect(buscados).toEqual([]);
  });

  test("1drv.com é conferido — e a tela chama de OneDrive (uma lista só)", async () => {
    const { buscar, buscados } = rede({ "https://1drv.com/f/x": { status: 403 } });
    expect((await checarLink("https://1drv.com/f/x", buscar)).status).toBe("fechado");
    expect(buscados).toHaveLength(1);
    expect(provedorDaPasta("https://1drv.com/f/x")).toBe("OneDrive");
  });
});
