// Config do Vite SEM o preset da Lovable.
//
// Reproduz o caminho NAO-sandbox de @lovable.dev/vite-tanstack-config@1.7.0
// (dist/index.js). Ficaram de fora, de proposito, as partes que so serviam
// dentro do sandbox da Lovable: componentTagger (lovable-tagger),
// devServerBridgePlugin, hmrGatePlugin e os dois loggers de erro de dev
// (o repo tem o proprio em src/lib/error-capture.ts + src/server.ts).
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// AMBIENTES (ver planning/AMBIENTES.md): build de branch NAO-main no
// Cloudflare (WORKERS_CI_BRANCH) aponta pro Supabase de STAGING - producao
// (main, ou build sem a var) usa o fallback de producao em src/lib/supabase.ts.
// Vars ja definidas explicitamente (ex.: .env.local no dev) tem prioridade.
const branchCI = process.env.WORKERS_CI_BRANCH;
if (branchCI && branchCI !== "main" && !process.env.VITE_SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = "https://alhqbpbekmxpoibrrnbi.supabase.co";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsaHFicGJla214cG9pYnJybmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NTY3NDIsImV4cCI6MjEwMTEzMjc0Mn0.WBM4zpE6R3dlE2iQV8Y0U2n-Zvr9msj9xPNhW434xKM";
}

export default defineConfig(({ command, mode }) => {
  // O preset injetava as VITE_* como `define` literal. Mantido igual: e o que
  // carrega pro bundle as vars setadas acima em process.env.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(env)) {
    define[`import.meta.env.${chave}`] = JSON.stringify(valor);
  }

  return {
    define,
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    server: {
      host: "::",
      port: 8080,
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      // cloudflare so no build, igual ao preset
      ...(command === "build" ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // src/server.ts: nosso wrapper de erro em cima do entry do TanStack Start
        server: { entry: "server" },
      }),
      react(),
    ],
  };
});
