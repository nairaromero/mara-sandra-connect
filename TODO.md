# TODO — Débitos técnicos antes de produção

Lista de pendências que precisam ser endereçadas antes do app ser usado com clientes reais.

## CRÍTICO — Segurança / LGPD

### 1. Criptografar senha MEU INSS

**Status atual:** a senha é armazenada em texto puro na coluna `clientes.senha_meu_inss_plain`.

**O que precisa acontecer:**

1. Configurar a chave de criptografia `app.inss_key` no Postgres do Supabase (depende de acesso ao servidor para definir como variável de ambiente ou via `ALTER DATABASE ... SET app.inss_key = '...'`).
2. Para cada cliente já cadastrado, migrar a senha de `senha_meu_inss_plain` para `senha_meu_inss` (bytea criptografado) usando a função `public.set_senha_meu_inss(cliente_id, senha)`.
3. Atualizar o frontend para usar `set_senha_meu_inss` em vez de gravar direto em `senha_meu_inss_plain`.
4. Remover a coluna `senha_meu_inss_plain` da tabela `clientes` com `alter table public.clientes drop column senha_meu_inss_plain`.
5. Confirmar que apenas usuários internos podem ler a senha, via `public.get_senha_meu_inss(cliente_id)`, e que cada leitura é registrada em `acessos_senha_inss`.

**Arquivos envolvidos:**
- `src/routes/_authenticated/casos.novo.tsx` (inserção)
- Qualquer tela futura que leia ou edite senha (não implementada ainda)

## ALTO — Funcionalidades pendentes

### 2. Tela de cadastro de parceiros

Hoje, para adicionar um advogado parceiro, é preciso criar manualmente no Supabase Auth e inserir linha em `usuarios` com `tipo='parceiro'`. Criar tela `/parceiros/novo` acessível apenas a usuários internos.

### 3. Tela de detalhe do caso

Rota `/casos/{id}` ainda não existe. O cadastro de caso redireciona para o dashboard. Implementar tela com:
- Dados do cliente
- Análise técnica (com versionamento)
- Timeline de andamentos (interno + Tramitação + Legalmail)
- Lista de documentos (anexados + pedidos pendentes)
- Chat com o escritório / parceiro
- Repasses e valores

### 4. Solicitação de documentos pelo escritório

Implementar fluxo onde a equipe interna pede documentos específicos no caso, e o parceiro vê esses pedidos pendentes para enviar.

### 5. Integração Tramitação Inteligente

Workflows n8n para sincronizar movimentações administrativas do INSS no caso.

### 6. Integração Legalmail

Endpoint para receber e-mails encaminhados do Legalmail e criar andamentos automáticos nos casos correspondentes.

### 7. Análise técnica via IA

Workflow n8n que recebe o CNIS, faz OCR, chama Claude API com prompt jurídico, persiste o resultado em `analises_tecnicas` e gera PDF do relatório.

## MÉDIO — Operacional

### 8. Audit log de acessos sensíveis

A tabela `acessos_senha_inss` já existe. Garantir que o frontend nunca leia a senha sem passar pela função `get_senha_meu_inss`, e considerar logs adicionais para acesso a CNIS.

### 9. Limites de upload

Bucket `documentos` aceita até 20 MB por arquivo. Avaliar se precisa aumentar para PPP/laudos médicos com imagens. Adicionar validação no frontend.

### 10. Notificações ao advogado parceiro

Quando há nova análise pronta, documento solicitado, andamento, etc — enviar notificação por e-mail e/ou no painel.

### 11. Repasses financeiros

Implementar tela de extrato + automação para marcar repasses como pagos quando o caso for concluído com êxito.

## BAIXO — Polimento

### 12. Tema visual personalizado

Substituir branding genérico pela identidade visual definitiva do escritório Mara Sandra Advocacia.

### 13. Onboarding de parceiro

Tela explicando como o parceiro deve usar o sistema na primeira vez que faz login.

### 14. Política de privacidade e termos de uso

Páginas públicas com a política LGPD e o termo de parceria assinado por cada advogado.
