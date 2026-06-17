# Runbook — Fase 0: subir o Evolution API na máquina do n8n

> Objetivo: deixar o Evolution rodando, com HTTPS, e o **número de teste**
> conectado, pronto para enviar/receber. Sem tocar no app ainda.
> Servidor: `nairavian-n8n.de` (IP `178.105.106.255`).
>
> Tempo estimado: 20–40 min. Você precisa de: acesso SSH ao servidor + o
> **celular do número de teste** (o da Naira) em mãos para ler o QR.

Arquivos desta pasta (`planning/whatsapp/`):
- `docker-compose.yml` — Evolution + Postgres + Redis (dedicados).
- `docker-compose.caddy.yml` — proxy Caddy (HTTPS automático) **opcional**.
- `Caddyfile` — config do Caddy (só se usar o de cima).
- `.env.example` — modelo das variáveis.

---

## Passo 1 — Inspecionar o servidor (não muda nada)

No SSH do servidor, rode para entender o ambiente:

```bash
# Tem Docker e docker compose?
docker --version && docker compose version

# O que já está rodando (n8n etc.)?
docker ps

# Já existe um proxy reverso ocupando 80/443?
sudo ss -tlnp | grep -E ':80 |:443 ' || echo "nada em 80/443"
```

Decida o caminho de HTTPS pelo resultado:
- **Achou algo em 80/443** (provável: n8n atrás de Traefik/Nginx/Caddy)
  → **Caminho A** (usar o proxy existente). NÃO suba o Caddy deste pacote.
- **Nada em 80/443** → **Caminho B** (subir o Caddy incluído).

> Se não tiver Docker, instale antes: https://docs.docker.com/engine/install/

---

## Passo 2 — Copiar os arquivos pro servidor

Crie uma pasta e coloque os 4 arquivos lá. Por exemplo:

```bash
mkdir -p ~/evolution && cd ~/evolution
# suba docker-compose.yml, docker-compose.caddy.yml, Caddyfile, .env.example
# (via scp, git, ou copiar/colar com nano)
```

---

## Passo 3 — DNS do subdomínio

Crie um registro **A** apontando o subdomínio do Evolution pro IP do servidor:

```
evo.nairavian-n8n.de  A  178.105.106.255
```

(no painel de DNS do domínio). Confirme a propagação:

```bash
dig +short evo.nairavian-n8n.de   # deve devolver 178.105.106.255
```

> Pode usar outro subdomínio — só lembre de trocar nos 3 lugares:
> `.env` (`EVOLUTION_SERVER_URL`), `Caddyfile` e na config de proxy do Caminho A.

---

## Passo 4 — Gerar segredos e preencher o `.env`

```bash
cd ~/evolution
cp .env.example .env
echo "EVOLUTION_API_KEY=$(openssl rand -hex 32)"
echo "EVOLUTION_DB_PASSWORD=$(openssl rand -hex 32)"
```

Cole os dois valores gerados no `.env` e confira `EVOLUTION_SERVER_URL`.
**Guarde a `EVOLUTION_API_KEY`** — vamos precisar dela nos próximos passos e,
depois, no Vault do Supabase.

> Nunca comite o `.env` real. (Neste repo, só o `.env.example` é versionado.)

---

## Passo 5 — Subir os containers

**Caminho A (você já tem proxy próprio):**
```bash
docker compose --env-file .env up -d
docker compose logs -f evolution-api   # Ctrl-C quando ver que subiu
```
Agora aponte SEU proxy pro Evolution (que está em `127.0.0.1:8080`):
- **Nginx** (vhost do subdomínio):
  ```nginx
  server {
      server_name evo.nairavian-n8n.de;
      location / {
          proxy_pass http://127.0.0.1:8080;
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_http_version 1.1;
      }
  }
  ```
  (depois rode o certbot pro subdomínio, ou use seu mecanismo de TLS atual.)
- **Traefik**: adicione um router/label apontando pra `127.0.0.1:8080` com TLS.

**Caminho B (sem proxy — usa o Caddy incluído):**
```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml --env-file .env up -d
docker compose logs -f caddy   # Caddy emite o certificado HTTPS sozinho
```

---

## Passo 6 — Verificar que o Evolution responde

```bash
# Pela internet (HTTPS, via proxy/Caddy):
curl -s https://evo.nairavian-n8n.de | head

# Localmente (deve responder na loopback):
curl -s http://127.0.0.1:8080 | head
```
Espera-se um JSON de status do Evolution (mensagem/versão). Se não vier, veja
`docker compose logs evolution-api`.

---

## Passo 7 — Criar a instância (o "número do escritório")

Use a `EVOLUTION_API_KEY` do `.env`. Rode no próprio servidor:

```bash
API=https://evo.nairavian-n8n.de
KEY=<EVOLUTION_API_KEY do .env>

curl -s -X POST "$API/instance/create" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "mara",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

Guarde da resposta o campo **`hash`** (token da instância) — é o que envia
mensagens depois. O `instanceName` é `mara` (usaremos esse nome nas chamadas).

---

## Passo 8 — Conectar o número (ler o QR no celular)

Pegue o QR e escaneie com o **WhatsApp do número de teste da Naira**
(Configurações → Aparelhos conectados → Conectar aparelho):

```bash
# Devolve o QR (campo "code"/"base64"). O base64 é uma imagem PNG do QR.
curl -s "$API/instance/connect/mara" -H "apikey: $KEY"
```

Para visualizar o QR como imagem, o jeito mais fácil é abrir no navegador:
`https://evo.nairavian-n8n.de/instance/connect/mara` com um header `apikey`
(ou use uma extensão/Postman). Alternativa: copie o `base64` retornado e cole
num conversor base64→imagem.

Confirme que conectou:
```bash
curl -s "$API/instance/connectionState/mara" -H "apikey: $KEY"
# deve mostrar state: "open"
```

> O número da Naira continua funcionando normal no celular — o Evolution entra
> como **aparelho conectado** (multi-device).

---

## Passo 9 — Teste de envio (smoke test)

Mande uma mensagem do "bot" para o **número do marido** (o parceiro de teste).
Use o número em formato internacional, só dígitos (ex. Espanha: `34XXXXXXXXX`):

```bash
curl -s -X POST "$API/message/sendText/mara" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "34XXXXXXXXX",
    "text": "Teste Evolution — Mara Sandra Connect (Fase 0) ✅"
  }'
```

Se a mensagem chegar no WhatsApp do marido, **a Fase 0 está OK**.

---

## Passo 10 — Guardar os segredos (entrego eu, no app)

Me passe (ou deixe à mão) estes valores que vou gravar no **Vault do Supabase**
quando começarmos a Fase 1/2 — eles **não** vão pro código nem pro git:
- `EVOLUTION_SERVER_URL` (ex. `https://evo.nairavian-n8n.de`)
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE` = `mara`

(O `WHATSAPP_WEBHOOK_TOKEN`, que protege a entrada, eu gero na Fase 2 e a gente
configura o webhook da instância apontando pra Edge Function.)

---

## Comandos úteis (operação)

```bash
docker compose ps                      # status
docker compose logs -f evolution-api   # logs
docker compose restart evolution-api   # reiniciar
docker compose down                    # parar (mantém volumes/dados)
```

Se a sessão do WhatsApp cair (acontece com Baileys), repita o **Passo 8**
(reconectar lendo o QR). Por isso, em produção, use um **chip dedicado** e não
o número pessoal principal.

---

## Resumo do que esta fase entrega
- Evolution rodando com HTTPS no subdomínio.
- Instância `mara` criada e número de teste conectado (`state: open`).
- Envio validado (mensagem chegou no número do marido).
- Segredos anotados para o Vault.

Próximo: **Fase 1** (saída mínima — `whatsapp_outbox` + workflow n8n + 1 evento).
Ver [../INTEGRACAO_WHATSAPP.md](../INTEGRACAO_WHATSAPP.md).
