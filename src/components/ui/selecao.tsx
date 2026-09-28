// Escolher UM valor de uma lista. Um componente só, com as funcionalidades
// ligáveis por prop.
//
// Por que existe (pedido da Naira, 2026-09-28): havia QUATRO caminhos para a
// mesma decisão — `Select` do shadcn em 23 arquivos (sem busca), um combobox
// próprio com busca em 6 (`DocTypeCombobox`, que nasceu para tipo de documento
// e acabou escolhendo cliente), `<select>` nativo em 2 e `Command` cru em 3.
// Escolhas idênticas ficavam com comportamentos diferentes: no sheet de tarefa
// dava para buscar o cliente entre 466; na agenda, a mesma escolha era uma
// lista de 466 para rolar.
//
// A BUSCA LIGA SOZINHA. É a parte que importa: o dropdown de 466 itens sem
// busca não nasceu de uma decisão, nasceu de alguém não lembrar de ligar. Aqui
// a decisão é da lista — a partir de `LIMITE_BUSCA` opções o campo aparece —, e
// quem quiser manda: `busca` força ligado ou desligado.
//
// Migração do resto (os 23 `Select` e os 2 nativos) é lote à parte.
import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A partir daqui a busca aparece sozinha. Abaixo disso, rolar é mais rápido. */
export const LIMITE_BUSCA = 8;

export interface OpcaoSelecao {
  value: string;
  /** O que a pessoa lê — e o que a BUSCA procura. Sempre texto puro. */
  label: string;
  /**
   * Substitui o rótulo só na exibição (ícone, badge, texto secundário). A busca
   * continua no `label`: procurar dentro de JSX não funciona, e um rótulo que
   * some da busca é um item que a pessoa não acha.
   */
  conteudo?: ReactNode;
  /** Cabeçalho do bloco. Opções sem grupo aparecem antes dos grupos. */
  grupo?: string;
}

interface SelecaoProps {
  opcoes: Array<OpcaoSelecao>;
  /** Indefinido = nada escolhido (era o que o Radix aceitava). */
  value: string | undefined;
  onChange: (novo: string) => void;
  /** Liga/desliga o campo de busca. Sem isto, decide o tamanho da lista. */
  busca?: boolean;
  placeholder?: string;
  buscaPlaceholder?: string;
  vazio?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Nome acessível do campo. O `SelectTrigger` do Radix herdava isto do
   * `<Label>`; um botão não herda. Sem ele, leitor de tela anuncia só o valor
   * escolhido — e não diz de QUE campo ele é.
   */
  "aria-label"?: string;
  /**
   * O `<FormControl>` do shadcn clona o filho injetando `id` e os `aria-*` que
   * ligam o campo ao `<FormLabel>` e à mensagem de erro. Sem repassar, o rótulo
   * fica solto: clicar nele não foca o campo, e o leitor de tela não sabe o
   * nome nem o erro.
   */
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /** Vai para o botão, para as specs acharem este campo entre vários. */
  "data-selecao"?: string;
}

/** Minúsculas e sem acento — "Sao Joao" acha "São João". */
function normalizar(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function Selecao({
  opcoes,
  value,
  onChange,
  busca,
  placeholder,
  buscaPlaceholder,
  vazio,
  disabled,
  className,
  ...resto
}: SelecaoProps) {
  const [aberto, setAberto] = useState(false);
  const escolhida = opcoes.find((o) => o.value === value);
  const comBusca = busca ?? opcoes.length >= LIMITE_BUSCA;

  // O cmdk identifica cada item pelo `value` (único por contrato, mesmo quando
  // dois rótulos repetem — dois casos "(sem nome)", dois clientes homônimos).
  // Para filtrar pelo que a pessoa LÊ, o rótulo vem deste mapa.
  const rotuloPorValue = useMemo(
    () => new Map(opcoes.map((o) => [o.value, o.label])),
    [opcoes],
  );

  // Um bloco por grupo, na ordem em que os grupos aparecem. Quem não tem grupo
  // fica no bloco sem cabeçalho, que vem primeiro — é onde moram os "Sem
  // cliente", "Todos" e afins.
  const blocos = useMemo(() => {
    const mapa = new Map<string, Array<OpcaoSelecao>>([["", []]]);
    for (const o of opcoes) {
      const chave = o.grupo ?? "";
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(o);
    }
    return [...mapa.entries()].filter(([, itens]) => itens.length > 0);
  }, [opcoes]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
          id={resto.id}
          aria-label={resto["aria-label"]}
          aria-labelledby={resto["aria-labelledby"]}
          aria-describedby={resto["aria-describedby"]}
          aria-invalid={resto["aria-invalid"]}
          data-selecao={resto["data-selecao"]}
        >
          <span className={cn("truncate", !escolhida && "text-muted-foreground")}>
            {escolhida ? (escolhida.conteudo ?? escolhida.label) : placeholder || "Selecione..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command
          filter={(itemValue, procura) =>
            normalizar(rotuloPorValue.get(itemValue) ?? itemValue).includes(normalizar(procura))
              ? 1
              : 0
          }
        >
          {comBusca && (
            <CommandInput placeholder={buscaPlaceholder ?? "Buscar..."} data-selecao-busca />
          )}
          <CommandList>
            {/* Sempre: lista vazia precisa dizer que está vazia, com ou sem busca. */}
            <CommandEmpty>{vazio ?? "Nada encontrado."}</CommandEmpty>
            {blocos.map(([titulo, itens]) => (
              <CommandGroup key={titulo || "__sem_grupo__"} heading={titulo || undefined}>
                {itens.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onChange(opt.value);
                      setAberto(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === opt.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{opt.conteudo ?? opt.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
