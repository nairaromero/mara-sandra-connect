// Lista carregada em paginas por offset, com "Mostrar mais".
//
// `buscar(offset, limite)` devolve UMA pagina (RPC com p_limite/p_offset ou
// query com .range()). O total vem de cada linha (`count(*) over ()` nas RPCs
// do QG) — quando a fonte nao informa, "tem mais" e inferido pela pagina
// cheia. Recarrega do zero quando `chave` muda (busca/filtros); resposta
// atrasada de uma busca anterior e descartada (contador de pedidos), senao a
// lista mostraria o resultado de um filtro que a pessoa ja trocou.

import { useCallback, useEffect, useRef, useState } from "react";

export interface PaginaResp<T> {
  data: Array<T> | null;
  error: { message: string } | null;
}

export interface ListaPaginada<T> {
  itens: Array<T>;
  /** total de linhas que a busca alcança; null quando a fonte não informa */
  total: number | null;
  temMais: boolean;
  carregando: boolean;
  carregandoMais: boolean;
  erro: string | null;
  mais: () => void;
  recarregar: () => void;
}

export function useListaPaginada<T extends { total?: number | null }>(
  buscar: (offset: number, limite: number) => PromiseLike<PaginaResp<T>>,
  chave: string,
  porPagina = 10,
  idDe?: (t: T) => string,
): ListaPaginada<T> {
  const [itens, setItens] = useState<Array<T>>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);
  // buscar/idDe chegam como arrow inline (identidade nova a cada render): vao
  // por ref, senao carregarPagina mudaria todo render e o efeito recarregaria a
  // pagina 0 sem parar — foi o que engoliu o "Mostrar mais" no primeiro teste.
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;
  const idDeRef = useRef(idDe);
  idDeRef.current = idDe;

  const carregarPagina = useCallback(
    async (offset: number, acumulado: Array<T>) => {
      const meu = ++pedido.current;
      if (offset === 0) setCarregando(true);
      else setCarregandoMais(true);
      const { data, error } = await buscarRef.current(offset, porPagina);
      if (meu !== pedido.current) return; // chegou atrasado: outro pedido ja venceu
      setCarregando(false);
      setCarregandoMais(false);
      if (error) {
        // erro NAO vira lista vazia: quem ve a tela precisa saber
        setErro(error.message);
        return;
      }
      setErro(null);
      const pagina = data ?? [];
      const idDeAtual = idDeRef.current;
      const vistos = new Set(idDeAtual ? acumulado.map(idDeAtual) : []);
      const novos = idDeAtual ? pagina.filter((x) => !vistos.has(idDeAtual(x))) : pagina;
      const lista = offset === 0 ? pagina : [...acumulado, ...novos];
      const totalInformado = pagina[0]?.total ?? (offset === 0 ? null : acumulado[0]?.total ?? null);
      setItens(lista);
      setTotal(totalInformado ?? (pagina.length < porPagina ? lista.length : null));
      setTemMais(totalInformado != null ? lista.length < totalInformado : pagina.length === porPagina);
    },
    [porPagina],
  );

  useEffect(() => {
    void carregarPagina(0, []);
    // `chave` e o gatilho deliberado: muda a busca/filtro, recomeca do zero
  }, [chave, carregarPagina]);

  return {
    itens,
    total,
    temMais,
    carregando,
    carregandoMais,
    erro,
    mais: () => void carregarPagina(itens.length, itens),
    recarregar: () => void carregarPagina(0, []),
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
