// Contrato a partir de modelo do ZapSign: as regras dos campos (padrão e faixa
// lidos do texto de ajuda, extenso escrito pelo sistema) e a prévia lida do
// DOCX. Tudo mora em `_shared/modelo-contrato.ts`; a régua no fim confere que
// a tela e a function usam essa conta em vez de refazê-la.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  beneficioNaFrase, camposDoModelo, cpfComPontos, enderecoDe, extensoDoValor, faixaDoCampo, partesDoEndereco, normalizarValor, numeroPorExtenso, paragrafosDoDocx, partesDoCadastro, previaDoContrato, qualificacaoDe, regrasDaAjuda, respostasDoModelo,
} from "../../supabase/functions/_shared/modelo-contrato";

const RAIZ = join(import.meta.dir, "../..");
const i = (variable: string, label: string, help_text = "", required = true) => ({ variable: `{{${variable}}}`, label, help_text, required });
const CAMPOS = camposDoModelo(
  [
    i("NOME_ASSINANTE", "Nome de quem assina"),
    i("PERCENTUAL_ATRASADOS", "Honorários sobre os atrasados (%)", "Padrão: 35% · Máximo: 50%"),
    i("PERCENTUAL_ATRASADOS_EXTENSO", "Honorários por extenso", "O sistema escreve."),
    i("QTD_PRESTACOES", "Quantidade de prestações", "Padrão: 5 ; Mínimo: 1"),
    i("QTD_PRESTACOES_EXTENSO", "Prestações por extenso"),
    i("TEXTO_PARCEIRO", "Parceiro indicador", "Nome do parceiro, ou \"não há\".", false),
    i("VALOR_EXTENSO", "Valor por extenso (sem campo base)"),
  ].map((x, n) => ({ ...x, order: n })),
  { cliente: { nome: "Helena Bastos" } },
);
const campo = (v: string) => CAMPOS.find((c) => c.variavel === `{{${v}}}`)!;

describe("número por extenso", () => {
  test("inteiros, com 'cem', dezenas compostas e milhar", () => {
    expect([0, 5, 16, 21, 30, 35, 100, 101, 250, 999].map(numeroPorExtenso)).toEqual([
      "zero", "cinco", "dezesseis", "vinte e um", "trinta", "trinta e cinco", "cem", "cento e um", "duzentos e cinquenta", "novecentos e noventa e nove",
    ]);
    expect([1000, 1200, 1005, 1250, 2000].map(numeroPorExtenso)).toEqual(["mil", "mil e duzentos", "mil e cinco", "mil duzentos e cinquenta", "dois mil"]);
    expect([1_000_000, -1, 1.5].map(numeroPorExtenso)).toEqual(["", "", ""]);
  });
  test("percentual e quantidade; o que não é número fica sem extenso", () => {
    expect(extensoDoValor("35%")).toBe("trinta e cinco por cento");
    expect(extensoDoValor("32,5%")).toBe("trinta e dois vírgula cinco por cento");
    expect(extensoDoValor("32,05%")).toBe("trinta e dois vírgula zero cinco por cento");
    expect(extensoDoValor("4")).toBe("quatro");
    expect([extensoDoValor("trinta"), extensoDoValor("R$ 1.500,00"), extensoDoValor("")]).toEqual(["", "", ""]);
  });
});

describe("o que o texto de ajuda do campo diz ao sistema", () => {
  test("padrão, mínimo e máximo saem da ajuda; o resto continua sendo ajuda", () => {
    expect(regrasDaAjuda("Padrão: 35% · Máximo: 50%")).toEqual({ padrao: "35%", minimo: null, maximo: 50, sistema: "", texto: "" });
    expect(regrasDaAjuda("Combine com o cliente; PADRAO: 5; mínimo: 1")).toEqual({ padrao: "5", minimo: 1, maximo: null, sistema: "", texto: "Combine com o cliente" });
    expect(regrasDaAjuda("Como está no documento")).toEqual({ padrao: "", minimo: null, maximo: null, sistema: "", texto: "Como está no documento" });
    // ajuda sem regra nenhuma fica como o modelo escreveu, com o ";" que tiver
    expect(regrasDaAjuda(" Ex.: à vista; em 3 parcelas ").texto).toBe("Ex.: à vista; em 3 parcelas");
    expect([faixaDoCampo({ tipo: "percentual", minimo: 2.5, maximo: 50 }), faixaDoCampo({ tipo: "inteiro", minimo: 1, maximo: null }), faixaDoCampo({ tipo: "texto", minimo: null, maximo: null })]).toEqual(["mínimo 2,5%, máximo 50%", "mínimo 1", ""]);
    expect(regrasDaAjuda("Sistema: Benefício")).toEqual({ padrao: "", minimo: null, maximo: null, sistema: "beneficio", texto: "" });
    // separador variado: "·" é difícil de digitar — o padrão e o máximo saem
    // mesmo com espaço, sem acento ou com a ordem trocada (achado da revisão)
    expect(regrasDaAjuda("Padrão: 35% Máximo: 50%")).toMatchObject({ padrao: "35%", maximo: 50 });
    expect(regrasDaAjuda("padrao: 35% maximo: 50%")).toMatchObject({ padrao: "35%", maximo: 50 });
    expect(regrasDaAjuda("Máximo: 50% · Padrão: 35%")).toMatchObject({ padrao: "35%", maximo: 50 });
  });
  test("o padrão já vem preenchido, o cadastro tem prioridade e o extenso é do sistema", () => {
    expect([campo("PERCENTUAL_ATRASADOS").tipo, campo("PERCENTUAL_ATRASADOS").sugestao, campo("PERCENTUAL_ATRASADOS").maximo]).toEqual(["percentual", "35%", 50]);
    expect([campo("QTD_PRESTACOES").tipo, campo("QTD_PRESTACOES").sugestao, campo("QTD_PRESTACOES").minimo]).toEqual(["inteiro", "5", 1]);
    expect([campo("NOME_ASSINANTE").sugestao, campo("NOME_ASSINANTE").origem]).toEqual(["Helena Bastos", "cadastro"]);
    // de onde veio o valor é dito aqui, uma vez: a tela só mostra
    expect([campo("PERCENTUAL_ATRASADOS").origem, campo("TEXTO_PARCEIRO").origem, campo("PERCENTUAL_ATRASADOS_EXTENSO").origem]).toEqual(["modelo", "caso", ""]);
    expect(campo("PERCENTUAL_ATRASADOS_EXTENSO").extensoDe).toBe("{{PERCENTUAL_ATRASADOS}}");
    expect(campo("TEXTO_PARCEIRO").ajuda).toBe('Nome do parceiro, ou "não há".');
    // "_EXTENSO" sem o campo base no modelo é um campo comum: a pessoa preenche
    expect(campo("VALOR_EXTENSO").extensoDe).toBeNull();
  });
  test("o valor digitado vira o que o contrato escreve", () => {
    expect(["30", "30%", " 30 % ", "30,50", "30.5"].map((v) => normalizarValor("percentual", v))).toEqual(["30%", "30%", "30%", "30,5%", "30,5%"]);
    expect(["04", "4"].map((v) => normalizarValor("inteiro", v))).toEqual(["4", "4"]);
    expect(normalizarValor("texto", "  30  ")).toBe("30");
  });
});

describe("o que o sistema monta sem ninguém digitar", () => {
  const ctx = { beneficios: ["Aposentadoria por idade", "BPC/LOAS", "Pensão por morte", "Outro"], beneficioDoCaso: "Pensão por morte", cliente: { nome: "Helena Bastos", cpf: "52998224725", endereco: "Rua das Flores, 10, Centro, São Paulo/SP." } };
  const campos = (extra: Partial<typeof ctx> = {}) =>
    Object.fromEntries(
      camposDoModelo(
        [i("QUALIFICACAO_CONTRATANTE", "Qualificação do contratante"), i("OBJETO_SERVICO", "Objeto do serviço", "Sistema: benefício"), i("BENEFICIO_OBJETO", "Benefício ou serviço"), i("OBJETO_CIVEL", "Objeto do serviço"), i("BENEFICIO_LIVRE", "Benefício", "Sistema: nenhum"), i("QTD_PRESTACOES", "Quantidade de prestações do benefício", "Padrão: 5"), i("TEXTO_PARCEIRO", "Parceiro indicador", "", false), { ...i("FORMA", "Forma de pagamento"), options: "à vista; em 3 parcelas ;" }],
        { ...ctx, ...extra },
      ).map((c) => [c.variavel.replace(/[{}]/g, ""), c]),
    );
  test("o cadastro responde pelo nome do campo, sem confundir com outra pessoa; a data é a de hoje", () => {
    const c = Object.fromEntries(
      camposDoModelo(
        [i("CPF", "CPF"), i("CPF_MAE", "CPF da mãe"), i("NOME", "Nome completo"), i("NOME_ADV", "Nome do advogado"), i("NASC", "Data de nascimento"), i("DATA", "Data da assinatura"), i("FONE", "Celular"), i("FORO", "Foro")],
        { cliente: { nome: "Helena Bastos", cpf: "52998224725", telefone: "(17) 99999-0000", data_nascimento: "1960-03-07" }, hoje: "20 de novembro de 2026" },
      ).map((x) => [x.variavel.replace(/[{}]/g, ""), [x.sugestao, x.origem]]),
    );
    expect(c).toEqual({
      CPF: ["529.982.247-25", "cadastro"], CPF_MAE: ["", ""], NOME: ["Helena Bastos", "cadastro"], NOME_ADV: ["", ""],
      NASC: ["07/03/1960", "cadastro"], DATA: ["20 de novembro de 2026", "hoje"], FONE: ["(17) 99999-0000", "cadastro"], FORO: ["", ""],
    });
    expect([cpfComPontos("52998224725"), cpfComPontos("123")]).toEqual(["529.982.247-25", "123"]);
  });
  test("qualificação: frase com o que o cadastro tem; parte em branco não entra", () => {
    // a tela parte das MESMAS partes de que o servidor montou a frase
    expect(qualificacaoDe(partesDoCadastro(ctx.cliente))).toBe(campos().QUALIFICACAO_CONTRATANTE.sugestao);
    expect(campos().QUALIFICACAO_CONTRATANTE.sugestao).toBe("Helena Bastos, brasileiro(a), CPF n.º 529.982.247-25, residente e domiciliado(a) em Rua das Flores, nº 10, Centro, São Paulo/SP");
    expect(qualificacaoDe({ nome: "Helena", nacionalidade: "brasileiro(a)", estadoCivil: "viúvo(a)", profissao: "aposentado(a)", rg: "12.345.678-9", cpf: "529.982.247-25" })).toBe("Helena, brasileiro(a), viúvo(a), aposentado(a), RG n.º 12.345.678-9, CPF n.º 529.982.247-25");
    expect(qualificacaoDe({})).toBe("");
  });
  test("benefício: o do caso já escolhido, a lista do escritório como entra na frase, sem 'Outro'", () => {
    const c = campos();
    expect([c.OBJETO_SERVICO.especie, c.OBJETO_SERVICO.sugestao, c.OBJETO_SERVICO.copiaDe]).toEqual(["beneficio", "pensão por morte", null]);
    expect(c.OBJETO_SERVICO.opcoes).toEqual(["pensão por morte", "aposentadoria por idade", "BPC/LOAS"]);
    // o segundo campo de benefício do modelo não é perguntado: repete o primeiro
    expect([c.BENEFICIO_OBJETO.especie, c.BENEFICIO_OBJETO.copiaDe, c.BENEFICIO_OBJETO.opcoes]).toEqual(["beneficio", "{{OBJETO_SERVICO}}", []]);
    const lista = Object.values(c);
    const r = respostasDoModelo(lista, { "{{OBJETO_SERVICO}}": "auxílio-acidente", "{{BENEFICIO_OBJETO}}": "outra coisa" });
    expect(r.respostas.filter((x) => /OBJETO/.test(x.variavel) && !/CIVEL/.test(x.variavel)).map((x) => x.valor)).toEqual(["auxílio-acidente", "auxílio-acidente"]);
    expect(respostasDoModelo(lista, {}).erros[0], "o campo repetido não é cobrado duas vezes").not.toContain("Benefício ou serviço");
    expect([beneficioNaFrase("Aposentadoria da PCD (LC 142/2013)"), beneficioNaFrase("BPC/LOAS")]).toEqual(["aposentadoria da PCD (LC 142/2013)", "BPC/LOAS"]);
    // parceiro: o do caso; caso sem parceiro diz "não há"
    expect([campos({ parceiro: "Isabella Prado" } as never).TEXTO_PARCEIRO.sugestao, c.TEXTO_PARCEIRO.sugestao, c.TEXTO_PARCEIRO.especie]).toEqual(["Isabella Prado", "não há", "parceiro"]);
    // caso com tipo "Outro" (ou sem tipo): nada escolhido, a pessoa decide
    expect(campos({ beneficioDoCaso: "Outro" }).OBJETO_SERVICO.sugestao).toBe("");
  });
  test("o nome do campo sozinho não basta quando não fala de benefício; o modelo pode desligar; a lista do modelo vale", () => {
    const c = campos();
    expect([c.OBJETO_CIVEL.especie, c.OBJETO_CIVEL.opcoes]).toEqual([null, []]);
    expect([c.BENEFICIO_LIVRE.especie, c.BENEFICIO_LIVRE.opcoes]).toEqual([null, []]);
    expect(c.FORMA.opcoes).toEqual(["à vista", "em 3 parcelas"]);
    // "benefício" no meio do nome não transforma um número em lista de benefícios
    expect([c.QTD_PRESTACOES.especie, c.QTD_PRESTACOES.sugestao, c.QTD_PRESTACOES.tipo]).toEqual([null, "5", "inteiro"]);
  });

  test("campo de OUTRA pessoa não é preenchido com o cliente/caso (achado da revisão)", () => {
    const ctx = { cliente: { nome: "Helena Bastos", cpf: "52998224725", endereco: "Rua X, 1" }, beneficioDoCaso: "pensão por morte" };
    const campo = (variable: string, label = "") => camposDoModelo([{ variable, label, help_text: "", required: false, order: 0 }], ctx)[0];
    // pelo nome da variável (com "_") e pelo rótulo humano (com espaço)
    for (const c of [campo("{{QUALIFICACAO_DO_REPRESENTANTE}}"), campo("{{Q}}", "Qualificação do representante legal"), campo("{{BENEFICIO_DO_CONJUGE}}")]) {
      expect([c.especie, c.sugestao]).toEqual([null, ""]);
    }
    // mas o contratante e o benefício do próprio caso continuam sendo preenchidos
    expect(campo("{{QUALIFICACAO_CONTRATANTE}}").especie).toBe("qualificacao");
    expect(campo("{{BENEFICIO}}").sugestao).toBe("pensão por morte");
  });
});

describe("nome e CPF de quem assina: o cadastro manda (#540)", () => {
  // como os modelos de produção chegam: sem rótulo, o nome da variável faz as vezes dele
  const cru = (v: string, required = true) => ({ variable: `{{${v}}}`, label: "", help_text: "", required });
  const doModelo = (cliente: Record<string, string | null>) =>
    Object.fromEntries(
      camposDoModelo([cru("NOME_ASSINANTE"), cru("CPF_ASSINANTE"), cru("NOME_DA_MAE", false), cru("CPF_REPRESENTANTE", false), cru("E_MAIL", false), cru("DATA_ASSINATURA")], { cliente, hoje: "23 de novembro de 2026" })
        .map((c) => [c.variavel.replace(/[{}]/g, ""), c]),
    );
  test("campo sem rótulo ('NOME_ASSINANTE', 'CPF_ASSINANTE') é reconhecido e fica fixo no cadastro", () => {
    const c = doModelo({ nome: "Adauto Floripes", cpf: "16967646885", email: "a@b.com" });
    expect([c.NOME_ASSINANTE.sugestao, c.NOME_ASSINANTE.fixo, c.NOME_ASSINANTE.origem]).toEqual(["Adauto Floripes", true, "cadastro"]);
    expect([c.CPF_ASSINANTE.sugestao, c.CPF_ASSINANTE.fixo]).toEqual(["169.676.468-85", true]);
    // os outros campos do cadastro seguem preenchidos e editáveis; o de outra pessoa fica em branco
    expect([c.E_MAIL.sugestao, c.E_MAIL.fixo]).toEqual(["a@b.com", false]);
    expect([c.NOME_DA_MAE.sugestao, c.NOME_DA_MAE.fixo, c.CPF_REPRESENTANTE.sugestao]).toEqual(["", false, ""]);
    expect([c.DATA_ASSINATURA.sugestao, c.DATA_ASSINATURA.origem]).toEqual(["23 de novembro de 2026", "hoje"]);
  });
  test("sem CPF no cadastro o campo aparece para preencher — e só nesse caso", () => {
    const c = doModelo({ nome: "Adauto Floripes", cpf: null });
    expect([c.CPF_ASSINANTE.sugestao, c.CPF_ASSINANTE.fixo]).toEqual(["", false]);
    expect(c.NOME_ASSINANTE.fixo).toBe(true);
    expect(respostasDoModelo(Object.values(c), {}).erros[0]).toContain("CPF_ASSINANTE");
    expect(respostasDoModelo(Object.values(c), { "{{CPF_ASSINANTE}}": "169.676.468-85", "{{DATA_ASSINATURA}}": "x" }).erros).toEqual([]);
  });
  test("o servidor envia o cadastro no campo fixo, seja o que for que a tela mande", () => {
    const c = Object.values(doModelo({ nome: "Adauto Floripes", cpf: "16967646885" }));
    const r = respostasDoModelo(c, { "{{NOME_ASSINANTE}}": "Outra Pessoa", "{{CPF_ASSINANTE}}": "000.000.000-00" });
    const v = Object.fromEntries(r.respostas.map((x) => [x.variavel, x.valor]));
    expect([v["{{NOME_ASSINANTE}}"], v["{{CPF_ASSINANTE}}"]]).toEqual(["Adauto Floripes", "169.676.468-85"]);
  });
  test("o '_' do nome do campo também vale para a espécie: 'TEXTO_PARCEIRO' e 'QUALIFICACAO_CONTRATANTE'", () => {
    const c = Object.fromEntries(camposDoModelo([cru("TEXTO_PARCEIRO"), cru("QUALIFICACAO_CONTRATANTE"), cru("QUALIFICACAO_REPRESENTANTE", false)], { parceiro: "Andre" }).map((x) => [x.variavel.replace(/[{}]/g, ""), x.especie]));
    expect(c).toEqual({ TEXTO_PARCEIRO: "parceiro", QUALIFICACAO_CONTRATANTE: "qualificacao", QUALIFICACAO_REPRESENTANTE: null });
  });
});

describe("endereço do contratante: do cadastro em partes, e de volta numa linha", () => {
  const casos: Array<[string, Partial<ReturnType<typeof partesDoEndereco>>, string]> = [
    ["Florindo Beline, Nº 00216, Alto da Vila Patti, Novo Horizonte/SP, CEP: 14960-054",
      { rua: "Florindo Beline", numero: "00216", bairro: "Alto da Vila Patti", cidade: "Novo Horizonte", uf: "SP", cep: "14960-054" },
      "Florindo Beline, nº 00216, Alto da Vila Patti, Novo Horizonte/SP, CEP 14960-054"],
    ["Rua das Flores, 10, Centro, São Paulo/SP.", { rua: "Rua das Flores", numero: "10", bairro: "Centro", cidade: "São Paulo", uf: "SP" }, "Rua das Flores, nº 10, Centro, São Paulo/SP"],
    ["Av. Brasil 500 - Centro - Curitiba - PR 80000-000", { rua: "Av. Brasil", numero: "500", bairro: "Centro", cidade: "Curitiba", uf: "PR", cep: "80000-000" }, "Av. Brasil, nº 500, Centro, Curitiba/PR, CEP 80000-000"],
    ["Rua A, 12B, apto 3, Jardim X, Campinas/SP, 13000-000", { rua: "Rua A", numero: "12B", bairro: "apto 3, Jardim X", cidade: "Campinas", uf: "SP", cep: "13000-000" }, "Rua A, nº 12B, apto 3, Jardim X, Campinas/SP, CEP 13000-000"],
  ];
  test("separa rua, número, bairro, cidade, UF e CEP nos formatos do cadastro", () => {
    for (const [linha, partes, contrato] of casos) {
      expect(partesDoEndereco(linha)).toMatchObject({ ...partes, pais: "Brasil" });
      expect(enderecoDe(partesDoEndereco(linha))).toBe(contrato);
    }
  });
  test("o que não se reconhece fica na rua: nada do cadastro se perde", () => {
    expect(enderecoDe(partesDoEndereco("Sítio Boa Vista"))).toBe("Sítio Boa Vista");
    expect(partesDoEndereco("")).toMatchObject({ rua: "", numero: "", cidade: "" });
  });
  test("o país só vai para o contrato quando não é o Brasil", () => {
    expect(enderecoDe({ rua: "Calle Mayor", numero: "1", cidade: "Madrid", pais: "Espanha" })).toBe("Calle Mayor, nº 1, Madrid, Espanha");
    expect(enderecoDe({ rua: "Rua X", numero: "1", cidade: "Campinas", uf: "sp", pais: "brasil" })).toBe("Rua X, nº 1, Campinas/SP");
  });
  test("nome, CPF e endereço de quem assina são marcados como dado do contratante; o de outra pessoa, não", () => {
    const cru = (v: string) => ({ variable: `{{${v}}}`, label: "", help_text: "", required: false });
    const c = Object.fromEntries(
      camposDoModelo([cru("NOME_ASSINANTE"), cru("CPF_ASSINANTE"), cru("ENDERECO_CONTRATANTE"), cru("ENDERECO_DO_REPRESENTANTE"), cru("NOME_DA_MAE")], {
        cliente: { nome: "Adauto", cpf: "", endereco: "Florindo Beline, Nº 216, Alto da Vila Patti, Novo Horizonte/SP" },
      }).map((x) => [x.variavel.replace(/[{}]/g, ""), [x.dado, x.fixo, x.sugestao]]),
    );
    expect(c).toEqual({
      NOME_ASSINANTE: ["nome", true, "Adauto"],
      // sem CPF no cadastro: continua sendo o CPF do contratante, mas aberto para digitar
      CPF_ASSINANTE: ["cpf", false, ""],
      ENDERECO_CONTRATANTE: ["endereco", false, "Florindo Beline, nº 216, Alto da Vila Patti, Novo Horizonte/SP"],
      ENDERECO_DO_REPRESENTANTE: [null, false, ""],
      NOME_DA_MAE: [null, false, ""],
    });
  });
  test("a qualificação inicial usa o endereço já arrumado — a mesma frase que a tela monta", () => {
    const [q] = camposDoModelo([{ variable: "{{QUALIFICACAO_CONTRATANTE}}", label: "", required: true }], {
      cliente: { nome: "Adauto", cpf: "16967646885", endereco: "Florindo Beline, Nº 00216, Alto da Vila Patti, Novo Horizonte/SP, CEP: 14960-054" },
    });
    expect(q.sugestao).toBe("Adauto, brasileiro(a), CPF n.º 169.676.468-85, residente e domiciliado(a) em Florindo Beline, nº 00216, Alto da Vila Patti, Novo Horizonte/SP, CEP 14960-054");
  });
});

describe("o valor de cada campo que vai ao ZapSign", () => {
  const base = { "{{NOME_ASSINANTE}}": "Helena Bastos", "{{PERCENTUAL_ATRASADOS}}": "30", "{{QTD_PRESTACOES}}": "4", "{{VALOR_EXTENSO}}": "x" };
  const valor = (r: ReturnType<typeof respostasDoModelo>, v: string) => r.respostas.find((x) => x.variavel === `{{${v}}}`)?.valor;
  test("número e extenso saem juntos; o extenso que vier de fora é ignorado", () => {
    const r = respostasDoModelo(CAMPOS, { ...base, "{{PERCENTUAL_ATRASADOS_EXTENSO}}": "noventa por cento", "{{CAMPO DE FORA}}": "x" });
    expect(r.erros).toEqual([]);
    expect([valor(r, "PERCENTUAL_ATRASADOS"), valor(r, "PERCENTUAL_ATRASADOS_EXTENSO"), valor(r, "QTD_PRESTACOES"), valor(r, "QTD_PRESTACOES_EXTENSO")]).toEqual(["30%", "trinta por cento", "4", "quatro"]);
    expect(r.respostas.map((x) => x.variavel)).toEqual(CAMPOS.map((c) => c.variavel));
    // o que não é texto nem número não entra no contrato
    expect(valor(respostasDoModelo(CAMPOS, { ...base, "{{TEXTO_PARCEIRO}}": { a: 1 } }), "TEXTO_PARCEIRO")).toBe("");
  });
  test("faixa do modelo, número inválido e obrigatório vazio impedem o envio — uma frase por problema", () => {
    expect(respostasDoModelo(CAMPOS, { ...base, "{{PERCENTUAL_ATRASADOS}}": "60" }).erros).toEqual(["Honorários sobre os atrasados (%): o máximo deste modelo é 50%."]);
    expect(respostasDoModelo(CAMPOS, { ...base, "{{QTD_PRESTACOES}}": "0" }).erros).toEqual(["Quantidade de prestações: o mínimo deste modelo é 1."]);
    expect(respostasDoModelo(CAMPOS, { ...base, "{{QTD_PRESTACOES}}": "cinco" }).erros).toEqual(["Quantidade de prestações: use só o número (ex.: 5)."]);
    expect(respostasDoModelo(CAMPOS, { ...base, "{{QTD_PRESTACOES}}": "4,5" }).erros).toEqual(["Quantidade de prestações: use só o número (ex.: 5)."]);
    // o nome de quem assina vem do cadastro (fixo): não é cobrado da pessoa
    expect(respostasDoModelo(CAMPOS, {}).erros).toEqual(["Preencha: Honorários sobre os atrasados (%), Quantidade de prestações, Valor por extenso (sem campo base)."]);
  });
});

// ---- um DOCX mínimo, montado aqui (ZIP com um arquivo compactado e um guardado sem compactar)
function zip(arquivos: Array<[string, string, boolean]>): Uint8Array {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const [nome, texto, compactar] of arquivos) {
    const bruto = Buffer.from(texto, "utf8");
    const dados = compactar ? deflateRawSync(bruto) : bruto;
    const n = Buffer.from(nome, "utf8");
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(compactar ? 8 : 0, 8); cab.writeUInt32LE(dados.length, 18); cab.writeUInt32LE(bruto.length, 22); cab.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(compactar ? 8 : 0, 10); cen.writeUInt32LE(dados.length, 20); cen.writeUInt32LE(bruto.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    locais.push(cab, n, dados);
    centrais.push(cen, n);
    offset += 30 + n.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locais, dir, fim]));
}
const inflar = (d: Uint8Array) => new Uint8Array(inflateRawSync(d));
const XML =
  '<w:document><w:body>' +
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>CONTRATO</w:t></w:r></w:p>' +
  '<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t xml:space="preserve">Honorários de {{PERCENTUAL_</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ATRASADOS}} ({{PERCENTUAL_ATRASADOS_EXTENSO}})</w:t></w:r><w:r><w:t xml:space="preserve"> e teto de 35% &amp; mais nada.</w:t></w:r></w:p>' +
  '<w:p><w:pPr/></w:p>' +
  '<w:p><w:r><w:t>Parceiro: {{TEXTO_PARCEIRO}}</w:t><w:tab/><w:t>fim</w:t></w:r></w:p>' +
  '</w:body></w:document>';

describe("prévia do contrato", () => {
  test("lê o DOCX (compactado ou não), com negrito, centro, tabulação e entidades", async () => {
    for (const compactar of [true, false]) {
      const ps = await paragrafosDoDocx(zip([["[Content_Types].xml", "<Types/>", true], ["word/document.xml", XML, compactar]]), inflar);
      expect(ps).toHaveLength(3); // o parágrafo vazio não entra
      expect(ps[0]).toEqual({ centro: true, trechos: [{ t: "CONTRATO", n: true }] });
      expect(ps[1].trechos.map((t) => [t.t, t.n])).toEqual([["Honorários de {{PERCENTUAL_", false], ["ATRASADOS}} ({{PERCENTUAL_ATRASADOS_EXTENSO}})", true], [" e teto de 35% & mais nada.", false]]);
      expect(ps[2].trechos[0].t).toBe("Parceiro: {{TEXTO_PARCEIRO}}\tfim");
    }
  });
  test("arquivo que não é DOCX é recusado com frase, não com exceção de índice", async () => {
    await expect(paragrafosDoDocx(new Uint8Array([1, 2, 3]), inflar)).rejects.toThrow("não é um DOCX válido");
    await expect(paragrafosDoDocx(zip([["outro.xml", "<a/>", true]]), inflar)).rejects.toThrow("não é um DOCX válido");
  });
  test("troca o campo mesmo partido em dois pedaços, marca o preenchido e o que vai em branco, e não toca no texto fixo", async () => {
    const ps = await paragrafosDoDocx(zip([["word/document.xml", XML, true]]), inflar);
    const r = respostasDoModelo(CAMPOS, { "{{PERCENTUAL_ATRASADOS}}": "30" });
    const previa = previaDoContrato(ps, r.respostas);
    expect(previa[1].trechos).toEqual([
      { t: "Honorários de ", n: false },
      { t: "30%", n: false, marca: "preenchido" },
      { t: " (", n: true },
      { t: "trinta por cento", n: true, marca: "preenchido" },
      { t: ")", n: true },
      { t: " e teto de 35% & mais nada.", n: false },
    ]);
    expect(previa[2].trechos).toEqual([{ t: "Parceiro: ", n: false }, { t: "(em branco)", n: false, marca: "vazio" }, { t: "\tfim", n: false }]);
  });
});

describe("régua: uma conta só para os campos do modelo", () => {
  const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");
  test("o módulo é puro (a tela e a function importam o mesmo arquivo)", () => {
    expect(ler("supabase/functions/_shared/modelo-contrato.ts")).not.toMatch(/^\s*import\s/m);
  });
  test("a function e a tela decidem o valor dos campos por `respostasDoModelo`, e o ZapSign lê os campos por `camposDoModelo`", () => {
    expect(ler("supabase/functions/zapsign-enviar/index.ts")).toContain("respostasDoModelo(campos, dadas)");
    const tela = ler("src/components/assinaturas/gerar-contrato-dialog.tsx");
    expect(tela).toContain("respostasDoModelo(");
    // a prévia é montada com os MESMOS valores que vão ao ZapSign
    expect(tela).toContain("previaDoContrato(texto, conta.respostas)");
    expect(ler("supabase/functions/_shared/zapsign.ts")).toContain("camposDoModelo(m.inputs ?? []");
  });
  test("a function, o túnel do ZapSign e a tela não refazem o que o módulo decide", () => {
    const fora = ["supabase/functions/zapsign-enviar/index.ts", "supabase/functions/_shared/zapsign.ts", "src/components/assinaturas/gerar-contrato-dialog.tsx", "src/lib/assinaturas.ts", "src/lib/assinaturas-modelos.ts"];
    const proibido: Array<[RegExp, string]> = [
      [/por cento|_EXTENSO|\bEXTENSO\b/, "extenso é `extensoDoValor`"],
      [/normalize\("NFD"\)[^\n]*toLowerCase/, "tirar acento é `semAcento`"],
      [/slice\(0, 3\)[^\n]*slice\(3, 6\)/, "formatar CPF é `cpfComPontos`"],
      [/\.test\(c\.rotulo\)|\.test\(campo\.rotulo\)|\.test\(c\.variavel\)|ASSINANTE/, "a tela não adivinha pelo nome do campo: `especie`, `origem` e `fixo` vêm do módulo"],
      [/residente e domiciliad|RG n\.º|CPF n\.º/, "a frase da qualificação é `qualificacaoDe`"],
      [/\b(mae|pai)\|/, "'campo de outra pessoa' é `DE_OUTRA_PESSOA`"],
    ];
    const copias = fora.flatMap((f) => proibido.filter(([re]) => re.test(ler(f))).map(([, porque]) => `${f}: ${porque}`));
    expect(copias).toEqual([]);
  });
});
