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
import { useMemo, useState } from "react";
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
  label: string;
}

interface SelecaoProps {
  opcoes: Array<OpcaoSelecao>;
  value: string;
  onChange: (novo: string) => void;
  /** Liga/desliga o campo de busca. Sem isto, decide o tamanho da lista. */
  busca?: boolean;
  placeholder?: string;
  buscaPlaceholder?: string;
  vazio?: string;
  disabled?: boolean;
  className?: string;
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
          data-selecao={resto["data-selecao"]}
        >
          <span className={cn("truncate", !escolhida && "text-muted-foreground")}>
            {escolhida ? escolhida.label : placeholder || "Selecione..."}
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
            {comBusca && <CommandEmpty>{vazio ?? "Nada encontrado."}</CommandEmpty>}
            <CommandGroup>
              {opcoes.map((opt) => (
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
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
