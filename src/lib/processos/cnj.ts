// Parser do número CNJ (Numeração Única do Processo Judicial).
// Formato: NNNNNNN-DV.AAAA.J.TR.OOOO
//   NNNNNNN  sequencial (7)
//   DV       dígito verificador (2)
//   AAAA     ano (4)
//   J        segmento da justiça (1)
//              1=STF, 2=CNJ, 3=STJ, 4=Justiça Federal, 5=Justiça do Trabalho,
//              6=Justiça Eleitoral, 7=Justiça Militar (União), 8=Justiça
//              Estadual, 9=Justiça Militar Estadual
//   TR       tribunal (2). Para J=8 é o estado; J=4 é a região do TRF.
//   OOOO     origem (4) — código da vara/comarca (não há mapping público
//                       universal, depende do tribunal).

// Mapping oficial CNJ (Resolução 65/2008, Anexo VII). NÃO é ordem
// alfabética estrita — AP vem antes de AM, MT antes de MS, PR antes
// de PE, RS antes de RO/RR, SP antes de SE. Conferir aqui antes
// de mexer: https://www.cnj.jus.br/sgt/consulta_publica_classes.php
const TJ_UF: Record<string, string> = {
  "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA",
  "06": "CE", "07": "DF", "08": "ES", "09": "GO", "10": "MA",
  "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB",
  "16": "PR", "17": "PE", "18": "PI", "19": "RJ", "20": "RN",
  "21": "RS", "22": "RO", "23": "RR", "24": "SC", "25": "SE",
  "26": "SP", "27": "TO",
};

// TRFs por região
const TRF_LABEL: Record<string, string> = {
  "01": "TRF1",
  "02": "TRF2",
  "03": "TRF3",
  "04": "TRF4",
  "05": "TRF5",
  "06": "TRF6",
};

// UFs cobertas por cada TRF (pra inferir UF quando não vem direto).
const TRF_UFS: Record<string, string[]> = {
  "01": ["AC", "AM", "AP", "BA", "DF", "GO", "MA", "MT", "PA", "PI", "RO", "RR", "TO"],
  "02": ["ES", "RJ"],
  "03": ["MS", "SP"],
  "04": ["PR", "RS", "SC"],
  "05": ["AL", "CE", "PB", "PE", "RN", "SE"],
  "06": ["MG"],
};

export interface CnjParsed {
  valido: boolean;
  numeroNormalizado: string;
  ano: string | null;
  segmento: string | null;          // ex: "Justiça Estadual"
  tribunal: string | null;          // ex: "TJSP" | "TRF1"
  uf: string | null;                // quando inferível
  origemCodigo: string | null;      // OOOO (vara/comarca code)
}

/**
 * Parseia um número de processo CNJ. Aceita com ou sem máscara.
 * Retorna campos preenchíveis no formulário (tribunal, UF) — comarca/vara
 * não tem mapping universal, fica em branco.
 */
export function parseCnj(input: string): CnjParsed {
  const digitos = (input ?? "").replace(/\D/g, "");
  const out: CnjParsed = {
    valido: false,
    numeroNormalizado: input,
    ano: null,
    segmento: null,
    tribunal: null,
    uf: null,
    origemCodigo: null,
  };
  if (digitos.length < 20) return out;
  if (digitos.length > 20) {
    // toma só os 20 primeiros — alguns sistemas concatenam lixo no fim.
    // Não fazemos isso pra segurança; rejeita.
    return out;
  }

  // Extrai segmentos.
  const seq = digitos.slice(0, 7);
  const dv = digitos.slice(7, 9);
  const ano = digitos.slice(9, 13);
  const j = digitos.slice(13, 14);
  const tr = digitos.slice(14, 16);
  const oooo = digitos.slice(16, 20);

  const numeroNormalizado = `${seq}-${dv}.${ano}.${j}.${tr}.${oooo}`;
  out.numeroNormalizado = numeroNormalizado;
  out.ano = ano;
  out.origemCodigo = oooo;
  out.valido = true;

  switch (j) {
    case "8": {
      out.segmento = "Justiça Estadual";
      const uf = TJ_UF[tr];
      if (uf) {
        out.uf = uf;
        out.tribunal = `TJ${uf}`;
      }
      break;
    }
    case "4": {
      out.segmento = "Justiça Federal";
      const trib = TRF_LABEL[tr];
      if (trib) {
        out.tribunal = trib;
        // Não dá pra inferir UF exata só pelo TRF (ele cobre vários estados);
        // deixa em branco pra Naira preencher.
      }
      break;
    }
    case "5":
      out.segmento = "Justiça do Trabalho";
      out.tribunal = `TRT${Number(tr)}`;
      break;
    case "6":
      out.segmento = "Justiça Eleitoral";
      out.tribunal = `TRE${tr}`;
      break;
    case "7":
      out.segmento = "Justiça Militar (União)";
      out.tribunal = "STM";
      break;
    case "9":
      out.segmento = "Justiça Militar Estadual";
      break;
    case "1":
      out.segmento = "STF";
      out.tribunal = "STF";
      break;
    case "2":
      out.segmento = "CNJ";
      out.tribunal = "CNJ";
      break;
    case "3":
      out.segmento = "STJ";
      out.tribunal = "STJ";
      break;
  }

  // UFs cobertas (informativo).
  if (j === "4" && TRF_UFS[tr]) {
    // pode ser preenchido manual, mas ajuda no placeholder
  }
  return out;
}
