import * as React from "react";

import { cn } from "@/lib/utils";

// Campo que NÃO é login da pessoa: chave de API, credencial de integração, senha
// do Meu INSS do cliente. Os gerenciadores de senha ignoram `autoComplete="off"`
// e, num formulário com um campo de senha, tratam o vizinho (ex.: "Modelo")
// como usuário — o ícone do 1Password aparecia por cima da lista de modelos e
// ele oferecia salvar a chave da IA como se fosse login. Cada gerenciador tem
// o próprio atributo; ficam todos aqui, num lugar só.
// Régua: e2e/unit/campos-sem-gerenciador-senha.test.ts.
const IGNORAR_GERENCIADOR_DE_SENHA = {
  autoComplete: "off",
  "data-1p-ignore": "true", // 1Password
  "data-lpignore": "true", // LastPass
  "data-bwignore": "true", // Bitwarden
  "data-form-type": "other", // Dashlane
} as const;

interface InputProps extends React.ComponentProps<"input"> {
  /** Campo que não é login da pessoa: os gerenciadores de senha o ignoram. */
  semGerenciadorDeSenha?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, semGerenciadorDeSenha, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
        {...(semGerenciadorDeSenha ? IGNORAR_GERENCIADOR_DE_SENHA : {})}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
