// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// AMBIENTES (ver planning/AMBIENTES.md): build de branch NÃO-main no
// Cloudflare (WORKERS_CI_BRANCH) aponta pro Supabase de STAGING — produção
// (main, ou build sem a var) usa o fallback de produção em src/lib/supabase.ts.
// Vars já definidas explicitamente (ex.: .env.local no dev) têm prioridade.
const branchCI = process.env.WORKERS_CI_BRANCH;
if (branchCI && branchCI !== "main" && !process.env.VITE_SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = "https://alhqbpbekmxpoibrrnbi.supabase.co";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsaHFicGJla214cG9pYnJybmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NTY3NDIsImV4cCI6MjEwMTEzMjc0Mn0.WBM4zpE6R3dlE2iQV8Y0U2n-Zvr9msj9xPNhW434xKM";
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
});
