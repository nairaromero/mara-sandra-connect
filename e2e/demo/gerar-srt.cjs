// Gera o .srt (e a narração com minutagem) de um filme gravado pelos roteiros
// de e2e/demo: lê legendas.json (instante de cada fala, relativo ao clipe) e
// as durações reais dos clipes (ffmpeg) e coloca tudo na linha do tempo do MP4
// concatenado (ato1..N, na ordem). Uso:
//   node e2e/demo/gerar-srt.cjs <pasta em e2e/demo/saida> <caminho do ffmpeg> [nome-base]
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const [, , PASTA, FF, NOME = "filme"] = process.argv;
const SAIDA = path.resolve(__dirname, "saida", PASTA);
const { legendas } = JSON.parse(fs.readFileSync(path.join(SAIDA, "legendas.json"), "utf8"));
const clipes = fs.readdirSync(path.join(SAIDA, "video")).filter((f) => /^ato\d+\.webm$/.test(f)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
const dur = clipes.map((c) => {
  const out = execSync(`"${FF}" -i "${path.join(SAIDA, "video", c)}" 2>&1 || true`, { encoding: "utf8" });
  const m = out.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 : 0;
});
const offset = []; let acc = 0;
for (const d of dur) { offset.push(acc); acc += d; }
const ts = (ms) => { const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = Math.floor(ms % 1000); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(x).padStart(3, "0")}`; };
const quebrar = (t) => { if (t.length <= 64) return t; const p = t.lastIndexOf(" ", Math.ceil(t.length / 2) + 12); return p > 0 ? `${t.slice(0, p)}\n${t.slice(p + 1)}` : t; };
const abs = legendas.map((l, i) => {
  const inicio = offset[l.clipe] + l.inicio_ms;
  const palavras = l.texto.split(/\s+/).length;
  const desejado = Math.max(l.dur_ms, 380 * palavras + 800);
  const proximo = legendas.slice(i + 1).find((n) => n.clipe === l.clipe);
  const limite = proximo ? offset[l.clipe] + proximo.inicio_ms - 150 : offset[l.clipe] + dur[l.clipe];
  return { inicio, fim: Math.max(inicio + 1200, Math.min(inicio + desejado, limite)), texto: l.texto };
}).sort((a, b) => a.inicio - b.inicio);
fs.writeFileSync(path.join(SAIDA, `${NOME}.srt`), abs.map((l, i) => `${i + 1}\n${ts(l.inicio)} --> ${ts(l.fim)}\n${quebrar(l.texto)}\n`).join("\n"));
fs.writeFileSync(path.join(SAIDA, `${NOME}-narracao.txt`), abs.map((l) => `[${ts(l.inicio).slice(0, 8)}] ${l.texto}`).join("\n") + "\n");
console.log(`${NOME}.srt: ${abs.length} falas | ${clipes.length} clipe(s) | total ${ts(acc)}`);
