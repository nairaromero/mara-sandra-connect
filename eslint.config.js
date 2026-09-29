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
      // O fuso do escritório mora em UM lugar: `src/lib/fuso.ts` (TZ_BR e os
      // formatadores). Seis pontos escreviam "America/Sao_Paulo" à mão, e o
      // risco não é escrever errado — é ESQUECER: sem o fuso, a data sai no
      // relógio de quem olha, que no Brasil parece certo e de fora mostra o dia
      // seguinte. Foi assim que o prazo de 23h59 apareceu como do dia
      // seguinte em 21/09 (e2e/tests/datas-fuso-brasilia.spec.ts).
      "no-restricted-syntax": [
        "error",
        {
          selector: 'Literal[value="America/Sao_Paulo"]',
          message:
            "Não escreva o fuso à mão: use dataBR/dataHoraBR/horaBR/formatarBR de @/lib/fuso (TZ_BR vive lá).",
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // `any` e sinal de qualidade, nao defeito: aviso, nao erro. Mais da
      // metade das ocorrencias esta em whatsapp-inbound, que esta desligada.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // O túnel é a única exceção: é ele que define o fuso.
    files: ["src/lib/fuso.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
