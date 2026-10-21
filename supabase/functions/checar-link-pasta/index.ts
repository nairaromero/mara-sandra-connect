// O link da pasta do parceiro abre para nós? (card #434, pedido da Naira 20/10)
//
// Por que existe: o parceiro cola o link do OneDrive e segue a vida. Se ele
// esqueceu de liberar o compartilhamento, ninguém descobre na hora — só dias
// depois, quando alguém da equipe abre e leva um pedido de login. Aqui o
// sistema tenta abrir na hora, SEM credencial nenhuma, e guarda o que viu.
//
// A checagem (e a porta contra SSRF) mora em `_shared/checar-link.ts`. Aqui
// fica quem pode pedir e onde o resultado é gravado:
//   · recebe o ID da pasta, não a URL — a function só abre link que já está
//     num caso que a pessoa alcança (antes era um "abra esta URL para mim"
//     para qualquer pessoa com `casos:editar`);
//   · grava ELA MESMA o veredito, com service role. O navegador não grava
//     mais: o gatilho do banco descarta `checado_*` vindo de pessoa (antes o
//     parceiro podia gravar "compartilhado" direto pela API);
//   · grava só se a URL ainda é a mesma: link trocado durante a checagem não
//     herda o veredito do endereço anterior.

import { escopado, exigirRecurso, exigirUsuario, respostaOptions } from "../_shared/auth.ts";
import { checarLink } from "../_shared/checar-link.ts";
import { jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respostaOptions();
  if (req.method !== "POST") return jsonResponse({ error: "use POST" }, 405);

  // Quem cola o link é quem confere: equipe e parceiro, com `casos:editar`.
  const quem = await exigirUsuario(req, { permissao: "casos:editar" });
  if (quem instanceof Response) return quem;

  let body: { pasta_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body inválido" }, 400);
  }
  if (!body.pasta_id) return jsonResponse({ error: "pasta_id obrigatório" }, 400);

  const negado = await exigirRecurso(quem, "caso_pastas_externas", body.pasta_id);
  if (negado) return negado;

  const { data: pasta, error: errPasta } = await quem.rls
    .from("caso_pastas_externas")
    .select("id, url")
    .eq("id", body.pasta_id)
    .maybeSingle();
  if (errPasta) {
    console.error("checar-link-pasta: ler a pasta", errPasta.message);
    return jsonResponse({ error: "falha ao ler a pasta" }, 503);
  }
  if (!pasta) return jsonResponse({ error: "registro não encontrado" }, 404);

  const resultado = await checarLink(pasta.url as string);

  const { data: gravada, error: errGravar } = await escopado(quem.admin, quem.perfil.escritorio_id)
    .from("caso_pastas_externas")
    .update({
      checado_em: new Date().toISOString(),
      checado_status: resultado.status,
      checado_detalhe: resultado.detalhe,
    })
    .eq("id", pasta.id)
    .eq("url", pasta.url)
    .select("id");
  if (errGravar) {
    console.error("checar-link-pasta: gravar", errGravar.message);
    return jsonResponse({ error: "falha ao guardar a checagem" }, 503);
  }

  return jsonResponse({ ...resultado, gravado: (gravada ?? []).length > 0 });
});
