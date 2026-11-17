import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { lerLista } from "@/lib/leitura";
import { COLUNAS_ASSINATURA, type Assinatura } from "@/lib/assinaturas";

/** Os envios do caso. `null` enquanto carrega; erro vai para `erro`, nunca vira lista vazia. */
export function useAssinaturasCaso(casoId: string, ligado: boolean) {
  const [lista, setLista] = useState<Array<Assinatura> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  // Outro caso: os envios do anterior não ficam na tela enquanto os novos carregam.
  useEffect(() => {
    setLista(null);
    setErro(null);
  }, [casoId]);

  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    lerLista<Assinatura>(
      supabase.from("assinaturas").select(COLUNAS_ASSINATURA).eq("caso_id", casoId).order("created_at", { ascending: false }).order("id"),
      "assinaturas do caso",
    ).then(
      (l) => {
        if (!vivo) return;
        setLista(l);
        setErro(null);
      },
      (e: unknown) => {
        if (!vivo) return;
        setErro(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      vivo = false;
    };
  }, [casoId, ligado, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { lista, erro, recarregar };
}

