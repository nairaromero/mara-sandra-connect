# Mara Sandra Connect — Planning

> Pasta de planejamento e documentação. **Comece aqui.**
> Índice revisado em 2026-08-23 — 15 documentos históricos foram removidos (o
> que neles ainda importava virou item de TODO ou decisão em DECISOES.md; o
> texto completo fica no histórico do git, último commit com eles: `d3224fa`).

---

## Comece por estes três

| Arquivo | Para quê serve |
|---|---|
| **[ARQUITETURA.md](ARQUITETURA.md)** | O sistema hoje: stack, ambientes, 45 tabelas, 27 rotas, automações, convenções, pegadinhas. **Auditado contra o banco em 2026-08-21.** |
| **[DECISOES.md](DECISOES.md)** | **Por que o sistema é assim**: 21 decisões com contexto, opções, o que pesou e o que custou. Ler antes de propor mudança estrutural. |
| **[TODO.md](TODO.md)** | O que está em aberto, por risco. |

> ⚠️ **Regra de ouro:** o código e o banco andam mais rápido que a documentação.
> Antes de confiar num número daqui, confira: `node scripts/msc-sql.mjs "select ..."`.
> Se divergir, vale o banco — e corrija o documento.

---

## Documentos vivos

Legenda: 🟢 descreve o estado atual · 🟡 parcialmente desatualizado.

### Infra e processo

| Arquivo | Estado | Conteúdo |
|---|---|---|
| [AMBIENTES.md](AMBIENTES.md) | 🟢 | Produção × staging, migrations em duas etapas, espelho anonimizado (role só-leitura, travas, workflow semanal), LGPD do anonimato |
| [../CLAUDE.md](../CLAUDE.md) | 🟢 | Fluxo de trabalho: branches, squash, contas de staging, papéis, comandos |
| [../e2e/README.md](../e2e/README.md) | 🟢 | Testes E2E: como rodar, vídeo, contas, regras de dados |

### Operação e integrações

| Arquivo | Estado | Conteúdo |
|---|---|---|
| [PROCESSOS_GLOBAL.md](PROCESSOS_GLOBAL.md) | 🟢 | Visão global de processos, DataJud, digest diário, triagem por IA |
| [INTEGRACAO_DJE.md](INTEGRACAO_DJE.md) | 🟢 | DJEN/Comunica API do CNJ — desenho do que está no ar |
| [DRIVE_ACESSO_EQUIPE.md](DRIVE_ACESSO_EQUIPE.md) | 🟢 | Drive com conta única do escritório; origens autorizadas; por que só funciona em produção |
| [CONECTOR_MNI.md](CONECTOR_MNI.md) | 🟢 | Autos em PDF de graça pelo webservice do CNJ — piloto parado esperando senha do PJe |
| [INTEGRACAO_IA.md](INTEGRACAO_IA.md) | 🟡 | Plugin de IA (BYOK, MCP) e o checklist LGPD, ainda aberto |
| [INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md) | 🟡 | Spec do que está implementado (fases 1–3). **Saída pausada em 21/08**; decisão de linha dedicada em [whatsapp/PLANO_LINHA_DEDICADA.md](whatsapp/PLANO_LINHA_DEDICADA.md) |
| [legal/](legal/) | 🟢 | Minutas: DPA do parceiro, política de privacidade, adendo de IA. **Pendente revisão por especialista** |

---

## Subpastas

| Pasta | Conteúdo |
|---|---|
| [sql-migrations/](sql-migrations/) | Todas as migrations aplicadas (~125). Nome = o que faz. Idempotentes quando possível |
| [whatsapp/](whatsapp/) | Runbooks, docker-compose e workflow n8n da Evolution API; plano da linha dedicada |
| [webhooks/](webhooks/) | Workflow n8n e OpenAPI do outbox |
| [dje/](dje/) | Workflow n8n do sync DJEN |
| [auth-emails/](auth-emails/) | Templates HTML dos e-mails do Supabase Auth |

Fonte de verdade das edge functions é `supabase/functions/` (a pasta de cópias foi removida;
`excluir-parceiro` foi movida pra lá).

---

## Como retomar o projeto

1. Ler [ARQUITETURA.md](ARQUITETURA.md) (o que é), [DECISOES.md](DECISOES.md) (por quê) e
   [TODO.md](TODO.md) (o que falta).
2. `git log --oneline -20` — o código costuma estar à frente destes documentos.
3. Conferir o banco antes de agir sobre qualquer número.
4. Fluxo de trabalho (branch, PR para `staging`, migration no staging primeiro, contas de
   staging): [CLAUDE.md](../CLAUDE.md) na raiz.
