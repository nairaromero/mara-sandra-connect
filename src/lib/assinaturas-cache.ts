// Cache dos modelos do ZapSign na TELA (#542): a lista de modelos e o texto de
// cada modelo (o que "Conferir o contrato" mostra) ficam na memória da aba.
//
// - LISTA: aparece na hora. Com mais de LISTA_REVALIDA_MS, o diálogo confere com o
//   ZapSign em segundo plano e troca se mudou ("stale-while-revalidate").
// - TEXTO: guardado até TEXTO_VALIDADE_MS, no máximo TEXTO_MAXIMO modelos; descartado
//   antes se a lista mostra que o modelo foi alterado no ZapSign (`atualizado`).
// - Os CAMPOS preenchidos com o cliente NÃO entram aqui: dependem do caso.
//
// Tudo é separado por pessoa + escritório (`chave`): trocar de escritório ou de conta
// na mesma aba começa vazio. Nada vai para o localStorage: fechar a aba limpa.
// Um pedido em andamento é reaproveitado (a busca em segundo plano e o clique em
// "Conferir" ao mesmo tempo fazem UM pedido só).
import type { ModeloZapsign } from "@shared/assinatura";
import type { ParagrafoDoContrato } from "@shared/modelo-contrato";

export const LISTA_REVALIDA_MS = 60_000;
export const TEXTO_VALIDADE_MS = 30 * 60_000;
export const TEXTO_MAXIMO = 10;

interface Fontes {
  buscarLista: () => Promise<Array<ModeloZapsign>>;
  /** o servidor confere o acesso pelo caso; o texto em si é o mesmo para qualquer caso */
  buscarTexto: (modeloToken: string, casoId: string) => Promise<Array<ParagrafoDoContrato>>;
  agora?: () => number;
}

export function criarCacheModelos(fontes: Fontes) {
  const agora = fontes.agora ?? (() => Date.now());
  let dono: string | null = null;
  let lista: { modelos: Array<ModeloZapsign>; lidaEm: number } | null = null;
  let listaEmCurso: Promise<Array<ModeloZapsign>> | null = null;
  // Map guarda a ordem de inserção: o primeiro é o mais antigo (é o que sai no teto)
  const textos = new Map<string, { atualizado: string; paragrafos: Array<ParagrafoDoContrato>; lidoEm: number }>();
  const textosEmCurso = new Map<string, Promise<Array<ParagrafoDoContrato>>>();

  /** Outra pessoa ou outro escritório: o que estava guardado não serve. */
  function para(chave: string) {
    if (dono === chave) return;
    dono = chave;
    lista = null;
    listaEmCurso = null;
    textos.clear();
    textosEmCurso.clear();
  }

  /** A data de alteração do modelo segundo a lista guardada ("" = não sabemos). */
  const atualizadoDe = (token: string) => lista?.modelos.find((m) => m.token === token)?.atualizado ?? "";

  return {
    /** O que já está guardado, sem ir ao ZapSign; `velha` = passou da hora de conferir. */
    listaGuardada(chave: string): { modelos: Array<ModeloZapsign>; velha: boolean } | null {
      para(chave);
      return lista ? { modelos: lista.modelos, velha: agora() - lista.lidaEm > LISTA_REVALIDA_MS } : null;
    },

    /** Lê a lista no ZapSign e guarda. O texto de modelo alterado lá sai da memória. */
    async atualizarLista(chave: string): Promise<Array<ModeloZapsign>> {
      para(chave);
      if (!listaEmCurso) {
        const pedido = fontes.buscarLista();
        listaEmCurso = pedido;
        pedido.then(
          (modelos) => {
            if (dono !== chave || listaEmCurso !== pedido) return; // trocou de dono no meio
            lista = { modelos, lidaEm: agora() };
            for (const [token, t] of textos) {
              const m = modelos.find((x) => x.token === token);
              if (!m || (m.atualizado && t.atualizado && m.atualizado !== t.atualizado)) textos.delete(token);
            }
          },
          () => undefined,
        ).finally(() => {
          if (listaEmCurso === pedido) listaEmCurso = null;
        });
      }
      return listaEmCurso;
    },

    /** O texto do modelo: o guardado, se ainda vale; senão busca (uma vez só, mesmo com dois pedidos juntos). */
    async texto(chave: string, modeloToken: string, casoId: string): Promise<Array<ParagrafoDoContrato>> {
      para(chave);
      const guardado = textos.get(modeloToken);
      const atualizado = atualizadoDe(modeloToken);
      if (guardado && agora() - guardado.lidoEm <= TEXTO_VALIDADE_MS && (!atualizado || !guardado.atualizado || atualizado === guardado.atualizado)) {
        return guardado.paragrafos;
      }
      const emCurso = textosEmCurso.get(modeloToken);
      if (emCurso) return emCurso;
      const pedido = fontes.buscarTexto(modeloToken, casoId).then((paragrafos) => {
        if (dono === chave) {
          textos.delete(modeloToken); // reinsere no fim: o mais novo
          textos.set(modeloToken, { atualizado, paragrafos, lidoEm: agora() });
          while (textos.size > TEXTO_MAXIMO) textos.delete(textos.keys().next().value as string);
        }
        return paragrafos;
      });
      textosEmCurso.set(modeloToken, pedido);
      pedido.finally(() => {
        if (textosEmCurso.get(modeloToken) === pedido) textosEmCurso.delete(modeloToken);
      }).catch(() => undefined);
      return pedido;
    },

    /** Quantos textos estão guardados (para os testes). */
    get textosGuardados() {
      return textos.size;
    },
  };
}
