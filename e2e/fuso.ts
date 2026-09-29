// O fuso do escritório, para as specs.
//
// O eslint manda usar `@/lib/fuso`, mas o alias `@/` só existe para o app: o
// tsconfig nem inclui `e2e/`, e nenhuma spec importa por ele. O resultado é que
// cada spec que precisava do fuso reescrevia "America/Sao_Paulo" à mão — quatro
// ocorrências já estavam na staging quando este arquivo nasceu.
//
// Este módulo é só um cano: ele REEXPORTA o túnel do app pelo caminho relativo.
// Não há literal nenhum aqui de propósito — se houvesse, seria a segunda
// definição do fuso, que é exatamente o que a regra existe para impedir.
// `src/lib/fuso.ts` não importa nada, então roda no node do Playwright igual.
export { TZ_BR } from "../src/lib/fuso";
