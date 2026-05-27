#!/usr/bin/env python3
"""
Explorer Legalmail v2 — caca CPF e dados do polo ativo.
"""
import json
import time
import requests

BASE_URL = "https://app.legalmail.com.br"
TOKEN = "cdf85d58-a6d0-b1fd-d1b0-2bae98d36b64"

INTERVALO = 2.1
_ultima = 0.0


def aguardar():
    global _ultima
    d = time.monotonic() - _ultima
    if d < INTERVALO:
        time.sleep(INTERVALO - d)
    _ultima = time.monotonic()


def get(path, params=None):
    aguardar()
    p = dict(params or {})
    p["api_key"] = TOKEN
    url = f"{BASE_URL}{path}"
    print(f"\n>>> GET {path} {params or ''}")
    try:
        r = requests.get(url, params=p, timeout=30,
                         headers={"Accept": "application/json"})
        print(f"    HTTP {r.status_code}")
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                print(f"    nao-JSON: {r.text[:200]}")
                return None
        elif r.status_code in (400, 404, 405, 422):
            try:
                print(f"    body: {r.json()}")
            except Exception:
                print(f"    body: {r.text[:200]}")
            return None
        else:
            print(f"    body: {r.text[:200]}")
            return None
    except Exception as e:
        print(f"    erro: {e}")
        return None


def sep(t):
    print(f"\n{'=' * 78}\n {t}\n{'=' * 78}")


# Pegar primeiro idprocesso
sep("0. Capturar 1o processo")
d = get("/api/v1/lawsuit/all", {"offset": 0, "limit": 1})
id_proc = None
if isinstance(d, list) and d:
    id_proc = int(d[0]["idprocessos"])
    print(f"    Usando idprocesso={id_proc} (poloativo={d[0]['poloativo_nome']})")

# =====================================================================
# 1. Detail com flags adicionais (algumas APIs aceitam ?expand=parties)
# =====================================================================
sep("1. Detail com possiveis flags de expansao")
for params in [
    {"idprocesso": id_proc, "expand": "parties"},
    {"idprocesso": id_proc, "include": "parties"},
    {"idprocesso": id_proc, "with": "parties"},
    {"idprocesso": id_proc, "full": "1"},
    {"idprocesso": id_proc, "detailed": "true"},
]:
    d2 = get("/api/v1/lawsuit/detail", params)
    if d2 and isinstance(d2, dict):
        novas_keys = set(d2.keys()) - {
            "idprocessos", "numero_processo", "hash_processo", "last_import",
            "poloativo_nome", "polopassivo_nome", "nome_classe",
            "abreviatura_classe", "foro", "inbox_atual", "juizo",
            "valor_causa", "data_distribuicao", "tribunal", "processo_tema",
            "sistema_tribunal", "data_prazo", "campos_personalizados"
        }
        if novas_keys:
            print(f"    !!! NOVAS CHAVES: {novas_keys}")
            print(json.dumps({k: d2[k] for k in novas_keys}, indent=2, ensure_ascii=False)[:1000])
        else:
            print(f"    sem novas chaves (mesmo schema)")

# =====================================================================
# 2. Endpoints de partes/clientes
# =====================================================================
sep("2. Endpoints alternativos para partes")
for endpoint in [
    "/api/v1/lawsuit/parties",
    "/api/v1/lawsuit/partes",
    "/api/v1/parties",
    "/api/v1/clients",
    "/api/v1/clientes",
    "/api/v1/parts",
    "/api/v1/poloativo",
    "/api/v1/lawsuit/poloativo",
    "/api/v1/lawsuit/clients",
    "/api/v1/lawsuit/people",
]:
    get(endpoint, {"idprocesso": id_proc} if id_proc else None)

# =====================================================================
# 3. Buscar processo por nome (parametro alternativo)
# =====================================================================
sep("3. Filtros possiveis em /lawsuit/all")
for params in [
    {"poloativo_nome": "FLAVIO"},
    {"name": "FLAVIO"},
    {"q": "FLAVIO"},
    {"search": "FLAVIO"},
    {"cpf": "12345678900"},
    {"cpf_poloativo": "12345678900"},
]:
    d = get("/api/v1/lawsuit/all", {**params, "limit": 2})
    if d and isinstance(d, list) and len(d) > 0:
        print(f"    filtro funcionou? primeiro: {d[0].get('poloativo_nome')}")

# =====================================================================
# 4. Documento (download)
# =====================================================================
if id_proc:
    sep("4. Download de documento (hash_documento de uma movimentacao)")
    movs = get("/api/v1/lawsuit/case-files", {"idprocesso": id_proc})
    if movs and isinstance(movs, list) and movs:
        hash_doc = movs[0].get("hash_documento")
        print(f"\n    hash_documento de teste: {hash_doc}")
        for endpoint in [
            f"/api/v1/document/{hash_doc}",
            f"/api/v1/lawsuit/document/{hash_doc}",
            f"/api/v1/case-files/{hash_doc}",
            f"/api/v1/lawsuit/case-files/{hash_doc}",
            "/api/v1/lawsuit/document",
        ]:
            params = None
            if endpoint.endswith("/document"):
                params = {"hash_documento": hash_doc}
            aguardar()
            url = f"{BASE_URL}{endpoint}"
            print(f"\n>>> GET {endpoint} {params or ''}")
            p = dict(params or {})
            p["api_key"] = TOKEN
            try:
                r = requests.get(url, params=p, timeout=30)
                print(f"    HTTP {r.status_code}")
                ct = r.headers.get("Content-Type", "")
                print(f"    Content-Type: {ct}")
                if "pdf" in ct.lower() or "octet" in ct.lower():
                    print(f"    !!! parece ser arquivo binario, tamanho: {len(r.content)} bytes")
                elif r.status_code == 200:
                    try:
                        print(f"    body json: {r.json()}")
                    except Exception:
                        print(f"    body: {r.text[:300]}")
                else:
                    try:
                        print(f"    erro: {r.json()}")
                    except Exception:
                        print(f"    erro: {r.text[:200]}")
            except Exception as e:
                print(f"    erro: {e}")

print(f"\n{'=' * 78}\n FIM\n{'=' * 78}")
