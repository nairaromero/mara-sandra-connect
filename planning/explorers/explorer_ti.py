#!/usr/bin/env python3
"""
Explorer da API do Tramitacao Inteligente.

Uso:
    python3 explorer_ti.py

O script chama cada endpoint, mostra:
  - HTTP status
  - Quantidade de itens retornados
  - Um item de exemplo (primeiro) em JSON formatado
  - Lista de campos disponiveis

Nao modifica nada. Apenas le.

ATENCAO: o token esta hardcoded abaixo (pego do seu STAGE3/.env).
Nao versionar este arquivo em repositorio publico.
"""
import json
from typing import Any

import requests

BASE_URL = "https://planilha.tramitacaointeligente.com.br/api/v1"
TOKEN = "oPDYkxsW6tCQYtnNtqXdBH3Prpi9Ei7PRkDEDChkPyX4"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}


def sep(titulo: str) -> None:
    print()
    print("=" * 78)
    print(f" {titulo}")
    print("=" * 78)


def explorar_endpoint(metodo: str, path: str, params: dict | None = None) -> Any:
    url = f"{BASE_URL}{path}"
    print(f"\n>>> {metodo} {path}")
    if params:
        print(f"    params={params}")
    try:
        r = requests.request(metodo, url, headers=HEADERS, params=params, timeout=30)
    except Exception as e:
        print(f"  ERRO de rede: {e}")
        return None
    print(f"    HTTP {r.status_code}")
    try:
        data = r.json()
    except Exception:
        print(f"    Resposta nao-JSON: {r.text[:300]}")
        return None
    return data


def descrever_resposta(data: Any, max_preview: int = 1) -> None:
    if data is None:
        return
    if isinstance(data, dict):
        print(f"    Chaves top-level: {list(data.keys())}")
        # Procurar array de itens
        candidates = ["customers", "clientes", "users", "usuarios", "notes",
                      "notas", "data", "items"]
        for key in candidates:
            if key in data and isinstance(data[key], list):
                items = data[key]
                print(f"    Array '{key}': {len(items)} itens")
                if items and max_preview > 0:
                    print(f"\n    Exemplo (1o item de '{key}'):")
                    print(json.dumps(items[0], indent=2, ensure_ascii=False)[:2000])
                    if items[0] and isinstance(items[0], dict):
                        print(f"\n    Campos disponiveis: {sorted(items[0].keys())}")
                break
        # Mostrar paginacao se existir
        for key in ["pagination", "meta", "page", "total"]:
            if key in data:
                print(f"    {key}: {data[key]}")
    elif isinstance(data, list):
        print(f"    Array direto: {len(data)} itens")
        if data and max_preview > 0:
            print(f"\n    Exemplo (1o item):")
            print(json.dumps(data[0], indent=2, ensure_ascii=False)[:2000])
            if isinstance(data[0], dict):
                print(f"\n    Campos disponiveis: {sorted(data[0].keys())}")


# =========================================================================
# 1. USUARIOS — quem opera no TI
# =========================================================================
sep("1. GET /usuarios — operadores do workspace")
data = explorar_endpoint("GET", "/usuarios", params={"page": 1, "per_page": 5})
descrever_resposta(data)

# =========================================================================
# 2. CLIENTES — lista paginada
# =========================================================================
sep("2. GET /clientes — clientes do escritorio")
data = explorar_endpoint("GET", "/clientes", params={"page": 1, "per_page": 5})
descrever_resposta(data)

# Tentar puxar mais detalhe do primeiro cliente (se houver endpoint /clientes/{id})
primeiro_cliente_id = None
if isinstance(data, dict):
    customers = data.get("customers") or data.get("clientes") or []
    if customers:
        primeiro_cliente_id = customers[0].get("id")

if primeiro_cliente_id:
    sep(f"3. GET /clientes/{primeiro_cliente_id} — detalhe de cliente")
    data2 = explorar_endpoint("GET", f"/clientes/{primeiro_cliente_id}")
    descrever_resposta(data2)

# =========================================================================
# 4. NOTAS — existe um GET? Testar
# =========================================================================
sep("4. GET /notas — notas (testar se existe endpoint de listagem)")
data = explorar_endpoint("GET", "/notas", params={"page": 1, "per_page": 5})
descrever_resposta(data)

# =========================================================================
# 5. TAREFAS — existe API? Testar (provavelmente nao)
# =========================================================================
sep("5. GET /tarefas — testar se existe API de tarefas")
data = explorar_endpoint("GET", "/tarefas", params={"page": 1, "per_page": 5})
descrever_resposta(data)

# =========================================================================
# 6. PROCESSOS / MOVIMENTACOES — testar variacoes
# =========================================================================
for endpoint in ["/processos", "/movimentacoes", "/andamentos",
                 "/tramites", "/atividades", "/eventos"]:
    sep(f"6. GET {endpoint} — testar se existe")
    data = explorar_endpoint("GET", endpoint, params={"page": 1, "per_page": 3})
    descrever_resposta(data)

# =========================================================================
# 7. ENDPOINTS DESCOBERTOS via OpenAPI (se houver)
# =========================================================================
sep("7. GET /openapi.json ou /api-docs — descoberta")
for path in ["/openapi.json", "/swagger.json", "/api-docs", "/docs"]:
    print(f"\n>>> GET {BASE_URL}{path}")
    try:
        r = requests.get(f"{BASE_URL}{path}", headers=HEADERS, timeout=15)
        print(f"    HTTP {r.status_code}")
        if r.status_code == 200:
            try:
                docs = r.json()
                if "paths" in docs:
                    print(f"    Endpoints documentados: {list(docs['paths'].keys())}")
                else:
                    print(f"    JSON sem 'paths'. Chaves: {list(docs.keys())[:10]}")
            except Exception:
                print(f"    Nao-JSON (HTML?): {r.text[:200]}")
    except Exception as e:
        print(f"    ERRO: {e}")

print()
print("=" * 78)
print(" FIM. Cola o output todo no chat para analise.")
print("=" * 78)
