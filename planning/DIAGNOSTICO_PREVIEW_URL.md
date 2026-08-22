# Preview URL do staging fora do ar — diagnóstico de 2026-08-22

> Registro do que foi testado e **descartado**, para a próxima pessoa não
> repetir o caminho. O sintoma engana: parece configuração, e não é.

---

## Sintoma

`https://staging-mara-sandra-connect.nairaromerovian.workers.dev` **não
responde** — timeout em todas as rotas. Vale para a URL fixa da branch e para
as URLs de versão (`<8-chars>-mara-sandra-connect…`).

Produção segue normal.

| Alvo | Resultado |
|---|---|
| `marasandraconnect.com` | **HTTP 200** em 0,18s |
| `staging-…workers.dev` | **timeout** |
| `90e5a3f6-…workers.dev` (versão nova) | **timeout** |
| Banco de staging (`msc-sql --staging`) | **responde** — 362 clientes |

---

## A causa

**A faixa de IP `188.114.96.0/24` não aceita conexão TCP na 443 a partir da
máquina que testou.** Não é o Worker, não é a preview URL, não é WAF.

```bash
dig +short staging-mara-sandra-connect.nairaromerovian.workers.dev
#   188.114.96.5
#   188.114.97.5

# a conexao nem abre — tcp=0 significa que nao completou
curl -s -o /dev/null --max-time 12 \
  -w "dns=%{time_namelookup}s tcp=%{time_connect}s http=%{http_code}\n" \
  https://staging-mara-sandra-connect.nairaromerovian.workers.dev/
#   dns=0.051s tcp=0.000000s http=000

# e falha para QUALQUER host servido por esse IP:
curl -s -o /dev/null --max-time 12 --resolve "example.com:443:188.114.96.5" \
  -w "%{http_code}\n" https://example.com/
#   000

# outra faixa da Cloudflare, mesma maquina, funciona:
nc -z 104.18.13.15 443   # 443 aberta
nc -z 188.114.96.5 443   # NAO responde
```

O DNS resolve certo. É o caminho de rede até aqueles IPs que não fecha.
**Provavelmente funciona de outra rede** — vale abrir no navegador antes de
concluir que está fora do ar.

---

## O que foi descartado, e por quê

### 1. A regra de WAF `bloqueia scan de CMS/PHP`

Foi a primeira suspeita. **Não é**, por três motivos independentes:

- A regra pertence à zona `marasandraconnect.com`. O staging vive em
  `…workers.dev`, que **não pertence a essa zona** — regra de zona só avalia
  tráfego daquele domínio.
- Com a regra **desabilitada**, o staging continuou fora.
- WAF bloqueia na camada HTTP e devolve **403**. Aqui o TCP nem abre: nenhuma
  regra chega a ser avaliada num request que não conectou.

### 2. Preview URL efêmera / faltou build

Também não. Forçamos um build novo (commit vazio → versão `90e5a3f6` criada
60s depois, confirmando que **commit vazio dispara build sim**) e a URL da
versão recém-criada deu o mesmo timeout.

### 3. Configuração do Worker

Está como esperado. A Management API confirma:

```
GET /accounts/<id>/workers/scripts/mara-sandra-connect/subdomain
  { "enabled": false, "previews_enabled": true }
```

`enabled: false` é intencional — ver o comentário em `wrangler.jsonc`:
*"Produção só no domínio próprio; workers.dev segue desligado."*
`previews_enabled: true` é o que dá as URLs de preview.

---

## Como confirmar de onde você está

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 \
  https://staging-mara-sandra-connect.nairaromerovian.workers.dev/
```

- **200** → a URL está no ar; o problema era a rede de quem reportou.
- **000** (timeout) → tente de outra rede antes de mexer no painel. Se falhar
  de todas, aí sim é caso de olhar
  *Workers & Pages → mara-sandra-connect → Settings → preview URLs*.

---

## Impacto

Nenhum em produção, e nenhum nos merges acumulados em `staging`.

O que se perde é a janela de validação visual: `bun run e2e:video:staging`
aponta para essa URL e falha enquanto ela não estiver alcançável. A alternativa
é rodar contra o frontend local com o banco de staging:

```bash
bun run e2e:video     # sobe vite em :8085, .env.local ja aponta pro staging
```
