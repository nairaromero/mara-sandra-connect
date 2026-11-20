// zapsign-webhook (#517) — recebe os avisos do ZapSign (documento aberto,
// assinado, recusado, excluído) e traz o status e o PDF assinado para o caso.
//
// Segurança (o ZapSign NÃO assina a chamada):
//   1. o segredo de entrada (`config.inbound_token`, 48 caracteres aleatórios
//      gerados pelo servidor em Configurações → Integrações) diz de QUAL
//      escritório é a chamada; o banco garante que é único. Vem no header
//      `x-inbound-token` — é o que o ZapSign recomenda (o cadastro do webhook
//      lá aceita headers) e não deixa o segredo na URL, que fica nos logs de
//      webhook do painel deles — ou, para quem já cadastrou assim, em `?token=`;
//   2. o corpo só diz qual documento olhar — o token do documento tem de casar
//      com uma linha de `assinaturas` DESSE escritório;
//   3. status e arquivo vêm de uma leitura NOSSA na API do ZapSign com o token
//      do escritório (`sincronizarAssinatura`) — nada do corpo é gravado.
//
// O webhook do ZapSign vale para a conta inteira: documento criado direto no
// painel também avisa. O aviso de CRIAÇÃO de um documento que o sistema não
// conhece o traz para dentro (`adotarDocumento`: cliente, caso e tarefa); os
// demais respondem 200 "ignorado" (senão o ZapSign fica reenviando). 5xx só
// quando vale a pena ele tentar de novo.
import { clienteAdmin, escopado } from "../_shared/auth.ts";
import { integracaoDoEscritorio } from "../_shared/integracoes.ts";
import { adotarDocumento, COLUNAS_ASSINATURA, DocumentoForaDaConta, type LinhaAssinatura, sincronizarAssinatura } from "../_shared/zapsign.ts";

const admin = clienteAdmin();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const segredo = (req.headers.get("x-inbound-token") ?? new URL(req.url).searchParams.get("token") ?? "").trim();
  if (!segredo) return json({ error: "unauthorized" }, 401);

  let corpo: { token?: unknown; event_type?: unknown } | null;
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "body inválido" }, 400);
  }
  const docToken = corpo && typeof corpo === "object" && typeof corpo.token === "string" ? corpo.token.trim() : "";
  if (!docToken) return json({ error: "sem token de documento" }, 400);
  const evento = String(corpo?.event_type ?? "?");

  // A única leitura sem escopo: de QUAL escritório é este segredo.
  const { data: donas, error: eInt } = await admin
    .from("escritorio_integracoes").select("escritorio_id").eq("tipo", "zapsign").eq("ativo", true).eq("config->>inbound_token", segredo).limit(2);
  if (eInt) {
    console.error(`[zapsign-webhook] procurando o escritório: ${eInt.message}`);
    return json({ error: "erro interno" }, 500);
  }
  if (donas?.length !== 1) return json({ error: "unauthorized" }, 401);
  const escritorioId = donas[0].escritorio_id as string;
  const sb = escopado(admin, escritorioId);

  try {
    const integ = await integracaoDoEscritorio(admin, escritorioId, "zapsign");
    if (!integ) return json({ ok: true, ignorado: "integração sem token da API" });

    const { data: linha, error: eLinha } = await sb.from("assinaturas").select(COLUNAS_ASSINATURA).eq("zapsign_doc_token", docToken).maybeSingle();
    if (eLinha) throw new Error(`lendo a assinatura: ${eLinha.message}`);

    if (!linha) {
      // Documento criado direto no ZapSign: o aviso de CRIAÇÃO o traz para o
      // sistema (cliente, caso e tarefa). Qualquer outro aviso de documento
      // desconhecido é ignorado — senão um contrato antigo viraria cliente novo.
      if (evento !== "doc_created") return json({ ok: true, ignorado: "documento não foi enviado pelo sistema" });
      const r = await adotarDocumento({ sb, admin }, integ, docToken);
      console.log(`[zapsign-webhook] doc_created ${docToken} → ${r.adotado ? `adotado na assinatura ${r.assinatura.id}` : `não adotado (${r.motivo})`}`);
      return json(r.adotado
        ? { ok: true, adotado: true, status: r.assinatura.status, cliente_novo: r.cliente_novo, caso_novo: r.caso_novo }
        : { ok: true, ignorado: r.motivo });
    }

    const atual = await sincronizarAssinatura(sb, integ, linha as unknown as LinhaAssinatura);
    console.log(`[zapsign-webhook] ${evento} → assinatura ${atual.id} = ${atual.status}`);
    return json({ ok: true, status: atual.status });
  } catch (e) {
    // documento de outra conta/ambiente: reenviar não muda nada (e qualquer
    // resposta diferente de 200 faz o ZapSign reenviar)
    if (e instanceof DocumentoForaDaConta) {
      console.warn(`[zapsign-webhook] ${evento} ${docToken}: ${e.message}`);
      return json({ ok: true, ignorado: "documento fora da conta ligada" });
    }
    // 5xx: o ZapSign reenvia (a trava de `sincronizarAssinatura` já foi solta)
    console.error(`[zapsign-webhook] ${evento} ${docToken}:`, String((e as Error)?.message ?? e));
    return json({ error: "não consegui processar o aviso" }, 502);
  }
});
