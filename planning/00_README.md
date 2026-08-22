# Mara Sandra Connect — Planning

> Pasta de planejamento e documentação. **Comece aqui.**
> Índice revisado em 2026-08-15, com o estado real de cada documento.

---

## Comece por estes dois

| Arquivo | Para quê serve |
|---|---|
| **[ARQUITETURA.md](ARQUITETURA.md)** | O sistema hoje: stack, ambientes, 43 tabelas, 27 rotas, automações, convenções, decisões, pegadinhas. **Auditado contra o banco em 2026-08-15.** |
| **[TODO.md](TODO.md)** | O que está em aberto, com os achados da auditoria no topo. |

> ⚠️ **Regra de ouro:** o código e o banco andam mais rápido que a documentação.
> Antes de confiar num número daqui, confira: `node scripts/msc-sql.mjs "select ..."`.
> Se divergir, vale o banco — e corrija o documento.

---

## Documentos por área

Legenda: 🟢 descreve o estado atual · 🟡 parcialmente desatualizado · ⚪ histórico
(descreve algo encerrado, descartado ou nunca construído).

### Infra e processo

| Arquivo | Estado | Conteúdo |
|---|---|---|
| [DECISOES.md](DECISOES.md) | 🟢 | **Por que o sistema é assim**: 21 decisões com contexto, opções, o que pesou e o que custou. Estudo de caso — ler antes de propor mudança estrutural |
| [AMBIENTES.md](AMBIENTES.md) | 🟢 | Produção × staging, migrations em duas etapas, espelho anonimizado, LGPD do anonimato |
| [UI_DESIGN.md](UI_DESIGN.md) | 🟡 | Mobile-first, componentes genéricos, plano de tema (T1/T2 feitos, T3+ em aberto) |

### Operação do escritório

| Arquivo | Estado | Conteúdo |
|---|---|---|
| [SUBSTITUIR_TRAMITACAO.md](SUBSTITUIR_TRAMITACAO.md) | 🟡 | O plano de sair do TI em 5 MVPs. **MVPs 1–3 entregues; 4 (Google Calendar) e 5 (mobile) em aberto** |
| [MIGRACAO_TI.md](MIGRACAO_TI.md) | 🟢 | Como os dados do TI foram migrados; o que ficou de fora (77 sem CPF) e o aprendizado de fuso |
| [PROCESSOS_GLOBAL.md](PROCESSOS_GLOBAL.md) | 🟢 | Visão global de processos, DataJud, digest diário, triagem por IA |
| [CAIXA_CONVERSAS.md](CAIXA_CONVERSAS.md) | 🟢 | Caixa de conversas — fases 1 a 4, todas entregues |
| [CRM_COMERCIAL.md](CRM_COMERCIAL.md) | 🟡 | Esteira de leads (fases 1 e 2 entregues); roadmap de WhatsApp em aberto |
| [VISAO_PARCEIRO.md](VISAO_PARCEIRO.md) | 🟡 | Mapeamento tela a tela do que o parceiro vê. **Escrito antes de metade das telas existirem** — vale como princípio, não como inventário |

### Integrações

| Arquivo | Estado | Conteúdo |
|---|---|---|
| [INTEGRACAO_DJE.md](INTEGRACAO_DJE.md) | 🟢 | DJEN/Comunica API do CNJ — desenho do que está no ar |
| [INTEGRACAO_DRIVE_BIDIRECIONAL.md](INTEGRACAO_DRIVE_BIDIRECIONAL.md) | 🟢 | Espelho Drive ↔ app (fases 1–3 fechadas); pendências no fim |
| [DRIVE_ACESSO_EQUIPE.md](DRIVE_ACESSO_EQUIPE.md) | 🟢 | Como liberar o Drive para o time; por que não funciona fora de produção |
| [INTEGRACAO_IA.md](INTEGRACAO_IA.md) | 🟡 | Desenho do plugin de IA e o checklist LGPD (ainda aberto) |
| [IA_HANDOFF.md](IA_HANDOFF.md) | 🟡 | Detalhe técnico das 4 superfícies de IA; a lista de TODO do fim está velha |
| [CONECTOR_MNI.md](CONECTOR_MNI.md) | 🟢 | Autos em PDF de graça pelo webservice do CNJ — piloto parado esperando senha do PJe |
| [INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md) | 🟡 | Plano completo do WhatsApp. **Fases 1–3 implementadas, hoje a instância está caída** — ver TODO |
| [INTEGRACOES.md](INTEGRACOES.md) | ⚪ | TI + Legalmail. **O TI foi desligado em 2026-08-11** e a aba `/integracoes` da §7 nunca foi construída. Vale pelo mapeamento de campos e pelos limites das APIs |
| [PILOTO_JUDIT.md](PILOTO_JUDIT.md) | ⚪ | Por que a Judit foi descartada |

### Site e jurídico

| Arquivo | Estado | Conteúdo |
|---|---|---|
| [SITE_INSTITUCIONAL.md](SITE_INSTITUCIONAL.md) | 🟢 | Home pública (fases 0 e 1 entregues); fase 2 é decisão de produto |
| [legal/](legal/) | 🟢 | Minutas: DPA do parceiro, política de privacidade, adendo de IA. **Pendente revisão por especialista** |
| [HANDOFF_2026-06-16_exigencia.md](HANDOFF_2026-06-16_exigencia.md) | ⚪ | Desenho do pipeline solicitação→exigência. O bug que registrava foi **fechado e verificado em 2026-08-15** |

---

## Subpastas

| Pasta | Conteúdo |
|---|---|
| [sql-migrations/](sql-migrations/) | Todas as migrations aplicadas (~110). Nome = o que faz. Idempotentes quando possível |
| [edge-functions/](edge-functions/) | Cópias antigas de source de function. **A fonte de verdade é `supabase/functions/`** |
| [whatsapp/](whatsapp/) | Runbooks, docker-compose e workflow n8n da Evolution API |
| [webhooks/](webhooks/) | Workflow n8n e OpenAPI do outbox |
| [dje/](dje/) | Workflow n8n do sync DJEN |
| [auth-emails/](auth-emails/) | Templates HTML dos e-mails do Supabase Auth |
| [explorers/](explorers/) | Scripts Python que mapearam as APIs do TI e do Legalmail. Valor documental |
| [preview-site/](preview-site/) | Mockup do site institucional |

---

## Como retomar o projeto

1. Ler [ARQUITETURA.md](ARQUITETURA.md) (o que é) e [TODO.md](TODO.md) (o que falta).
2. `git log --oneline -20` — o código costuma estar à frente destes documentos.
3. Conferir o banco antes de agir sobre qualquer número.
4. Fluxo de trabalho (branch, PR para `staging`, migration no staging primeiro):
   ver [CLAUDE.md](../CLAUDE.md) na raiz.
