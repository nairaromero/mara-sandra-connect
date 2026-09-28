// Paginacao por pagina (nao "mostrar mais"): a pessoa escolhe a pagina e o
// tamanho, e so essa pagina e buscada.
//
// useListaPaginada — lista do servidor: `buscar(offset, limite)` devolve UMA
//   pagina (RPC com p_limite/p_offset ou query com .range()) e, quando pode, o
//   total (`count` da resposta ou coluna `total` = count(*) over ()). Muda a
//   `chave` (busca/filtros) -> volta pra pagina 1. Resposta atrasada de um
//   pedido anterior e descartada (contador), senao a lista mostraria o
//   resultado de um filtro que a pessoa ja trocou.
// usePaginaLocal — lista ja carregada (fatia no cliente), mesma interface.
// usePorPagina — tamanho da pagina, lembrado por lista no localStorage.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface PaginaResp<T> {
  data: Array<T> | null;
  error: { message: string } | null;
  count?: number | null;
}

export interface ListaPaginada<T> {
  itens: Array<T>;
  /** total de itens que a busca alcança; null quando a fonte não informa */
  total: number | null;
  pagina: number;
  porPagina: number;
  totalPaginas: number | null;
  temMais: boolean;
  carregando: boolean;
  erro: string | null;
  irPara: (pagina: number) => void;
  setPorPagina: (n: number) => void;
  recarregar: () => void;
}

export interface OpcoesPaginacao {
  /** tamanho inicial da pagina (padrao 25) */
  porPagina?: number;
  /** nome da lista para lembrar o tamanho escolhido (localStorage) */
  persistencia?: string;
}

const CHAVE_LS = (nome: string) => `msc:por_pagina:${nome}`;

/** Tamanho da pagina lembrado por lista. Guardar/ler pode falhar (privado, bloqueado): ignora. */
export function usePorPagina(persistencia: string | undefined, padrao = 25): [number, (n: number) => void] {
  const [porPagina, setPorPaginaState] = useState(() => {
    if (!persistencia || typeof window === "undefined") return padrao;
    try {
      const v = Number(window.localStorage.getItem(CHAVE_LS(persistencia)));
      return Number.isInteger(v) && v > 0 && v <= 500 ? v : padrao;
    } catch {
      return padrao;
    }
  });
  const setPorPagina = useCallback(
    (n: number) => {
      setPorPaginaState(n);
      if (!persistencia || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(CHAVE_LS(persistencia), String(n));
      } catch {
        /* sem armazenamento: so nesta visita */
      }
    },
    [persistencia],
  );
  return [porPagina, setPorPagina];
}

export function useListaPaginada<T extends { total?: number | null }>(
  buscar: (offset: number, limite: number) => PromiseLike<PaginaResp<T>>,
  chave: string,
  opcoes: OpcoesPaginacao = {},
): ListaPaginada<T> {
  const [porPagina, setPorPagina] = usePorPagina(opcoes.persistencia, opcoes.porPagina ?? 25);
  const [pagina, setPagina] = useState(1);
  const [itens, setItens] = useState<Array<T>>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const pedido = useRef(0);
  // `buscar` chega como arrow inline (identidade nova a cada render): vai por
  // ref, senao o efeito recarregaria a cada render.
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;
  const chaveRef = useRef(chave);

  useEffect(() => {
    // filtro/busca mudou: recomeca da pagina 1 (o efeito roda de novo com ela)
    if (chaveRef.current !== chave) {
      chaveRef.current = chave;
      if (pagina !== 1) {
        setPagina(1);
        return;
      }
    }
    let vivo = true;
    const meu = ++pedido.current;
    setCarregando(true);
    void (async () => {
      const { data, error, count } = await buscarRef.current((pagina - 1) * porPagina, porPagina);
      if (!vivo || meu !== pedido.current) return; // chegou atrasado: outro pedido ja venceu
      setCarregando(false);
      if (error) {
        // erro NAO vira lista vazia: quem ve a tela precisa saber
        setErro(error.message);
        return;
      }
      setErro(null);
      const linhas = data ?? [];
      const totalInformado = count ?? linhas[0]?.total ?? null;
      setItens(linhas);
      setTotal(totalInformado);
      setTemMais(totalInformado != null ? pagina * porPagina < totalInformado : linhas.length === porPagina);
      // pagina alem do fim (algo foi apagado): volta pra ultima que existe
      if (totalInformado != null && linhas.length === 0 && pagina > 1) {
        setPagina(Math.max(1, Math.ceil(totalInformado / porPagina)));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chave, pagina, porPagina, versao]);

  const totalPaginas = total != null ? Math.max(1, Math.ceil(total / porPagina)) : null;

  return {
    itens,
    total,
    pagina,
    porPagina,
    totalPaginas,
    temMais,
    carregando,
    erro,
    irPara: (p) => setPagina(Math.max(1, totalPaginas != null ? Math.min(p, totalPaginas) : p)),
    setPorPagina: (n) => {
      setPorPagina(n);
      setPagina(1);
    },
    recarregar: () => setVersao((v) => v + 1),
  };
}

/** Lista ja carregada: fatia no cliente. Muda a `chave` (filtros) -> pagina 1. */
export function usePaginaLocal<T>(todos: Array<T>, chave: string, opcoes: OpcoesPaginacao = {}): ListaPaginada<T> {
  const [porPagina, setPorPagina] = usePorPagina(opcoes.persistencia, opcoes.porPagina ?? 25);
  const [pagina, setPagina] = useState(1);
  const chaveRef = useRef(chave);
  useEffect(() => {
    if (chaveRef.current !== chave) {
      chaveRef.current = chave;
      setPagina(1);
    }
  }, [chave]);
  const total = todos.length;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const itens = useMemo(() => todos.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina), [todos, paginaAtual, porPagina]);
  return {
    itens,
    total,
    pagina: paginaAtual,
    porPagina,
    totalPaginas,
    temMais: paginaAtual < totalPaginas,
    carregando: false,
    erro: null,
    irPara: (p) => setPagina(Math.min(Math.max(1, p), totalPaginas)),
    setPorPagina: (n) => {
      setPorPagina(n);
      setPagina(1);
    },
    recarregar: () => {},
  };
}

/** Valor com atraso (debounce) — para nao bater no banco a cada tecla. */
export function useValorAtrasado<T>(valor: T, ms = 250): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}
