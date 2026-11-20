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

const estado = {
  escritorioId: null as string | null,
  lista: null as Array<IntegracaoStatus> | null,
  erro: null as string | null,
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
  estado.lidaEm = Date.now();
  supabase.rpc("minhas_integracoes").then(({ data, error }) => {
    if (pedido !== estado.pedido) return; // resposta de um pedido que já foi substituído
    if (error) {
      console.error("minhas_integracoes:", error.message);
      estado.erro = error.message;
      estado.lidaEm = 0; // o próximo componente que aparecer tenta de novo, sem esperar a validade
      // a lista que já estava na tela fica: uma releitura que falha não apaga o que se sabia
    } else {
      estado.erro = null;
      estado.lista = (data ?? []) as Array<IntegracaoStatus>;
    }
    for (const ouvinte of ouvintes) ouvinte();
  });
}

export function useIntegracoesEscritorio() {
  const { escritorio } = useAuth();
  const escritorioId = escritorio?.escritorio_id ?? null;
  const lista = useSyncExternalStore(assinar, () => (estado.escritorioId === escritorioId ? estado.lista : null));
  const erro = useSyncExternalStore(assinar, () => (estado.escritorioId === escritorioId ? estado.erro : null));

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
  return { lista, erro, tem, recarregar };
}
