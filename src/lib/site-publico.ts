// O site público do escritório (página de entrada `/` e `/privacidade`), antes
// do login. É o site do escritório de propósito (decisão da Naira, 28/10, #496)
// — a única parte do produto que fala em nome de UM escritório sem saber quem
// está logado. Dentro do sistema, os dados legais vêm do banco
// (escritorio_config.dados_legais) e a marca, de `useAuth().escritorio.marca`.
// Régua: e2e/unit/marca-fixa.test.ts (o nome do escritório só pode aparecer
// nesta lista de arquivos).
import type { DadosLegais } from "@/lib/legal/termos";

export const SITE_PUBLICO = {
  nome: "Mara Sandra Vian Advocacia",
  dadosLegais: {
    razao_social: "Mara Vian Sociedade Individual de Advocacia",
    cnpj: "60.244.853/0001-09",
    endereco: "Rua Alagoas, nº 3081, Sala 04 – Patrimônio Velho – Votuporanga/SP – CEP 15505-169",
    foro: "Votuporanga/SP",
    privacidade_contato: "Mara Sandra",
    privacidade_email: "contato.maravian@advocaciaprevi.com",
    privacidade_tel: "",
  } satisfies DadosLegais,
};
