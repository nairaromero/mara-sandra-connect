// Quais integrações o escritório ativo tem (Legalmail, TI, ZapSign…), sem
// segredo — RPC minhas_integracoes (migration_rbac_13). Serve para a tela só
// oferecer "Buscar no Legalmail" / "Enviar para assinatura" onde há credencial
// (o banco/function já recusam com 412, mas a tela não deve convidar ao erro) e
// para o catálogo de Configurações → Integrações mostrar o estado de cada uma.
//
// Uma leitura só para a página inteira: o estado mora aqui no módulo e todos
// os componentes que usam o hook enxergam o mesmo — quem salva uma integração
// chama `recarregar()` e o botão do caso e o catálogo mudam juntos. Antes cada
// uso do hook fazia a sua própria consulta (três na tela do caso).
// `tem(tipo)` devolve null enquanto carrega — quem usa esconde o botão até saber.
// Leitura que FALHA não vira "nenhuma integração": a lista fica null (botão
// escondido, como enquanto carrega) e `erro` diz o que houve — o catálogo
// mostrava "Não configurada" e o botão "Integrar" em integração que estava ativa.
// A leitura tem tempo limite (TEMPO_LIMITE_MS) e tenta de novo sozinha
// (ESPERAS_MS) antes de dar erro: uma falha passageira escondia "Gerar contrato"
// e "Enviar para assinatura" até a pessoa recarregar a página, sem aviso (#548).
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

export interface IntegracaoStatus {
  tipo: string;
  ativo: boolean;
  configurada: boolean;
  legado: boolean;
}

/** Leitura mais velha que isto é refeita quando um componente novo aparece. */
const VALIDADE_MS = 30_000;
/** Uma consulta presa não segura a tela: passou disto, conta como falha e tenta de novo. */
const TEMPO_LIMITE_MS = 10_000;
/** Espera antes de cada nova tentativa; acabou a lista, a falha aparece (`erro`). */
const ESPERAS_MS = [2_000, 5_000];

const estado = {
  escritorioId: null as string | null,
  lista: null as Array<IntegracaoStatus> | null,
  erro: null as string | null,
  verificando: false, // uma (re)leitura em curso depois de uma falha — a tela mostra "Verificando…"
  lidaEm: 0,
  pedido: 0,
};
const ouvintes = new Set<() => void>();
function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function buscar(escritorioId: string) {
  const pedido = ++estado.pedido;
  if (estado.escritorioId !== escritorioId) {
    estado.escritorioId = escritorioId;
    estado.lista = null; // outro escritório: nada do anterior fica na tela
    estado.erro = null;
  }
  // re-checagem manual ("Tentar de novo") com erro na tela já mostra "Verificando…";
  // na primeira leitura (sem erro) fica quieta, para não piscar no caminho feliz.
  estado.verificando = estado.erro !== null;
  estado.lidaEm = Date.now();
  if (estado.verificando) for (const ouvinte of ouvintes) ouvinte();
  tentar(pedido, 0);
}

function tentar(pedido: number, tentativa: number) {
  // Uma tentativa que falhou: tenta de novo enquanto houver espera na fila
  // (acendendo "Verificando…"); esgotadas as esperas, marca `erro`.
  const falhou = (mensagem: string, nome?: string) => {
    if (pedido !== estado.pedido) return; // pedido já substituído
    const espera = ESPERAS_MS[tentativa];
    if (espera !== undefined) {
      estado.verificando = true; // avisa que está tentando de novo (fecha a janela silenciosa)
      for (const ouvinte of ouvintes) ouvinte();
      setTimeout(() => pedido === estado.pedido && tentar(pedido, tentativa + 1), espera);
      return;
    }
    console.error("minhas_integracoes:", mensagem);
    estado.erro = /abort|timeout/i.test(`${mensagem} ${nome ?? ""}`)
      ? "o banco não respondeu a tempo"
      : mensagem;
    estado.verificando = false;
    estado.lidaEm = 0; // o próximo componente que aparecer tenta de novo, sem esperar a validade
    // a lista que já estava na tela fica: uma releitura que falha não apaga o que se sabia
    for (const ouvinte of ouvintes) ouvinte();
  };
  supabase
    .rpc("minhas_integracoes")
    .abortSignal(AbortSignal.timeout(TEMPO_LIMITE_MS))
    .then(({ data, error }) => {
      if (pedido !== estado.pedido) return; // resposta de um pedido que já foi substituído
      if (error) {
        falhou(error.message, (error as { name?: string }).name);
        return;
      }
      estado.erro = null;
      estado.verificando = false;
      estado.lista = (data ?? []) as Array<IntegracaoStatus>;
      for (const ouvinte of ouvintes) ouvinte();
    },
    // Blindagem: confirmei (teste empírico, supabase-js 2.112) que o abort/timeout
    // RESOLVE com {error} — tratado no 1º argumento. Se algum erro REJEITAR a promise,
    // o onFulfilled sozinho não pegaria e a releitura ficaria presa; o 2º argumento de
    // .then() conta a rejeição como falha (.catch não existe no PromiseLike do postgrest).
    (e: unknown) => {
      const err = e as { message?: string; name?: string };
      falhou(err?.message ?? String(e), err?.name);
    });
}

export function useIntegracoesEscritorio() {
  const { escritorio } = useAuth();
  const escritorioId = escritorio?.escritorio_id ?? null;
  const lista = useSyncExternalStore(assinar, () => (estado.escritorioId === escritorioId ? estado.lista : null));
  const erro = useSyncExternalStore(assinar, () => (estado.escritorioId === escritorioId ? estado.erro : null));
  const verificando = useSyncExternalStore(assinar, () => (estado.escritorioId === escritorioId ? estado.verificando : false));

  useEffect(() => {
    if (!escritorioId) return;
    if (estado.escritorioId !== escritorioId || Date.now() - estado.lidaEm > VALIDADE_MS) buscar(escritorioId);
  }, [escritorioId]);

  const tem = useCallback(
    (tipo: string): boolean | null => {
      if (lista === null) return null;
      const i = lista.find((x) => x.tipo === tipo);
      return !!i && i.ativo && i.configurada;
    },
    [lista],
  );
  const recarregar = useCallback(() => {
    if (escritorioId) buscar(escritorioId);
  }, [escritorioId]);
  return { lista, erro, verificando, tem, recarregar };
}
