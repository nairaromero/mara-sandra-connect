// Junta os clipes de um filme de e2e/demo em UM vídeo, com a legenda na linha
// do tempo certa. Antes disto, cada roteiro deixava `ato1.webm`, `ato2.webm`…
// e a montagem era feita à mão — que é onde a ordem se perde.
//
//   node e2e/demo/montar-filme.cjs <pasta em e2e/demo/saida> [nome-base] [--legendado]
//
// Produz, dentro da pasta:
//   <nome>.mp4            vídeo único, clipes na ordem ato1..atoN
//   <nome>.srt            legenda (via gerar-srt.cjs, que usa as durações reais)
//   <nome>-legendado.mp4  com a legenda queimada (só com --legendado)
//
// ffmpeg: usa o do PATH, ou o caminho em FFMPEG_PATH.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const [, , PASTA, NOME = "filme", ...resto] = process.argv;
if (!PASTA) {
  console.error("uso: node e2e/demo/montar-filme.cjs <pasta> [nome-base] [--legendado]");
  process.exit(1);
}
const QUEIMAR = resto.includes("--legendado");
const FF = process.env.FFMPEG_PATH || "ffmpeg";
const SAIDA = path.resolve(__dirname, "saida", PASTA);
const VIDEO = path.join(SAIDA, "video");
if (!fs.existsSync(VIDEO)) { console.error(`sem clipes em ${VIDEO}`); process.exit(1); }

// ordem numérica de verdade: ato10 vem depois de ato9, não entre ato1 e ato2
const clipes = fs.readdirSync(VIDEO)
  .filter((f) => /^ato\d+\.webm$/.test(f))
  .sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
if (!clipes.length) { console.error("nenhum ato*.webm na pasta"); process.exit(1); }
console.log(`clipes (nesta ordem): ${clipes.join(" · ")}`);

const lista = path.join(SAIDA, "clipes.txt");
fs.writeFileSync(lista, clipes.map((c) => `file '${path.join(VIDEO, c).replace(/'/g, "'\\''")}'`).join("\n"));

const mp4 = path.join(SAIDA, `${NOME}.mp4`);
console.log("montando o vídeo único…");
execSync(`"${FF}" -y -f concat -safe 0 -i "${lista}" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 25 -movflags +faststart "${mp4}"`,
  { stdio: ["ignore", "ignore", "pipe"] });

// legenda: o gerador já coloca cada fala no instante certo do vídeo concatenado
if (fs.existsSync(path.join(SAIDA, "legendas.json"))) {
  console.log("gerando a legenda…");
  execSync(`node "${path.join(__dirname, "gerar-srt.cjs")}" "${PASTA}" "${FF}" "${NOME}"`, { stdio: "inherit" });
}

const srt = path.join(SAIDA, `${NOME}.srt`);
if (QUEIMAR && fs.existsSync(srt)) {
  console.log("queimando a legenda numa segunda cópia…");
  const estilo = "FontName=Helvetica,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=28";
  execSync(`"${FF}" -y -i "${mp4}" -vf "subtitles='${srt.replace(/'/g, "'\\''")}':force_style='${estilo}'" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart "${path.join(SAIDA, `${NOME}-legendado.mp4`)}"`,
    { stdio: ["ignore", "ignore", "pipe"] });
}

fs.unlinkSync(lista);
const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(1) + " MB";
console.log(`\npronto:\n  ${mp4} (${mb(mp4)})`);
if (fs.existsSync(srt)) console.log(`  ${srt}`);
const leg = path.join(SAIDA, `${NOME}-legendado.mp4`);
if (fs.existsSync(leg)) console.log(`  ${leg} (${mb(leg)})`);
