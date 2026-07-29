# Conector MNI — autos do processo, grátis, rodando local

Status: piloto pronto pro TJMT (aguardando senha do PJe pra 1º teste real);
TRF1 e TRF3 dependem de credenciamento junto ao tribunal.
Decisão: substitui o piloto Judit descartado (planning/PILOTO_JUDIT.md) —
mesmo resultado (PDFs dos autos) a custo zero, via webservice oficial do CNJ.

## O que é

O MNI (Modelo Nacional de Interoperabilidade) é o webservice SOAP oficial que
PJe e eproc expõem. A operação `consultarProcesso` com `incluirDocumentos`
retorna movimentos E os PDFs dos autos, autenticando com CPF + senha do
advogado no tribunal (ou certificado A1). É a mesma porta que os robôs do
Tramitação Inteligente/Judit usam.

`scripts/conector-mni.mjs` roda NA MÁQUINA da Naira (conector local):
credenciais ficam só no `.env.local` (gitignored); a nuvem recebe apenas os
PDFs, que entram na aba Documentos do caso (pasta "Processo <nº>",
invisíveis pro parceiro até liberar). Dedup por arquivo.

## Sondagem dos tribunais (2026-07-29)

| Tribunal | Sistema | Processos | MNI |
|---|---|---:|---|
| TJMT | PJe | 22 | ABERTO — WSDL 200; envelope validado (fault de login com credencial fake, como esperado). Resposta em MTOM (tratado). |
| TRF1 | PJe | 39 | WAF 403 — exige credenciamento prévio do consumidor no tribunal |
| TRF3 | PJe (pje1g-jus.trf3.jus.br) | 81 | conexão bloqueada — idem, credenciamento |
| TJSP | e-SAJ | 13 | sem MNI (só scraping frágil — fora de escopo) |

Certificado A1 da Mara: válido até 29/04/2027 (Keychain). Pro MNI de consulta
a senha do PJe basta; o A1 fica como plano B (TLS client cert) se algum
tribunal exigir.

## Como usar (Naira)

1. No `.env.local` (raiz do repo), adicionar:
   ```
   MNI_CPF=18448524829        # CPF da Mara (advogada habilitada nos processos)
   MNI_SENHA=<senha do PJe-TJMT dela>
   ```
2. Testar (dry-run, só lista): 
   `node scripts/conector-mni.mjs --numero 1000767-26.2024.8.11.0025`
3. Arquivar de verdade:
   `node scripts/conector-mni.mjs --numero <cnj> --salvar [--max-docs 10]`

## Pendências

- [ ] Naira: senha do PJe-TJMT no .env.local + primeiro teste real.
- [ ] Escritório: protocolar pedido de credenciamento MNI no TRF1 e no TRF3
      (formulário/SEI de cada tribunal, em nome da advogada/escritório;
      posso redigir o texto do pedido). Ao liberar, é só adicionar os
      endpoints em ENDPOINTS no script.
- [ ] Evolução (se o piloto agradar): agendar no launchd (1x/dia) pros
      processos com movimentação nova; linkar o PDF ao andamento na timeline.
