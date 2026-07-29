# Piloto Judit — DESCARTADO (2026-07-29)

Decisão da Naira ao ver https://judit.io/planos-api/: o plano mais barato é
~R$ 1.000/mês pra entregar essencialmente o que já temos de graça. Sem
vantagem. Piloto encerrado antes de contratar — a edge `sync-judit-autos`
foi removida do prod e do repo (o código fica no histórico do git, commit
14028ee, se um dia quisermos ressuscitar).

## Por que não compensa

O que a Judit cobre vs o que já rodamos gratuitamente:

| Judit (pago) | Nosso stack (grátis) |
|---|---|
| Movimentações processuais | DataJud/CNJ — crons diários já ligados |
| Publicações/intimações | DJEN/Comunica API — teor completo + certidão PDF |
| Descoberta de processo novo por OAB | DJEN órfãs → fila de triagem + digest |
| Resumo com IA ("Judit IA") | Nossa triagem IA (centavos/mês na chave própria) |
| **Inteiro teor dos autos (PDFs de petições)** | **Única lacuna real** — suprida manualmente no PJe/eproc quando precisar |

A lacuna dos autos completos não vale R$ 12k/ano pro volume do escritório:
sentenças e despachos relevantes já chegam com teor no DJEN, e a certidão
oficial em PDF já tem botão na tela de Publicações.

## Se o cenário mudar

Reavaliar só se: (a) o volume de processos crescer muito, (b) surgir provedor
mais barato por consulta avulsa sem mensalidade, ou (c) a consulta manual de
autos virar gargalo de horas relevante. Nesse caso, recuperar o código do
commit 14028ee e refazer a conta.
