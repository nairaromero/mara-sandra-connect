// Combobox generico com busca por substring, ignorando acento e caixa.
// Substitui o Select padrao onde a lista e longa demais pra rolar.
// Opcoes definidas pelos consumidores (prop `options`). Nasceu pro tipo de
// documento (dai o nome); hoje tambem busca o cliente/caso no sheet de tarefa.
import { useState } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface DocTypeOption {
  value: string;
  label: string;
}

interface DocTypeComboboxProps {
  options: Array<DocTypeOption>;
  value: string;
  onChange: (newValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
}

/** Lowercase + sem acento (mesmo idioma de doc-type-inference). */
function normalizar(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function DocTypeCombobox(props: DocTypeComboboxProps) {
  const { options, value, onChange, placeholder, disabled, searchPlaceholder, emptyText } = props;
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  // O cmdk identifica cada item pelo `value` da opcao (unico por contrato,
  // mesmo quando dois rotulos repetem — ex.: dois casos "(sem nome)"); na hora
  // de filtrar, buscamos no rotulo correspondente via este Map.
  const labelPorValue = new Map(options.map((o) => [o.value, o.label]));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder || "Selecione..."}
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
          filter={(itemValue, search) =>
            normalizar(labelPorValue.get(itemValue) ?? itemValue).includes(normalizar(search))
              ? 1
              : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder ?? "Buscar tipo..."} />
          <CommandList>
            <CommandEmpty>{emptyText ?? "Nenhum tipo encontrado."}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === opt.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
