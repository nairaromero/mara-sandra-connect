# Mara Sandra Connect — Contexto do projeto

Resumo para continuar em nova conversa. Cola este arquivo inteiro no início do próximo chat.

## 1. Quem sou eu e o que estamos construindo

Naira, advogada previdenciária no Brasil. Escritório: **Mara Sandra Advocacia**.

Estou construindo um app interno para o escritório que organiza **casos previdenciários** que recebo de outros advogados (parceiros captadores). Não é SaaS público.

**Modelo de negócio**: parceria entre advogados (correspondência jurídica).
- Captador indica cliente, fica com 30% dos honorários.
- Mara Sandra toca o caso (admin no INSS + judicial), fica com 70%.
- Procuração e contrato de honorários ficam com Mara Sandra (modelo 1).
- O parceiro mantém contato com o cliente; o app é só ferramenta operacional dele para acompanhar o que está rolando.

## 2. Stack técnica

- **Frontend**: React + TypeScript + Vite + Tailwind v4 + shadcn/ui + TanStack Router + TanStack Start (SSR)
- **Backend**: Supabase managed (Auth + Postgres + Storage + RLS)
- **Orquestração**: n8n self-hosted (já existente em `nairavian-n8n.de`)
- **Deploy**: Cloudflare Workers (deploy automático via push no GitHub)
- **Domínio temporário**: `mara-sandra-connect.nairaromerovian.workers.dev`
- **Domínio definitivo planejado**: `cnisia.com.br` (registrado no Registro.br, DNS Cloudflare) — ainda não apontado para o app
- **Repositório**: `https://github.com/nairaromero/mara-sandra-connect` (público)

## 3. Supabase

- **Projeto**: `marasandra-app` em organização `Mara Sandra Advocacia` (Company, Free tier)
- **URL**: `https://llugytkdsfsrciavhrfw.supabase.co`
- **Region**: South America (São Paulo)
- **Auto-enable RLS** em novas tabelas: ligado
- **Auto-expose new tables**: desligado (mas concedemos GRANT manual para role `authenticated`)
- **Credenciais**: salvas no 1Password (publishable key e secret key)

### Schema (13 tabelas + auditoria)

1. `usuarios` (FK auth.users, tipo: interno/parceiro)
2. `clientes` (CPF unique, com `senha_meu_inss_plain` text temporária — ver débito #1 do TODO)
3. `casos` (entidade central, FK parceiro_id e cliente_id, enum fase/status)
4. `contratos_parceria`
5. `analises_tecnicas` (com `versao` para histórico)
6. `documentos` (FK caso_id, enum tipo com 22 valores incluindo CAT, HISCRE, LTCAT, certidões etc)
7. `solicitacoes_documento`
8. `andamentos` (origem: interno/tramitacao/legalmail/sistema)
9. `mensagens`
10. `repasses`
11. `processos_admin`
12. `processos_judiciais`
13. `alertas_duplicidade`
14. `acessos_senha_inss` (audit log)

### Funções importantes

- `is_interno()` — checa se auth.uid() é tipo='interno'
- `caso_do_parceiro(caso_id)` — checa se caso pertence ao parceiro logado
- `set_senha_meu_inss(cliente_id, senha)` / `get_senha_meu_inss(cliente_id)` — usam pgcrypto com chave em GUC `app.inss_key` (chave ainda não configurada — débito #1)
- `handle_new_auth_user()` — trigger que cria linha em `usuarios` automaticamente quando há novo auth.users (usado pelo convite de parceiros)
- `tg_set_updated_at()` — trigger para updated_at

### Storage buckets

3 buckets privados: `cnis-uploads`, `documentos`, `contratos`. Policies via RLS por `caso_id` no path.

### GRANTs aplicados

```sql
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- (ver schema_marasandra.sql para versão completa)
```

## 4. Frontend — telas implementadas

- `/login` — login com e-mail/senha + magic link
- `/` (dashboard) — métricas e lista de casos recentes (visão interna diferente de parceiro)
- `/casos/novo` — cadastro de caso (cliente + caso + senha MEU INSS + upload de documentos)
- `/parceiros` — listagem + form de convite (envia magic link). Só visível para interno.
- Sidebar com itens condicionais (Parceiros só aparece para interno)
- Layout autenticado com guard

## 5. Decisões importantes

- **Frontend ↔ Supabase direto** para CRUD/Auth (SDK)
- **n8n** entra apenas em operações longas (análise IA, integração Tramitação/Legalmail, geração PDF)
- **Modelo híbrido confirmado**, não puro n8n
- **Triggers usam Meta Cloud API direta** — *PORÉM esse escopo saiu*: o cliente final NÃO interage com WhatsApp; só parceiros usam o app web
- **LGPD**: co-controle entre CNISIA/Mara Sandra e advogado parceiro (decisão da Naira)
- **SLA de aprovação**: configurável por advogado parceiro (24/48/72h/manual)
- **Cliente final NÃO loga**, só advogados (interno e parceiro)
- **TanStack Start (SSR)** — atenção: alguns componentes precisam estar em `<ClientOnly>` (helper criado em `src/components/client-only.tsx`)

## 6. O que falta (TODO.md no repo)

### CRÍTICO antes de produção

1. **Criptografar senha MEU INSS**: hoje em texto puro em `clientes.senha_meu_inss_plain`. Precisa:
   - Configurar `app.inss_key` no Postgres (depende de SSH no servidor da Naira ou Supabase Vault)
   - Migrar dados existentes para coluna criptografada via `set_senha_meu_inss`
   - Remover coluna `senha_meu_inss_plain`

### Alto

2. ~~Tela de cadastro de parceiros~~ ✅ feita
3. **Tela de detalhe do caso** (`/casos/{id}`) — próxima prioridade. Inclui análise técnica versionada, timeline de andamentos, lista de documentos com pedidos pendentes, chat (polling), repasses
4. Solicitação de documentos pelo escritório
5. Integração Tramitação Inteligente (n8n)
6. Integração Legalmail (parse de e-mails encaminhados via n8n)
7. Análise técnica via IA (workflow n8n: OCR Mistral + Claude API + persist em `analises_tecnicas`)

### Médio/Baixo

8. Audit log de acessos a CNIS
9. Notificações por e-mail (Resend)
10. Tela de repasses financeiros
11. Identidade visual definitiva
12. Onboarding de parceiro
13. Política de privacidade / DPA / contrato parceria

## 7. Bloqueio atual (URGENTE)

**Build do Cloudflare falhando** com erro fantasma:

```
SyntaxError: Expecting Unicode escape sequence \uXXXX. (273:28)
casos.novo.tsx
```

Mas a linha 273:28 do arquivo atual **não tem nada problemático**. É cache stuck do Cloudflare.

**Tentativas que falharam**:
- Retry deployment com "Clear cache"
- Deletar `src/routeTree.gen.ts` (auto-gerado)
- Reupload do arquivo várias vezes

**Próximas tentativas a fazer**:
1. **Settings → Build cache → Purge** no dashboard Cloudflare
2. Se não resolver, **deletar e recriar o projeto Cloudflare** conectado ao mesmo repo (mantém URL `mara-sandra-connect.nairaromerovian.workers.dev`)
3. Última opção: renomear `casos.novo.tsx` para outro nome para forçar invalidação completa

## 8. Próxima ação imediata

Resolver o build do Cloudflare antes de qualquer feature nova. Sem build, não há como ver mudanças.

## 9. Débito técnico operacional

- Chave de criptografia INSS (depende de SSH do marido para configurar)
- Configurar Supabase Pro quando subir beta (hoje Free, sem PITR)
- Apontar `cnisia.com.br` para o app no Cloudflare DNS
- Configurar Resend para e-mails transacionais (necessário para magic link de convite a parceiros funcionar com remetente próprio)

## 10. Arquivos importantes no repo

- `src/routes/_authenticated/index.tsx` — dashboard
- `src/routes/_authenticated/casos.novo.tsx` — cadastro de caso (BUILD QUEBRANDO AQUI por cache stuck)
- `src/routes/_authenticated/parceiros.tsx` — convite de parceiros
- `src/components/app-sidebar.tsx` — menu lateral
- `src/components/client-only.tsx` — wrapper para evitar SSR em componentes problemáticos
- `src/lib/supabase.ts` — client Supabase com URL e publishable key hardcoded
- `wrangler.jsonc` — config Cloudflare Workers
- `TODO.md` — lista de débitos técnicos

## 11. Como retomar

1. Resolver build Cloudflare (passo 1 ou 2 da seção 7)
2. Construir tela de detalhe do caso `/casos/{id}` (próximo na fila)
3. Sequência depois: solicitação de documentos → análise técnica IA → integrações Tramitação/Legalmail

## 12. Estilo de trabalho

- Direto, técnico, sem rodeios
- Naira valida cada decisão antes de implementar
- Contexto: previdenciário brasileiro (não EOR Irlanda)
- Edição de código: via GitHub web (Lovable Free esgotado, sem créditos)
- Naira faz upload manual de arquivos pela interface do GitHub quando há mudança grande
