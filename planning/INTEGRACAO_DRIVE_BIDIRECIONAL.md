# Integração Google Drive — sync bidirecional

**Status: ✅ FASES 1, 2 E 3 FECHADAS EM PRODUÇÃO (2026-06-18 noite).**

Doc original era rascunho. Atualizado depois da implementação.

## O que foi entregue

### Fase 1 — Upload do app → Drive
- `uploadDriveFile()` em `src/lib/google-drive.ts` (POST multipart pra `upload/drive/v3/files`).
- `uploadDocumentoDriveSeNecessario(blob, nome, gdriveFolderId)` é o helper de alto nível usado em todos os pontos de upload do app.
- Wire-up nos 2 fluxos: `TabDocumentos.confirmarAcaoModal` (cumprir solicitação) e `UploadDoc.enviarTodos` (upload bulk).
- Falha no Drive vira toast warning, não bloqueia. App é fonte de verdade.

### Botão "Subir pendentes (N)"
- Lista docs do caso com `gdrive_file_id IS NULL`, baixa do Storage, sobe pro Drive, atualiza `gdrive_file_id`.
- Progresso "Subindo X/Y" no botão.
- Só aparece quando há pendentes.

### Fase 2 — Sync Drive → app
- `handleSincronizarPasta` detecta 3 tipos numa chamada:
  - **Novos** → abre Picker pra escolher quais importar.
  - **Renomeados** → atualiza `documentos.nome_arquivo` automático.
  - **Apagados no Drive** → confirm com lista, se OK apaga do app.
- Toast resume: `3 novo(s) · 1 renomeado(s) · 2 removido(s)`.

### Auto-check silencioso + badge âmbar
- `useEffect` ao abrir caso (com pasta vinculada) lista Drive em background.
- Renomeados aplicados auto sem badge.
- Novos + apagados pendentes alimentam um badge no botão "Sync pasta": `Sync pasta (3)`.
- Falha silenciosa (sem toast); user pode clicar pra ver erro real.

### Fase 3 — Rename e delete app → Drive
- `renomearArquivoDrive(fileId, novoNome, token)` — PATCH com `{name}`.
- `deletarArquivoDrive(fileId, token)` — PATCH com `{trashed: true}` (lixeira, 30d pra reverter).
- UI: ícone lápis em cada documento → `window.prompt` pra renomear.
- Wire-up nas 3 funções de delete (`deletarDoc`, `deletarSelecionados`, `deletarTodos`).

### Detalhes técnicos
- **Scope OAuth = `drive`** (acesso total, não só `drive.file`). Necessário pra rename/delete em docs importados; escopo restrito não dá write em arquivos que o app não criou. Seguro porque Drive ops são gated pra interno.
- **Cache de access token** em memória — popup OAuth aparece 1x/hora, não a cada chamada.
- **Conta de owner do Drive**: cada interno usa o próprio Drive autenticado (Mara, Naira, Mariane). Acesso compartilhado via Google Cloud Console.

## Estado original (a partir de 2026-06-18 — antes desta sessão)

**Era: unidirecional Google Drive → Sistema apenas.**

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

## Pendências (próximas sessões, se valer)

- **Cenário A — auto-criar pasta no Drive ao criar caso novo** (corta um passo manual da Naira).
- **Resumable upload** pra arquivos >5MB (hoje falham com `multipart` limit).
- **Subpastas no Drive** (criar/mover entre subpastas pelo app).
- **Sinalização global** (sidebar/bell mostrando todos os casos com mudanças pendentes, sem precisar abrir cada um).
- **Polling/webhooks** (sync automático em background, sem clique).
- **Conflito de conteúdo** (mesmo arquivo modificado nos 2 lados — hoje só trata nome/delete).
