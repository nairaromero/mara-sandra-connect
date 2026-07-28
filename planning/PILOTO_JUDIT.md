# Piloto Judit — autos do processo (documentos/PDFs)

Status: edge function pronta e deployada; aguardando chave de API (trial)
Decisão: Judit escolhida sobre Escavador (2026-07-29) — API em tempo real com
webhooks e captura automática de anexos, vs fluxo assíncrono de até 3 dias
úteis + certificado digital no Escavador.
Referências: https://docs.judit.io · https://judit.io/planos-api/ ·
https://judit.io/calculadora/

## O que o piloto entrega

Traz os PDFs dos autos (sentença, decisões, petições — o "Abrir/Baixar" do
Tramitação Inteligente) pro nosso sistema:

- Edge `sync-judit-autos`: consulta o processo na Judit com
  `with_attachments`, baixa os anexos e arquiva na aba **Documentos** do caso
  (pasta "Processo <nº>", tipo Outro + nome da peça, `visivel_parceiro=false`
  — interno libera o que quiser).
- Dedup por arquivo: rodar de novo não duplica.
- Se a consulta demorar, a function devolve `request_id` — invocar de novo com
  ele retoma sem custo extra de nova consulta.

## Passos pra ativar (Naira)

1. Criar conta trial em https://judit.io (falar com o comercial ou self-serve)
   e gerar a chave de API.
2. Configurar o secret (a chave NÃO vai pro git):
   `bunx supabase secrets set JUDIT_API_KEY=<chave> --project-ref llugytkdsfsrciavhrfw`
3. Testar num dos casos-piloto (dry-run primeiro — só lista os anexos):

```bash
curl -X POST "https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/sync-judit-autos" \
  -H "Content-Type: application/json" \
  -d '{"numero": "5009313-34.2026.4.03.6315", "dry_run": true}'
```

4. Gravação real (baixa até 10 docs): mesmo comando sem `dry_run`.
5. Conferir na aba Documentos do caso da Edina (pasta "Processo 5009313-...").

## Custos (conferir na calculadora)

- Consulta histórica: ~R$ 0,25/processo + filtro; anexos são opcionais e
  encarecem a consulta — por isso o piloto baixa sob demanda (por processo),
  não em massa.
- Se o piloto aprovar: avaliar o TRACKING da Judit (monitoramento com webhook)
  como evolução — poderia substituir nosso polling do DataJud E trazer os
  docs novos automaticamente. Decisão de custo pra depois do trial.

## Fora do piloto (se aprovar, próximos passos)

- Botão "Buscar autos" na aba Processos do caso (hoje o invoke é manual).
- Anexo linkado ao andamento correspondente na timeline (igual TI).
- Tracking/webhook da Judit substituindo parte dos crons.
