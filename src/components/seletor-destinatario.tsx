// "Para: [ pessoa | Todos ]" — dá dono à conversa com o parceiro.
//
// Até agora comentário não tinha destinatário: parceiro escrevia e a
// notificação ia pra TODOS os internos ativos. Com 5 pessoas na equipe, todo
// mundo recebia tudo e ninguém era responsável — a /conversas virava uma pilha
// sem dono.
//
// O destinatário é da CONVERSA, não da mensagem: fica na raiz da thread e as
// respostas herdam. Por isso este seletor só aparece ao abrir conversa nova.
//
// O default é a última pessoa da equipe que falou naquele caso — quase sempre a
// certa, porque a conversa já está correndo com ela. Sem ninguém, cai em Todos.
// A escolha foi essa (e não "Todos" fixo) porque, com Todos no default, todo
// mundo deixaria em Todos e nada mudaria na prática.
//
// Vale pros dois lados: interno também escolhe, e "Todos" continua existindo
// pra recado que é mesmo do escritório inteiro.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DESTINATARIO_TODOS } from "@/lib/conversas/destinatario";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface InternoLite {
  id: string;
  nome: string | null;
}

export function SeletorDestinatario({
  value,
  onChange,
  className,
}: {
  /** id do interno, ou DESTINATARIO_TODOS */
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [internos, setInternos] = useState<Array<InternoLite>>([]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // O parceiro consegue ler isto: a policy `usuarios_select_internos`
      // libera tipo='interno' pra qualquer autenticado.
      const resp = await supabase
        .from("usuarios")
        .select("id, nome")
        .eq("tipo", "interno")
        .eq("ativo", true)
        .order("nome");
      if (vivo && !resp.error) setInternos((resp.data as Array<InternoLite>) ?? []);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className={"flex items-center gap-2 " + (className ?? "")}>
      <span className="text-xs text-muted-foreground shrink-0">Para:</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-auto min-w-[150px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DESTINATARIO_TODOS}>Todos da equipe</SelectItem>
          {internos.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.nome ?? "(sem nome)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
