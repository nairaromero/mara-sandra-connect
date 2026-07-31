import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

// Fallback local (mesma lista do seed da migration) usado enquanto a tabela
// carrega ou se a leitura falhar - o dropdown nunca fica vazio.
export const TIPOS_BENEFICIO_FALLBACK = [
  "Aposentadoria por idade",
  "Aposentadoria por tempo de contribuição",
  "Aposentadoria especial",
  "Aposentadoria da PCD (LC 142/2013)",
  "Aposentadoria por incapacidade permanente",
  "Auxílio por incapacidade temporária",
  "Auxílio-acidente",
  "Pensão por morte",
  "Salário-maternidade",
  "BPC/LOAS",
  "Revisão da vida toda",
  "Revisão de aposentadoria",
  "Outro",
];

/**
 * Tipos de beneficio ativos, na ordem de exibicao, vindos da tabela
 * tipos_beneficio (gerenciavel em Configuracoes pelo interno).
 */
export function useTiposBeneficio(): Array<string> {
  const [tipos, setTipos] = useState<Array<string>>(TIPOS_BENEFICIO_FALLBACK);
  useEffect(() => {
    let vivo = true;
    supabase
      .from("tipos_beneficio")
      .select("nome")
      .eq("ativo", true)
      .order("ordem")
      .then((resp) => {
        if (!vivo || resp.error || !resp.data || resp.data.length === 0) return;
        setTipos(resp.data.map((r) => r.nome as string));
      });
    return () => {
      vivo = false;
    };
  }, []);
  return tipos;
}
