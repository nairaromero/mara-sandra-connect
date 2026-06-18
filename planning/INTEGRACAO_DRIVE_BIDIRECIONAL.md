# Integração Google Drive — sync bidirecional

Doc rascunho. Capturar escopo e decisões já tomadas pra retomar em sessão futura sem perder contexto.

## Estado atual (a partir de 2026-06-18)

**Unidirecional: Google Drive → Sistema apenas.**

Como funciona hoje:
1. Naira vincula uma pasta do Drive ao caso (`casos.gdrive_folder_id`).
2. No caso, botão "Importar do Drive" abre o **Google Picker** (client-side, OAuth do user logado).
3. User escolhe arquivo(s) → app baixa o blob → faz upload pro Supabase Storage (`storage.documentos`) → registra em `public.documentos` com `gdrive_file_id` (pra dedupe na próxima vez).
4. Drive não é tocado em nenhuma operação — nada é apagado, modificado, criado ou movido lá.

Código relevante:
- `src/lib/google-drive.ts` — Picker client-side, Google Identity Services
- `src/components/drive-picker-dialog.tsx` — UI de seleção
- `src/routes/_authenticated/casos.$id.tsx` (linhas ~3335, ~3441) — `abrirDrivePicker`, `importarDriveParaCaso`
- Tabela `casos`: colunas `gdrive_folder_id`, `gdrive_folder_name`, `gdrive_vinculado_em`, `gdrive_vinculado_por`
- Tabela `documentos`: colunas `gdrive_file_id`, `pasta_relativa`

## Escopo desejado

Drive ↔ Sistema como espelhos.

**Sistema → Drive (propagar):**
- Upload de novo documento → cria arquivo no Drive na pasta do caso
- Criar pastas/subpastas (ex: "Documentos pessoais", "INSS", "Procurações") → cria no Drive
- Mover arquivo entre subpastas → move no Drive
- Renomear arquivo → renomeia no Drive
- Deletar arquivo → move pra lixeira no Drive

**Drive → Sistema (puxar):**
- Sync sob demanda (botão "Sincronizar agora" no caso) — MVP. Sem polling nem webhook por enquanto.

**Conflito:** Drive sempre ganha. Drive é fonte de verdade, app é espelho.

## Fases sugeridas

### Fase 1 — Upload do app → Drive (~1 dia)
Quando usuário sobe arquivo via app, sobe paralelo no Drive da pasta do caso. Sem isso, qualquer edit no app fica fora do Drive — a "espelho-idade" quebra desde o início.

Caminho técnico:
- Quando o user está logado no Drive (Picker já abriu), reusa o `access_token` em memória pra fazer `POST drive.googleapis.com/upload/drive/v3/files`.
- Salva `gdrive_file_id` retornado em `documentos.gdrive_file_id` (mesmo campo que o sync atual usa).
- Se user não estiver autenticado no Drive, dispara o fluxo OAuth no momento do upload.

Limitação conhecida: cada user precisa autenticar no Drive uma vez por sessão. Não funciona pra ações server-side (ex: trigger DB, edge function).

### Fase 2 — Sync sob demanda Drive → app (~1 dia)
Botão "Sincronizar agora" no caso:
1. Lista todos os arquivos da pasta `gdrive_folder_id` (recursivo) via API.
2. Compara com `documentos` WHERE caso_id e gdrive_file_id.
3. Novos no Drive → baixa + insert em `documentos`.
4. Apagados no Drive (estão em `documentos` mas não no Drive) → marca como `arquivado` ou deleta (decidir UX).
5. Renomeados (mesmo `gdrive_file_id`, `name` diferente) → atualiza `documentos.nome_arquivo`.

### Fase 3 — Rename, delete, pastas, move propagando app → Drive (~1 dia)
- Renomear no app → `PATCH drive.googleapis.com/files/{id}` com `name`.
- Deletar no app → `DELETE drive.googleapis.com/files/{id}` (trash).
- Criar subpasta → `POST files` com `mimeType=folder` e `parents=[caso_folder]`. Salvar em nova tabela `pastas_caso` ou só usar `documentos.pasta_relativa`.
- Mover arquivo → `PATCH files/{id}` com `addParents`/`removeParents`.

## Decisões técnicas a fazer antes de codar

### 1. Autenticação client-side ou server-side?

**Client-side (Picker reusando token):**
- ✅ Já existe parte da infra
- ✅ Não precisa armazenar refresh tokens
- ❌ Só funciona com user ativo no app
- ❌ Cada operação depende do Drive auth não ter expirado
- ❌ Não dá pra trigger DB ou edge function escrever no Drive

**Server-side (refresh token armazenado):**
- ✅ Funciona em background (cron, trigger)
- ✅ Drive auth persiste entre sessões
- ❌ Precisa OAuth flow com `access_type=offline`
- ❌ Tabela nova `gdrive_tokens (user_id, refresh_token, expires_at)`
- ❌ Refresh tokens podem expirar/revogar — fluxo de reconectar

**Recomendação MVP:** começar client-side (mais rápido). Migrar pra server-side se sentir falta.

### 2. Quem é o "dono" das pastas no Drive?

Hoje cada user vincula a pasta pelo Picker dele. Significa que a pasta é do user que vinculou. Se ele perde acesso, ninguém mais consegue mexer.

Opções:
- **Cada user com seu Drive:** simples, mas se Naira sair de férias, equipe pode ficar sem acesso.
- **Conta de serviço do escritório:** pasta compartilhada com a equipe interna. Mais robusto, mas exige configurar uma conta dedicada.

### 3. Estrutura de pastas no Drive

Hoje: `<pasta-do-caso>/<arquivo>` ou `<pasta-do-caso>/<pasta-relativa>/<arquivo>`. `pasta_relativa` é string livre em `documentos`.

Pra criar subpastas via app: precisa modelar. Pode ser tabela nova:
```sql
public.pastas_caso (
  id uuid PK,
  caso_id uuid FK,
  parent_id uuid FK self,
  nome text,
  gdrive_folder_id text
)
```

Ou simplificar: subpastas implícitas pela `pasta_relativa`, e ao criar pasta vazia salvamos um `.keep` lá. Menos elegante.

## Riscos / coisas que podem complicar

- **Rate limit do Drive API**: 1000 queries/100s/user. Sync de pasta com muitos arquivos pode bater.
- **Tamanho do arquivo**: upload de >5MB precisa ser resumable. SDK do Google ajuda.
- **Conflito de nomes**: Drive permite arquivos com mesmo nome na mesma pasta (são tratados por ID). App talvez assume unique. Verificar.
- **OAuth scopes**: hoje usa `drive.file` (acesso só ao que o app criou). Pra sync completo, precisa `drive.readonly` ou `drive` (acesso a tudo). Trade-off de privacidade.
- **Migração**: o que fazer com documentos antigos que estão no app mas não no Drive? Precisa "subir" cada um na primeira sincronização?

## Próximos passos

1. Decidir client-side vs server-side (depende de quão crítico é background sync).
2. Decidir conta de serviço dedicada ou Drive pessoal de cada um.
3. Implementar Fase 1 (upload bidirecional).
4. Testar com 5-10 casos reais antes de Fases 2 e 3.

## Sessão de partida

Quando retomar: ler este doc, conferir decisões 1-3, criar branch `feat/drive-bidirecional-fase1` a partir de `staging`, começar pela Fase 1.
