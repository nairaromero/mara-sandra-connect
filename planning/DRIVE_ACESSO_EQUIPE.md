# Drive — liberar acesso pra equipe

Como dar acesso ao Google Drive pra todo mundo do time sincronizar documentos.

## O ponto que resolve tudo: os dois logins são separados

O login do **Connect** (Supabase) e o login do **Drive** (Google) não têm
relação nenhuma. Quando alguém clica em "Importar do Drive" / "Sync pasta", o
app abre um popup do Google e **a pessoa escolhe qual conta Google autorizar** —
independente de qual e-mail ela usou pra entrar no Connect.

Ou seja: **sim, dá pra todo mundo usar a mesma conta Google do escritório.**
Não precisa ser o e-mail com que a pessoa está logada no sistema. Nenhuma
mudança de código é necessária pra isso.

## Recomendação: conta única do escritório

Como o escritório não tem Google Workspace (são contas @gmail.com avulsas), a
conta compartilhada é o caminho mais simples e o mais robusto:

| | Conta compartilhada | Cada um com a sua |
|---|---|---|
| Configuração no Google Cloud | 1 conta na lista de teste | 1 linha por pessoa |
| Dono das pastas dos casos | o escritório | quem vinculou a pasta |
| Alguém sai do escritório | nada quebra | pastas dele ficam órfãs |
| Compartilhar pasta com o time | desnecessário | obrigatório, uma a uma |
| Rastro de quem mexeu no Drive | some (tudo é "a conta do escritório") | preservado |

O único ponto fraco é o rastro no Drive. Mas o rastro que importa juridicamente
— quem subiu, quem apagou, quem renomeou documento — fica registrado no
**Connect** (auditoria), não no Drive. Então a perda é pequena.

## Passo a passo (fazer antes da reunião)

### 1. Google Cloud Console — autorizar a conta do escritório

O app está com a tela de consentimento OAuth em modo **Testing**, o que
significa que **só contas na lista de "Test users" conseguem autorizar**. Hoje
estão lá só a Mara e a Naira. Sem esse passo, a conta do escritório recebe
"Access blocked: app não verificado".

1. https://console.cloud.google.com → selecionar o projeto do Drive Picker
   (o do client ID `978674501365-...`).
2. Menu **APIs & Services › OAuth consent screen › Audience**.
3. Em **Test users**, clicar **+ Add users**.
4. Adicionar o e-mail da conta compartilhada do escritório. Salvar.

Limite de 100 test users, então sobra espaço de sobra.

### 2. Mover/criar as pastas dos casos na conta do escritório

As pastas que hoje estão no Drive pessoal de alguém precisam ir pra conta
compartilhada — senão a conta do escritório não enxerga.

- Pasta já existente no Drive pessoal: compartilhar com a conta do escritório
  como **Editor** e, de preferência, transferir a propriedade
  (botão direito › Compartilhar › "Transferir propriedade").
- Casos novos: criar a pasta já logado na conta do escritório.

Depois disso, revincular a pasta no caso (botão "Vincular pasta do Drive") se o
ID tiver mudado.

### 3. Treinar o time no popup (5 min na reunião)

Este é o passo que na prática dá problema. Se a pessoa estiver logada no Gmail
pessoal dela, o popup do Google mostra o seletor de contas — e se ela clicar na
conta errada, os documentos vão parar no Drive pessoal dela.

Duas formas de evitar:

- **Simples:** ensinar a sempre escolher a conta do escritório no popup.
- **À prova de erro (recomendado):** criar no Chrome um **perfil separado** só
  pra conta do escritório (Chrome › avatar › Adicionar › entrar com a conta do
  escritório) e usar o Connect sempre nesse perfil. Aí não há seletor: só existe
  uma conta.

### 4. Conferir que funcionou

Com cada pessoa, uma vez:

1. Entrar no Connect, abrir um caso.
2. Clicar em "Importar do Drive" → o popup do Google aparece.
3. Escolher a conta do escritório e aceitar as permissões.
4. O Picker abre listando as pastas → escolher um arquivo e importar.

Se aparecer "Access blocked" ou "app não verificado", é o passo 1 que faltou.

## Detalhes que valem saber

- **O popup reaparece de hora em hora.** O token de acesso do Google dura ~1h e
  o app guarda em memória. Depois disso, o próximo clique numa ação de Drive
  reabre o popup. É normal, não é bug.
- **Permissão pedida é ampla (`drive`, acesso total à conta).** É necessária
  porque o app renomeia e apaga arquivos que ele mesmo não criou (importados),
  e o escopo restrito `drive.file` não permite isso. Mais uma razão pra usar uma
  conta do escritório e não a conta pessoal de ninguém.
- **Só usuário `tipo='interno'` vê as funções de Drive.** Parceiro nunca toca.
- **Publicar o app (sair do modo Testing) não vale a pena.** O escopo `drive` é
  "restricted" pro Google: exigiria verificação formal e uma auditoria de
  segurança (CASA) paga. Modo Testing com lista de test users resolve o caso do
  escritório sem nada disso.
- **Se um dia o escritório contratar Google Workspace**, o caminho melhora
  bastante: a tela de consentimento pode virar "Internal" (todo mundo do domínio
  entra sem lista de test users) e as pastas podem ir pra um **Drive
  compartilhado**, que pertence à organização e não a uma pessoa.

## Onde isso vive no código

- `src/lib/google-drive.ts` — client ID, API key, escopo, cache de token.
- `src/components/drive-picker-dialog.tsx` — UI de seleção.
- `src/routes/_authenticated/casos.$id.tsx` — importar, sincronizar, renomear.
- Tabela `casos`: `gdrive_folder_id`, `gdrive_folder_name`, `gdrive_vinculado_em`.
- Tabela `documentos`: `gdrive_file_id`, `pasta_relativa`.

Histórico da integração: [INTEGRACAO_DRIVE_BIDIRECIONAL.md](INTEGRACAO_DRIVE_BIDIRECIONAL.md).
