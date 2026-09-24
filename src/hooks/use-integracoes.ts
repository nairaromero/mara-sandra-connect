// Quais integrações o escritório ativo tem (Legalmail, TI…), sem segredo —
// RPC minhas_integracoes (migration_rbac_13). Serve para a tela só oferecer
// "Buscar no Legalmail" / "Buscar no TI" / "Sync Legal" onde há credencial:
// o banco/function já recusam (412), mas a tela não deve convidar ao erro.
// `tem(tipo)` devolve null enquanto carrega — quem usa esconde o botão até saber.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

export interface IntegracaoStatus {
  tipo: string;
  ativo: boolean;
  configurada: boolean;
  legado: boolean;
}

export function useIntegracoesEscritorio() {
  const { escritorio } = useAuth();
  const escritorioId = escritorio?.escritorio_id ?? null;
  const [lista, setLista] = useState<Array<IntegracaoStatus> | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!escritorioId) return;
    let vivo = true;
    setLista(null);
    supabase.rpc("minhas_integracoes").then(({ data, error }) => {
      if (!vivo) return;
      // erro de consulta não vira "nenhuma integração": some o botão e o console avisa
      if (error) {
        console.error("minhas_integracoes:", error.message);
        setLista([]);
        return;
      }
      setLista((data ?? []) as Array<IntegracaoStatus>);
    });
    return () => {
      vivo = false;
    };
  }, [escritorioId, versao]);

  const tem = useCallback(
    (tipo: string): boolean | null => {
      if (lista === null) return null;
      const i = lista.find((x) => x.tipo === tipo);
      return !!i && i.ativo && i.configurada;
    },
    [lista],
  );
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { lista, tem, recarregar };
}
