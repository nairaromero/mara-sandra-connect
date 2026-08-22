import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Formatacao NAO e lint. O prettier roda por `bun run format` (e no editor);
// deixa-lo como regra do eslint enchia a saida com 2.003 erros de espaco em
// branco e enterrava os problemas de verdade — que eram 40.
export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "**/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // `any` e sinal de qualidade, nao defeito: aviso, nao erro. Mais da
      // metade das ocorrencias esta em whatsapp-inbound, que esta desligada.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
