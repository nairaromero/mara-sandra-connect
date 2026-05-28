# Mara Sandra Connect — Planning

> Pasta de planejamento e documentação do projeto. Comece aqui.

---

## Documentos

| Arquivo | Para quê serve |
|---|---|
| **[ARQUITETURA.md](ARQUITETURA.md)** | Estado atual: propósito, stack, schema do banco, rotas, convenções, decisões já tomadas, APIs externas, contatos. |
| **[INTEGRACOES.md](INTEGRACOES.md)** | Plano detalhado de integração com TI + Legalmail (via n8n): mapeamento de campos, workflows, decisões aplicadas. |
| **[UI_DESIGN.md](UI_DESIGN.md)** | Mobile-first, componentes genéricos a extrair, plano de tema unificado (T1-T10). |
| **[TODO.md](TODO.md)** | Checklist consolidado: curto/médio/longo prazo, débitos críticos, histórico. |

---

## Subpastas (código auxiliar)

| Pasta | Conteúdo |
|---|---|
| [edge-functions/](edge-functions/) | Source das Supabase Edge Functions (TI + Legalmail). `check-ti-cliente` e `sync-ti-cliente` já deployadas; `check-legalmail-nome` aguardando deploy. |
| [sql-migrations/](sql-migrations/) | Scripts SQL aplicados (`migration_caso_detalhe.sql`) ou auxiliares (`diagnostico_schema.sql`). Ver [ARQUITETURA.md](ARQUITETURA.md) §10 para detalhes. |
| [explorers/](explorers/) | Scripts Python que foram usados para mapear endpoints do TI e Legalmail. Não rodam em produção; valor é documental. |

---

## Como retomar

1. Ler [ARQUITETURA.md](ARQUITETURA.md) (estado atual)
2. Conferir [TODO.md](TODO.md) (próxima ação)
3. Conferir o estado do repo via `git log --oneline -20`
4. Confirmar migrations aplicadas no Supabase (Database → Migrations no Studio)
