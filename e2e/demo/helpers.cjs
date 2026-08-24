// Utilitários pros filmes de demonstração de feature (skill /video-demo).
// Filmagem no staging real, ritmo humano, cursor visível, limpeza total.
// Roteiros em e2e/demo/roteiros/*.cjs; saída (vídeo/stills) em e2e/demo/saida/
// — gitignorada: vídeo NUNCA entra no repo (ver e2e/README.md).
//
// Rodar da raiz do repo: `node e2e/demo/roteiros/<roteiro>.cjs`
// (resolve @playwright/test e @supabase/supabase-js do node_modules do repo).

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");

const REPO = path.resolve(__dirname, "..", "..");
const BASE = process.env.DEMO_BASE_URL || "https://staging.marasandraconnect.com";
const SB_URL = "https://alhqbpbekmxpoibrrnbi.supabase.co";

// Sessões geradas pelo auth.setup da suíte E2E (contas sintéticas do staging).
// Se estiverem velhas: `bunx playwright test e2e/tests/site-publico.spec.ts`
// renova, ou `node scripts/seed-staging-contas.mjs` se alguma conta não logar.
const AUTH = {
  interno: path.join(REPO, "e2e/.auth/interno.json"),
  parceiro: path.join(REPO, "e2e/.auth/parceiro.json"),
  admin: path.join(REPO, "e2e/.auth/admin.json"),
};

function envLocal(nome) {
  const linhas = fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n");
  for (const l of linhas) {
    const m = l.match(new RegExp(`^${nome}=(.*)$`));
    if (m) return m[1].replace(/^"|"$/g, "").trim();
  }
  return null;
}

/** Client service-role do STAGING (nunca produção — filme é sempre no staging). */
function adminStaging() {
  const srk = envLocal("STAGING_SERVICE_ROLE_KEY");
  if (!srk) throw new Error("STAGING_SERVICE_ROLE_KEY nao encontrada no .env.local");
  return createClient(SB_URL, srk, { auth: { persistSession: false } });
}

function cpfValido() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base) => {
    const soma = base.reduce((acc, dig, i) => acc + dig * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

/** Pausa de leitura — o espectador precisa de tempo pra LER a tela. */
const ler = (page, ms = 2000) => page.waitForTimeout(ms);

/** Desliza o cursor até o elemento (steps) — sem isso o clique "teleporta". */
async function deslizar(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
    await page.waitForTimeout(300);
  }
}

async function clicar(page, locator) {
  await deslizar(page, locator);
  await locator.click();
}

/** Cena opcional: se falhar, o filme continua (loga e segue). */
async function tentar(rotulo, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`(cena opcional pulada: ${rotulo} — ${e.message?.slice(0, 90)})`);
  }
}

// Mesmo overlay de e2e/cursor.ts, em CJS (o vídeo não desenha cursor nativo).
async function cursorVisivel(page) {
  await page.addInitScript(() => {
    const montar = () => {
      if (document.getElementById("__pw_cursor")) return;
      const css = document.createElement("style");
      css.textContent = `
        #__pw_cursor{position:fixed;z-index:2147483647;width:22px;height:22px;
          margin:-11px 0 0 -11px;pointer-events:none;left:-100px;top:-100px;
          transition:left .06s linear,top .06s linear}
        #__pw_cursor::before{content:"";position:absolute;inset:0;border-radius:50%;
          background:rgba(220,38,38,.35);border:2px solid #dc2626;box-sizing:border-box}
        .__pw_pulse{position:fixed;z-index:2147483646;width:14px;height:14px;
          margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #dc2626;
          pointer-events:none;animation:__pw_p .5s ease-out forwards}
        @keyframes __pw_p{from{transform:scale(1);opacity:.9}
          to{transform:scale(4.5);opacity:0}}`;
      document.head.appendChild(css);
      const dot = document.createElement("div");
      dot.id = "__pw_cursor";
      document.body.appendChild(dot);
      addEventListener("mousemove", (e) => {
        dot.style.left = e.clientX + "px";
        dot.style.top = e.clientY + "px";
      }, true);
      addEventListener("mousedown", (e) => {
        const p = document.createElement("div");
        p.className = "__pw_pulse";
        p.style.left = e.clientX + "px";
        p.style.top = e.clientY + "px";
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 520);
      }, true);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", montar);
    } else montar();
  });
}

/**
 * Estúdio de filmagem: um context (= um clipe de vídeo) por ato, still de
 * conferência por cena, e no encerrar() os clipes são renomeados ato1..N na
 * ordem de gravação. slowMo 350 dá o ritmo de mão humana.
 */
async function abrirEstudio(nomeRoteiro) {
  const saida = path.join(__dirname, "saida", nomeRoteiro);
  const videoDir = path.join(saida, "video");
  const stillDir = path.join(saida, "stills");
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(stillDir, { recursive: true });

  const browser = await chromium.launch({ slowMo: 350 });
  const contexts = [];

  return {
    saida,
    videoDir,
    still: (page, nome) =>
      page.screenshot({ path: path.join(stillDir, `${nome}.png`) }).catch(() => {}),
    /** papel: "interno" | "parceiro" | "admin" (ou caminho de storageState). */
    async novaParte(papel) {
      const ctx = await browser.newContext({
        storageState: AUTH[papel] ?? papel,
        viewport: { width: 1280, height: 800 },
        recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
      });
      const page = await ctx.newPage();
      await cursorVisivel(page);
      contexts.push(ctx);
      return { page, fechar: () => ctx.close() };
    },
    async encerrar() {
      for (const ctx of contexts) {
        try { await ctx.close(); } catch { /* já fechado */ }
      }
      await browser.close();
      const clipes = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"))
        .map((f) => ({ f, t: fs.statSync(path.join(videoDir, f)).birthtimeMs }))
        .sort((a, b) => a.t - b.t);
      clipes.forEach((v, i) => {
        fs.renameSync(path.join(videoDir, v.f), path.join(videoDir, `ato${i + 1}.webm`));
      });
      return clipes.map((_, i) => path.join(videoDir, `ato${i + 1}.webm`));
    },
  };
}

module.exports = {
  BASE,
  adminStaging,
  cpfValido,
  ler,
  deslizar,
  clicar,
  tentar,
  cursorVisivel,
  abrirEstudio,
};
