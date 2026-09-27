// Confere o espelho do front (`src/lib/rbac/exigencias.ts`) contra o que o BANCO
// realmente exige. É a resposta automática para "ainda falta alguma?" — a
// pergunta que a auditoria de 24/09 teve de responder à mão
// (planning/RBAC_AUDITORIA_TELAS.md).
//
// Compara três listas:
//   1. policies `perm_*` de escrita  → tabela, operação, permissão e ESCOPO cobrado;
//   2. RPCs do schema `public` que chamam `private.tem_permissao`;
//   3. edge functions com `permissao:` no `exigirUsuario` (lidas do código).
//
// E confere uma quarta coisa, do mesmo espírito: quem MUDA ACESSO tem de
// AUDITAR (planning/AUDITABILIDADE.md). A lista `DEVEM_AUDITAR` abaixo é a
// régua; se alguém reescrever uma dessas funções e perder o `private.auditar`
// no caminho, isto acusa — foi assim que a troca de papel ficou sem rastro por
// uma semana inteira.
//
// Sai 0 quando bate, 1 quando diverge (e diz exatamente o que sobra ou falta).
//
//   node scripts/rbac-conferir-exigencias.mjs --local
//   node scripts/rbac-conferir-exigencias.mjs --staging
//   node scripts/rbac-conferir-exigencias.mjs               # produção
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = process.argv.find((a) => a === "--local" || a === "--staging");
const alvo = flag ?? "(produção)";

function sql(q) {
  const args = ["scripts/msc-sql.mjs", ...(flag ? [flag] : []), q];
  const out = execFileSync("node", args, { encoding: "utf8" });
  const txt = out.split("\n").filter((l) => !l.startsWith("[msc-sql]")).join("\n").trim();
  return txt ? JSON.parse(txt) : [];
}

// ---------- o que o banco exige ----------
const policies = sql(`
  select tablename as tabela, lower(cmd) as cmd,
         coalesce(qual, with_check) as regra
    from pg_policies
   where schemaname = 'public' and policyname like 'perm\\_%'
     and cmd in ('INSERT','UPDATE','DELETE')
   order by 1, 2`);

// Lê a regra INTEIRA. Ela tem duas formas:
//   tem_permissao('x:y', NULL)                                  -> qualquer escopo
//   tem_permissao('x:y','todos') OR (tem_permissao('x:y','atribuidos') AND col = auth.uid())
// Ler só o primeiro `tem_permissao(...)` (como este script fazia) faz a segunda
// parecer "exige escopo todos" — foi assim que o espelho nasceu errado em 24/09.
// O segundo argumento é OPCIONAL: `tem_permissao('x:y')` (a forma da
// migration_rbac_18 e da 27) renderiza sem ele, e a regex antiga exigia a
// vírgula — então essas policies eram PULADAS em silêncio, e "não conferido"
// ficava com a cara de "conferido". Pego em 27/09.
function lerRegra(regra) {
  const perms = [...regra.matchAll(/tem_permissao\('([a-z_:]+)'::text(?:, *(?:'([a-z]+)'::text|NULL))?/g)]
    .map((m) => ({ permissao: m[1], escopo: m[2] ?? null }));
  if (perms.length === 0) return null;
  const permissao = perms[0].permissao;
  const restrito = perms.find((p) => p.escopo && p.escopo !== "todos");
  if (!restrito) return { permissao, proprio: null };
  const col = regra.match(/\(([a-z_]+) = \( SELECT auth\.uid\(\)/);
  return { permissao, proprio: { escopo: restrito.escopo, coluna: col ? col[1] : "?" } };
}

// `substring` e não `regexp_matches(..., 'g')`: a função de conjunto quebra o
// caminho do msc-sql local (que agrega o resultado).
const rpcs = sql(`
  select p.proname as nome,
         substring(pg_get_functiondef(p.oid) from 'tem_permissao\\(''([a-z_:]+)''') as permissao
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     -- prokind = 'f': pg_get_functiondef recusa agregados (o banco local
     -- tem um array_agg no public e a consulta morria só lá).
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%tem_permissao%'
   order by 1`);

// ---------- o que o front declara ----------
const arq = fs.readFileSync(path.resolve("src/lib/rbac/exigencias.ts"), "utf8");
const bloco = (nome) => {
  const i = arq.indexOf(`export const ${nome}`);
  if (i < 0) return "";
  const fim = arq.indexOf("\n};", i);
  return arq.slice(i, fim);
};
const OP = { insert: "inserir", update: "atualizar", delete: "excluir" };

/** Corpo `{ … }` de uma chave do bloco, contando chaves (a entrada pode ter várias linhas). */
function corpoDaChave(txt, chave) {
  const i = txt.indexOf(`\n  ${chave}: {`);
  if (i < 0) return null;
  let j = txt.indexOf("{", i);
  let nivel = 0;
  for (let k = j; k < txt.length; k++) {
    if (txt[k] === "{") nivel++;
    else if (txt[k] === "}") { nivel--; if (nivel === 0) return txt.slice(j + 1, k); }
  }
  return null;
}

function lerEntrada(txt) {
  const perm = txt.match(/permissao: "([a-z_:]+)"/);
  if (!perm) return null;
  const pr = txt.match(/proprio: \{ escopo: "([a-z]+)", coluna: "([a-z_]+)" \}/);
  return { permissao: perm[1], proprio: pr ? { escopo: pr[1], coluna: pr[2] } : null };
}
function frontEscrita(tabela, op) {
  const corpo = corpoDaChave(bloco("ESCRITA"), tabela);
  if (!corpo) return null;
  const porOp = corpo.match(new RegExp(`${OP[op]}: \\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}`));
  const todas = corpo.match(/todas: \{[^}]*(?:\{[^}]*\}[^}]*)*\}/);
  const trecho = porOp?.[0] ?? todas?.[0];
  return trecho ? lerEntrada(trecho) : null;
}
function frontMapa(nome) {
  const txt = bloco(nome);
  const out = {};
  for (const m of txt.matchAll(/"?([a-z_:-]+)"?: \{ permissao: "([a-z_:]+)"(?:, escopo: "([a-z]+)")? \}/g)) {
    out[m[1]] = { permissao: m[2], escopo: m[3] ?? null };
  }
  return out;
}

// ---------- comparação ----------
const problemas = [];
let puladas = 0;
for (const p of policies) {
  const banco = lerRegra(p.regra);
  if (!banco) {
    // Nunca em silêncio: policy `perm_*` que este script não consegue LER é
    // policy não conferida, e foi assim que a forma de um argumento passou
    // batida. Some do número e aparece na saída.
    puladas++;
    problemas.push(`NÃO CONSEGUI LER: policy perm_* de ${p.tabela}.${p.cmd} — regra: ${p.regra.slice(0, 80)}`);
    continue;
  }
  const f = frontEscrita(p.tabela, p.cmd);
  if (!f) { problemas.push(`FALTA no front: ${p.tabela}.${p.cmd} exige ${banco.permissao}`); continue; }
  if (f.permissao !== banco.permissao) {
    problemas.push(`PERMISSÃO DIFERENTE: ${p.tabela}.${p.cmd} — banco ${banco.permissao}, front ${f.permissao}`);
  }
  const b = banco.proprio ? `${banco.proprio.escopo}/${banco.proprio.coluna}` : "não";
  const t = f.proprio ? `${f.proprio.escopo}/${f.proprio.coluna}` : "não";
  if (b !== t) {
    problemas.push(`ESCOPO DIFERENTE: ${p.tabela}.${p.cmd} — banco aceita próprio: ${b}, front: ${t}`);
  }
}
const rpcFront = frontMapa("RPC");
const rpcBanco = {};
for (const r of rpcs) {
  // Fora: o próprio helper e quem chama `tem_permissao` com permissão variável
  // (aí não há uma exigência fixa para a tela espelhar).
  if (!r.permissao || r.nome === "tem_permissao") continue;
  rpcBanco[r.nome] = r.permissao;
}
for (const [nome, perm] of Object.entries(rpcBanco)) {
  if (!rpcFront[nome]) problemas.push(`FALTA no front: RPC ${nome} exige ${perm}`);
  else if (rpcFront[nome].permissao !== perm) problemas.push(`PERMISSÃO DIFERENTE: RPC ${nome} — banco ${perm}, front ${rpcFront[nome].permissao}`);
}
for (const nome of Object.keys(rpcFront)) {
  if (!rpcBanco[nome]) problemas.push(`SOBRA no front: RPC ${nome} não exige permissão no banco`);
}

// edge functions: a verdade está no código delas
const fnFront = frontMapa("FUNCTION");
const dirFn = path.resolve("supabase/functions");
for (const d of fs.readdirSync(dirFn)) {
  const idx = path.join(dirFn, d, "index.ts");
  if (!fs.existsSync(idx)) continue;
  // `exigirUsuario` e `exigirUsuarioOuSistema` (esta com o nome do job no meio)
  const m = fs.readFileSync(idx, "utf8").match(/exigirUsuario(?:OuSistema)?\(req,[^)]*permissao: "([a-z_:]+)"/);
  if (m && !fnFront[d]) problemas.push(`FALTA no front: function ${d} exige ${m[1]}`);
  else if (m && fnFront[d].permissao !== m[1]) problemas.push(`PERMISSÃO DIFERENTE: function ${d} — código ${m[1]}, front ${fnFront[d].permissao}`);
  else if (!m && fnFront[d]) problemas.push(`SOBRA no front: function ${d} não exige permissão`);
}

// ---------- quarta lista: quem muda acesso tem de auditar ----------
// Cada entrada é uma função de `public` que, se existir no banco-alvo, precisa
// chamar `private.auditar`. Entrada nova aqui = conserto de gap no
// planning/AUDITABILIDADE.md. `definir_admin` fica de fora de propósito:
// delega para `definir_papel`, então auditar uma cobre a outra.
const DEVEM_AUDITAR = [
  // acesso de gente (migration_rbac_20 e 25)
  "definir_papel", "definir_permissao_do_membro", "resetar_permissoes_do_membro",
  "desligar_interno", "reativar_interno", "desligar_parceiro", "reativar_parceiro",
  // destruição de dado do cliente (migration_rbac_25)
  "excluir_cliente",
  // escritório, plataforma e suporte (migration_rbac_05 e 07)
  "escritorio_definir_marca", "qg_criar_escritorio", "qg_atualizar_escritorio",
  "qg_suspender_escritorio", "qg_reativar_escritorio", "qg_encerrar_escritorio",
  "qg_pedir_eliminacao", "qg_aprovar_eliminacao", "qg_trocar_titular",
  "qg_definir_staff", "qg_desativar_membro", "qg_vincular_primeiro_admin",
  "qg_suporte_solicitar", "qg_suporte_encerrar", "suporte_responder", "suporte_encerrar",
];
const auditam = sql(`
  select p.proname as nome,
         (position('private.auditar' in pg_get_functiondef(p.oid)) > 0) as audita
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname = any(array[${DEVEM_AUDITAR.map((f) => `'${f}'`).join(",")}])
   order by 1`);
const mapaAudita = Object.fromEntries(auditam.map((r) => [r.nome, r.audita === true || r.audita === "true"]));
let conferidasAudita = 0;
for (const f of DEVEM_AUDITAR) {
  if (!(f in mapaAudita)) continue; // não existe neste banco (migration ainda não aplicada)
  conferidasAudita++;
  if (!mapaAudita[f]) problemas.push(`NÃO AUDITA: ${f} muda acesso/apaga dado e não chama private.auditar`);
}

// ---------- o ponto cego: escrita fora do modelo de permissão ----------
// O espelho só compara tabelas que JÁ têm policy `perm_*` de escrita. Tabela
// cuja escrita ficou na policy antiga (`is_interno()`) é invisível para ele — foi
// assim que `analises_tecnicas` deixou o financeiro gravar análise técnica até
// 27/09, quando a spec `rbac-matriz-por-papel` pegou.
//
// Aqui a pergunta é outra: existe tabela com escrita permitida a `authenticated`
// SEM nenhuma policy restritiva que cobre permissão? Se existir e não estiver na
// lista abaixo, é candidata a furo.
const ESCRITA_SEM_PERMISSAO_OK = {
  comentarios: "colaboração comum; o delete já é do autor ou admin (rbac_16)",
  conversa_leitura: "marcador de leitura por pessoa",
  notificacao_dispensada: "marcador por pessoa",
  notificacoes: "criadas pelo sistema; delete só da própria (rbac_16)",
  mensagens: "conversa do caso; entrada pelo sistema",
  usuarios: "privilégios guardados por gatilho (migration_usuarios_guard_privilegios)",
  webhook_config: "admin por papel, módulo 'Em breve' (rbac_18)",
  webhook_destinos: "idem; escrita revogada de authenticated",
  repasses: "não existe permissão de escrita no modelo (só repasses:ler) — decisão de produto pendente",
  contratos_parceria: "nenhum código escreve nela hoje — decisão pendente",
};
const semTrava = sql(`
  with alvo as (
    select c.oid, c.relname::text as tabela
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive
                     and p.polcmd::text in ('a','w','d','*'))
  ),
  restritiva as (
    select p.polrelid,
           bool_or(coalesce(pg_get_expr(p.polwithcheck, p.polrelid),
                            pg_get_expr(p.polqual, p.polrelid)) like '%tem_permissao%') as com_permissao
      from pg_policy p
     where not p.polpermissive and p.polcmd::text in ('a','w','d','*')
     group by 1
  )
  select a.tabela from alvo a
    left join restritiva r on r.polrelid = a.oid
   where coalesce(r.com_permissao, false) = false
   order by 1`);
for (const { tabela } of semTrava) {
  if (!(tabela in ESCRITA_SEM_PERMISSAO_OK)) {
    problemas.push(`ESCRITA SEM PERMISSÃO: ${tabela} aceita escrita de authenticated sem policy restritiva de permissão`);
  }
}
for (const t of Object.keys(ESCRITA_SEM_PERMISSAO_OK)) {
  if (!semTrava.some((x) => x.tabela === t) && sql(`select 1 as x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${t}'`).length) {
    problemas.push(`SOBRA na lista: ${t} já tem trava de permissão na escrita — tire da lista ESCRITA_SEM_PERMISSAO_OK`);
  }
}

// edge functions que mudam acesso ou identidade e têm de auditar elas mesmas
// (o banco não as vê: a trilha é um insert em `auditoria` no código delas).
const FN_DEVEM_AUDITAR = {
  "integracoes-escritorio": "integracao.salvar / integracao.testar",
  "update-parceiro": "parceiro.email_alterado",
  "excluir-parceiro": "parceiro.excluido",
  "convidar-usuario": "equipe.convidado / parceiro.convidado",
};
let conferidasFnAudita = 0;
for (const [fn, acoes] of Object.entries(FN_DEVEM_AUDITAR)) {
  const idx = path.join(dirFn, fn, "index.ts");
  if (!fs.existsSync(idx)) continue;
  conferidasFnAudita++;
  const src = fs.readFileSync(idx, "utf8");
  // Pelo TÚNEL: `_shared/auditoria.ts`. Insert à mão não conta (regra abaixo).
  if (!/from ["']\.\.\/_shared\/auditoria\.ts["']/.test(src) || !/\bauditar\(/.test(src)) {
    problemas.push(`NÃO AUDITA: function ${fn} devia registrar ${acoes} pelo túnel _shared/auditoria.ts`);
  }
}

// Fonte única: só o túnel escreve na `auditoria`. Quatro functions montavam o
// insert à mão até 27/09, cada uma repetindo `tipo_ator` e o tratamento de erro
// — e uma engolia a falha. Quem voltar a escrever direto aparece aqui.
const TUNEL_AUDITORIA = "_shared/auditoria.ts";
for (const d of fs.readdirSync(dirFn)) {
  const idx = path.join(dirFn, d, "index.ts");
  if (!fs.existsSync(idx)) continue;
  const src = fs.readFileSync(idx, "utf8");
  if (/from\(["']auditoria["']\)\s*\n?\s*\.insert/.test(src)) {
    problemas.push(`FORA DO TÚNEL: function ${d} escreve na auditoria direto — use auditar() de ${TUNEL_AUDITORIA}`);
  }
}

// trilhas de exclusão que têm de existir com o gatilho ligado (migration_rbac_26)
const TRILHAS = [["documentos", "documentos_excluidos"], ["andamentos", "andamentos_excluidos"]];
const gatilhos = sql(`
  select c.relname as tabela, t.tgname as gatilho
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and t.tgname = 'zz_trilha_exclusao'
     and c.relname = any(array[${TRILHAS.map(([t]) => `'${t}'`).join(",")}])`);
const comGatilho = new Set(gatilhos.map((g) => g.tabela));
const tabelas = sql(`
  select table_name as t from information_schema.tables
   where table_schema = 'public'
     and table_name = any(array[${TRILHAS.map(([, x]) => `'${x}'`).join(",")}])`);
const temTabela = new Set(tabelas.map((r) => r.t));
for (const [origem, trilha] of TRILHAS) {
  if (!temTabela.has(trilha)) continue; // migration_rbac_26 ainda não aplicada aqui
  if (!comGatilho.has(origem)) problemas.push(`SEM GATILHO: ${origem} apaga sem registrar em ${trilha}`);
}

console.log(`espelho x banco — alvo: ${alvo}`);
console.log(`  policies de escrita conferidas: ${policies.length - puladas}${puladas ? ` (${puladas} ILEGÍVEIS)` : ""}`);
console.log(`  RPCs com permissão: ${Object.keys(rpcBanco).length}`);
console.log(`  functions com permissão: ${Object.keys(fnFront).length}`);
console.log(`  funções que devem auditar: ${conferidasAudita} no banco + ${conferidasFnAudita} edge`);
console.log(`  tabelas com escrita fora do modelo de permissão: ${semTrava.length} (${Object.keys(ESCRITA_SEM_PERMISSAO_OK).length} previstas)`);
console.log(`  trilha das edge: só pelo túnel ${TUNEL_AUDITORIA}`);
if (problemas.length === 0) {
  console.log("\nOK: o espelho do front bate com o servidor, e quem muda acesso audita.");
  process.exit(0);
}
console.log(`\n${problemas.length} divergência(s):`);
for (const p of problemas) console.log(`  - ${p}`);
process.exit(1);
