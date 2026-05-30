// Testes do contrato de webhook (modela o que o Postgres e o parceiro fazem).
//
// Sem dependencias externas (node:test/crypto/http/assert). Rodar:
//   node planning/webhooks/test/contract.test.mjs
//
// O que cada parte modela:
//   - signDelivery   -> assinatura feita DENTRO do banco em webhook_claim_batch
//                       (pgcrypto hmac == HMAC-SHA256 padrao; mesmos bytes que o Node).
//   - verifyWebhook  -> codigo de referencia que o PARCEIRO deve implementar.
//   - markResultModel/backoffSeconds -> logica de webhook_mark_result (backoff).
//   - prepResult     -> JS do no "Preparar resultado" do n8n.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";

// ---------------------------------------------------------------------------
// Modelos (refletem o SQL e o n8n)
// ---------------------------------------------------------------------------

function signDelivery(secret, ts, body) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(ts + "." + body).digest("hex");
}

// Codigo de referencia para o PARCEIRO verificar a entrega.
function verifyWebhook(secret, headers, rawBody, nowEpoch) {
  const ts = headers["x-msc-timestamp"];
  const sig = headers["x-msc-signature"];
  if (!ts || !sig) return { ok: false, reason: "headers ausentes" };
  const skew = Math.abs(nowEpoch - Number(ts));
  if (!Number.isFinite(skew) || skew > 300) return { ok: false, reason: "timestamp fora da janela" };
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(ts + "." + rawBody).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "assinatura invalida" };
  }
  return { ok: true };
}

function backoffSeconds(tentativas) {
  switch (tentativas) {
    case 1: return 60;       // 1 min
    case 2: return 300;      // 5 min
    case 3: return 1800;     // 30 min
    default: return 7200;    // 2 h
  }
}

function markResultModel(tentativas, ok) {
  if (ok) return { status: "enviado" };
  if (tentativas >= 5) return { status: "falhou" };
  return { status: "pendente", delaySeconds: backoffSeconds(tentativas) };
}

// JS do no "Preparar resultado" do n8n.
function prepResult(statusCode, body, eventoId) {
  const ok = typeof statusCode === "number" && statusCode >= 200 && statusCode < 300;
  let erro = null;
  if (!ok) {
    let b = body;
    if (b && typeof b === "object") b = JSON.stringify(b);
    erro = ("HTTP " + (statusCode ?? "sem resposta") + " " + (b ?? "")).slice(0, 500);
  }
  return { evento_id: eventoId, ok, http_status: statusCode ?? null, erro };
}

// ---------------------------------------------------------------------------
// Util: sobe um receiver (parceiro) que verifica a assinatura
// ---------------------------------------------------------------------------

function startPartnerServer(secret, { clockSkew = 0 } = {}) {
  return new Promise((resolve) => {
    const received = [];
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const now = Math.floor(Date.now() / 1000) + clockSkew;
        const v = verifyWebhook(secret, req.headers, raw, now);
        received.push({ headers: req.headers, raw, verify: v });
        if (!v.ok) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: v.reason }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, received, url: `http://127.0.0.1:${port}/hook` });
    });
  });
}

function deliver(url, { tipo, deliveryId, ts, signature, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MSC-Event": tipo,
          "X-MSC-Delivery": deliveryId,
          "X-MSC-Timestamp": ts,
          "X-MSC-Signature": signature,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    req.write(body); // bytes EXATOS que foram assinados
    req.end();
  });
}

// Constroi uma entrega como webhook_claim_batch faria.
function buildDelivery(secret, envelope, { tsOverride } = {}) {
  const body = JSON.stringify(envelope);           // == payload::text
  const ts = String(tsOverride ?? Math.floor(Date.now() / 1000));
  return {
    tipo: envelope.type,
    deliveryId: envelope.id,
    ts,
    signature: signDelivery(secret, ts, body),
    body,
  };
}

const SAMPLE = {
  id: "evt_5f3c1e0a-2b7d-4a9c-9e21-77d2c0a1b8e4",
  type: "andamento.created",
  occurred_at: "2026-05-30T14:00:00Z",
  api_version: "2026-05-30",
  data: {
    andamento_id: "a1", caso_id: "c1",
    cliente: { id: "cl1", nome: "Joao da Silva", cpf: "12345678900" },
    origem: "legalmail", titulo: "Sentenca", descricao: "Procedente.",
    data_evento: "2026-05-30T13:58:00Z",
    link_caso: "https://app/casos/c1",
  },
};

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

test("entrega valida: parceiro verifica e responde 2xx", async () => {
  const secret = "segredo-do-parceiro-123";
  const { server, port, received, url } = await startPartnerServer(secret);
  try {
    const d = buildDelivery(secret, SAMPLE);
    const resp = await deliver(url, d);
    assert.equal(resp.statusCode, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].verify.ok, true);
    // o corpo recebido bate byte a byte com o assinado
    assert.equal(received[0].raw, d.body);
    // prepResult marca ok
    const r = prepResult(resp.statusCode, resp.body, SAMPLE.id);
    assert.deepEqual(markResultModel(1, r.ok), { status: "enviado" });
  } finally {
    server.close();
  }
});

test("adulteracao do corpo em transito: assinatura falha (401)", async () => {
  const secret = "segredo-do-parceiro-123";
  const { server, received, url } = await startPartnerServer(secret);
  try {
    const d = buildDelivery(secret, SAMPLE);
    // o atacante troca o corpo mas mantem a assinatura original
    const tampered = { ...d, body: d.body.replace("Procedente", "Improcedente") };
    const resp = await deliver(url, tampered);
    assert.equal(resp.statusCode, 401);
    assert.equal(received[0].verify.ok, false);
    assert.equal(received[0].verify.reason, "assinatura invalida");
  } finally {
    server.close();
  }
});

test("replay: timestamp velho e rejeitado (fora da janela de 300s)", async () => {
  const secret = "segredo-do-parceiro-123";
  const { server, received, url } = await startPartnerServer(secret);
  try {
    const oldTs = Math.floor(Date.now() / 1000) - 400;
    const d = buildDelivery(secret, SAMPLE, { tsOverride: oldTs });
    const resp = await deliver(url, d);
    assert.equal(resp.statusCode, 401);
    assert.equal(received[0].verify.reason, "timestamp fora da janela");
  } finally {
    server.close();
  }
});

test("segredo errado: parceiro nao valida (401)", async () => {
  const { server, received, url } = await startPartnerServer("segredo-certo");
  try {
    const d = buildDelivery("segredo-ERRADO", SAMPLE);
    const resp = await deliver(url, d);
    assert.equal(resp.statusCode, 401);
    assert.equal(received[0].verify.ok, false);
  } finally {
    server.close();
  }
});

test("backoff segue 1m / 5m / 30m / 2h e falha na 5a", () => {
  assert.deepEqual(markResultModel(1, false), { status: "pendente", delaySeconds: 60 });
  assert.deepEqual(markResultModel(2, false), { status: "pendente", delaySeconds: 300 });
  assert.deepEqual(markResultModel(3, false), { status: "pendente", delaySeconds: 1800 });
  assert.deepEqual(markResultModel(4, false), { status: "pendente", delaySeconds: 7200 });
  assert.deepEqual(markResultModel(5, false), { status: "falhou" });
});

test("prepResult: 2xx -> ok; 5xx -> falha com erro", () => {
  const okR = prepResult(200, '{"received":true}', "evt_1");
  assert.equal(okR.ok, true);
  assert.equal(okR.erro, null);

  const failR = prepResult(500, { error: "boom" }, "evt_1");
  assert.equal(failR.ok, false);
  assert.equal(failR.http_status, 500);
  assert.match(failR.erro, /HTTP 500/);
});

test("idempotencia: X-MSC-Delivery e estavel e unico por evento", () => {
  const d1 = buildDelivery("s", SAMPLE);
  const d2 = buildDelivery("s", SAMPLE, { tsOverride: 999 });
  // mesmo evento -> mesmo delivery id (o parceiro deduplica por ele)
  assert.equal(d1.deliveryId, d2.deliveryId);
  assert.equal(d1.deliveryId, SAMPLE.id);
});
