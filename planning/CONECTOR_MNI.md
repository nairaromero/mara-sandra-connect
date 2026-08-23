# Conector MNI — autos do processo, grátis, rodando local

Status: piloto pronto pro TJMT (aguardando senha do PJe pra 1º teste real);
TRF1 e TRF3 dependem de credenciamento junto ao tribunal.
Decisão: substitui o piloto Judit descartado (planning/DECISOES.md (D7)) —
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

## Autenticação (tudo no Keychain — nada em texto no repo)

O conector lê os segredos do Keychain do macOS em runtime (a IA nunca vê os
valores). Configurar UMA vez, pela própria Naira, no Terminal:

```bash
# Certificado A1 da Mara (já feito e validado 2026-07-29):
security add-generic-password -a msc-mni -s msc-cert-path -w '/Users/.../MARA...pfx'
security add-generic-password -a msc-mni -s msc-cert-pfx  -w 'senha-do-pfx'
# Senha do PJe da Mara (senhaConsultante — exigida pelo TJMT mesmo com cert):
security add-generic-password -a msc-mni -s msc-mni-senha -w 'senha-do-PJe-TJMT'
```

O CPF é extraído do próprio certificado (não precisa digitar). O certificado
dispensa MFA e é o que destrava TRF1/TRF3/Jus.br (camada de conexão).

## Como usar

1. Testar (dry-run, só lista os documentos):
   `node scripts/conector-mni.mjs --numero 1000767-26.2024.8.11.0025`
2. Arquivar de verdade:
   `node scripts/conector-mni.mjs --numero <cnj> --salvar [--max-docs 10]`

## Estado do teste (2026-07-29)

- Certificado A1 da Mara carregando do Keychain ✔ · CPF extraído do cert ✔ ·
  TLS mútuo com TJMT ✔ (HTTP 200).
- TJMT respondeu "Acesso não Autorizado" com senhaConsultante vazia → falta
  guardar a senha do PJe-TJMT no Keychain (`msc-mni-senha`). Com ela, autentica.

## Pendências

- [ ] Naira: senha do PJe-TJMT no .env.local + primeiro teste real.
- [ ] Escritório: protocolar pedido de credenciamento MNI no TRF1 e no TRF3
      (formulário/SEI de cada tribunal, em nome da advogada/escritório;
      posso redigir o texto do pedido). Ao liberar, é só adicionar os
      endpoints em ENDPOINTS no script.
- [ ] Evolução (se o piloto agradar): agendar no launchd (1x/dia) pros
      processos com movimentação nova; linkar o PDF ao andamento na timeline.
