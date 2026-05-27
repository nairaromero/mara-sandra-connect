#!/usr/bin/env python3
"""
Explorer da API do Legalmail.

Uso:
    python3 explorer_legalmail.py

Atencao ao rate limit (30 req/min). Este script espera 2.1s entre chamadas.
Nao modifica nada — apenas le.

ATENCAO: o token esta hardcoded abaixo (pego do briefing-astrea/config.py).
Nao versionar este arquivo em repositorio publico.
"""
import json
import time
from typing import Any

import requests

BASE_URL = "https://app.legalmail.com.br"
TOKEN = "cdf85d58-a6d0-b1fd-d1b0-2bae98d36b64"

# Rate limit explicito
INTERVALO_SEC = 2.1
_ultima_chamada = 0.0


def aguardar():
    global _ultima_chamada
    decorrido = time.monotonic() - _ultima_chamada
    if decorrido < INTERVALO_SEC:
        time.sleep(INTERVALO_SEC - decorrido)
    _ultima_chamada = time.monotonic()


def sep(titulo: str) -> None:
    print()
    print("=" * 78)
    print(f" {titulo}")
    print("=" * 78)


def explorar(endpoint: str, params: dict | None = None) -> Any:
    aguardar()
    p = dict(params or {})
    p["api_key"] = TOKEN
    url = f"{BASE_URL}{endpoint}"
    print(f"\n>>> GET {endpoint}")
    if params:
        print(f"    params={params}")
    try:
        r = requests.get(url, params=p, timeout=30,
                         headers={"Accept": "application/json"})
    except Exception as e:
        print(f"  ERRO de rede: {e}")
        return None
    print(f"    HTTP {r.status_code}")
    if r.status_code == 429:
        print(f"    RATE LIMIT! Retry-After: {r.headers.get('Retry-After')}")
        print(f"    Body: {r.text[:300]}")
        return None
    try:
        data = r.json()
    except Exception:
        print(f"    Resposta nao-JSON: {r.text[:300]}")
        return None
    return data


def descrever(data: Any, max_preview: int = 1) -> None:
    if data is None:
        return
    if isinstance(data, list):
        print(f"    Array direto: {len(data)} itens")
        if data and max_preview > 0:
            print(f"\n    Exemplo (1o item):")
            print(json.dumps(data[0], indent=2, ensure_ascii=False)[:3000])
            if isinstance(data[0], dict):
                print(f"\n    Campos disponiveis: {sorted(data[0].keys())}")
    elif isinstance(data, dict):
        print(f"    Chaves top-level: {list(data.keys())}")
        for key in ["lawsuits", "processos", "case_files", "movimentacoes",
                    "movements", "data", "items", "results"]:
            if key in data and isinstance(data[key], list):
                items = data[key]
                print(f"    Array '{key}': {len(items)} itens")
                if items and max_preview > 0:
                    print(f"\n    Exemplo (1o item de '{key}'):")
                    print(json.dumps(items[0], indent=2, ensure_ascii=False)[:3000])
                    if isinstance(items[0], dict):
                        print(f"\n    Campos disponiveis: {sorted(items[0].keys())}")
                break
        # Mostrar metadata
        for key in ["total", "count", "offset", "limit", "page"]:
            if key in data:
                print(f"    {key}: {data[key]}")


# =========================================================================
# 1. LISTA DE PROCESSOS
# =========================================================================
sep("1. GET /api/v1/lawsuit/all — lista de processos do workspace")
data = explorar("/api/v1/lawsuit/all", params={"offset": 0, "limit": 5})
descrever(data)

# Captura primeiro idprocessos para usar nos endpoints abaixo
# (atencao: o campo se chama 'idprocessos' no plural)
primeiro_id = None
if isinstance(data, list) and data:
    primeiro_id = (
        data[0].get("idprocessos")
        or data[0].get("idprocesso")
        or data[0].get("id")
    )
elif isinstance(data, dict):
    for key in ["lawsuits", "processos", "data", "items"]:
        if key in data and data[key]:
            primeiro_id = (
                data[key][0].get("idprocessos")
                or data[key][0].get("idprocesso")
                or data[key][0].get("id")
            )
            break

# =========================================================================
# 2. DETALHE DE UM PROCESSO
# =========================================================================
if primeiro_id:
    # API espera idprocesso (singular) e INT, mesmo que o JSON retorne "idprocessos" string
    try:
        id_int = int(primeiro_id)
    except (ValueError, TypeError):
        id_int = primeiro_id

    sep(f"2. GET /api/v1/lawsuit/detail — detalhe do processo {id_int}")
    data2 = explorar("/api/v1/lawsuit/detail",
                     params={"idprocesso": id_int})
    # Se vier {status, message} eh erro — mostrar mensagem
    if isinstance(data2, dict) and "status" in data2 and "message" in data2 and len(data2) <= 3:
        print(f"    Resposta de erro: {data2}")
        # Tentar com numero_processo
        cnj = None
        if isinstance(data, list) and data:
            cnj = data[0].get("numero_processo")
        if cnj:
            print(f"\n    Tentando com numero_processo='{cnj}'...")
            data2 = explorar("/api/v1/lawsuit/detail",
                             params={"numero_processo": cnj})
            if isinstance(data2, dict) and "status" in data2 and "message" in data2 and len(data2) <= 3:
                print(f"    Resposta de erro: {data2}")
            else:
                descrever(data2, max_preview=1)
        else:
            descrever(data2, max_preview=1)
    else:
        descrever(data2, max_preview=1)

    # =========================================================================
    # 3. MOVIMENTACOES (case-files)
    # =========================================================================
    sep(f"3. GET /api/v1/lawsuit/case-files — movs do processo {id_int}")
    data3 = explorar("/api/v1/lawsuit/case-files",
                     params={"idprocesso": id_int})
    if isinstance(data3, dict) and "status" in data3 and "message" in data3 and len(data3) <= 3:
        print(f"    Resposta de erro: {data3}")
    else:
        descrever(data3, max_preview=2)
else:
    print("\nNao foi possivel capturar idprocessos para os proximos endpoints.")

# =========================================================================
# 4. INBOX (se houver)
# =========================================================================
sep("4. GET /api/v1/inbox — testar se existe endpoint de inbox")
data = explorar("/api/v1/inbox", params={"offset": 0, "limit": 3})
descrever(data)

# =========================================================================
# 5. OPENAPI DOCS — para descobrir endpoints faltando
# =========================================================================
sep("5. GET /api/docs ou /api/openapi.json — discovery")
for path in ["/api/openapi.json", "/api/v1/openapi.json", "/openapi.json"]:
    aguardar()
    print(f"\n>>> GET {path}")
    try:
        r = requests.get(f"{BASE_URL}{path}", timeout=15,
                         params={"api_key": TOKEN})
        print(f"    HTTP {r.status_code}")
        if r.status_code == 200:
            try:
                docs = r.json()
                if "paths" in docs:
                    print(f"    Endpoints documentados:")
                    for p in sorted(docs["paths"].keys()):
                        methods = list(docs["paths"][p].keys())
                        print(f"      {','.join(methods).upper()} {p}")
                    break
            except Exception:
                print(f"    HTML retornado (provavelmente Swagger UI)")
    except Exception as e:
        print(f"    ERRO: {e}")

print()
print("=" * 78)
print(" FIM. Cola o output todo no chat para analise.")
print("=" * 78)
