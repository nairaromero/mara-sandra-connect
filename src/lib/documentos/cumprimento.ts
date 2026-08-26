// Cumprimento de solicitação com VÁRIOS arquivos — lógica compartilhada entre
// os dois modais (aba Documentos do caso e hub /documentos), que eram gêmeos
// copiados e já divergiram uma vez. Cada arquivo tem TIPO próprio (pedido da
// Naira, 2026-08-26: solicitação "outro" pré-preenchia tudo como "Outro.pdf";
// agora o dropdown de tipos aparece por arquivo, como no upload da aba).

import { supabase } from "@/lib/supabase";
import { nomeArquivoPorTipo } from "@/lib/documentos/tipos";

export interface ArquivoCumprimento {
  file: File;
  nome: string;
  tipo: string;
}

// Mesma sanitização dos uploads avulsos: Storage rejeita chave com acento
// ("Invalid key"). O nome_arquivo mantém acento pra exibição.
export function sanitizarNomeArquivo(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Nome padrão pro arquivo a partir do TIPO, único dentro da lista: o 2º
 * arquivo do mesmo tipo ganha _(2) antes da extensão, senão nomes (e paths
 * no Storage) colidiriam.
 */
export function nomePadraoUnico(
  tipo: string,
  arquivo: File,
  nomesJaUsados: string[],
): string {
  const base = nomeArquivoPorTipo(tipo, null, arquivo.name);
  if (!nomesJaUsados.includes(base)) return base;
  const ponto = base.lastIndexOf(".");
  const raiz = ponto > 0 ? base.slice(0, ponto) : base;
  const ext = ponto > 0 ? base.slice(ponto) : "";
  for (let n = 2; ; n++) {
    const candidato = `${raiz}_(${n})${ext}`;
    if (!nomesJaUsados.includes(candidato)) return candidato;
  }
}

export interface ResultadoCumprimento {
  enviados: number;
  falhas: ArquivoCumprimento[];
  primeiroDocId: string | null;
  // Pro espelho no Drive (só a tela do caso usa).
  criados: Array<{ docId: string; nome: string; file: File }>;
}

/**
 * Sobe os arquivos um a um e cria os documentos vinculados à solicitação.
 * Falha num arquivo NÃO derruba os demais: os que subiram ficam vinculados
 * (solicitacao_id) e os que falharam voltam em `falhas` pra nova tentativa.
 */
export async function subirArquivosCumprimento(input: {
  arquivos: ArquivoCumprimento[];
  casoId: string;
  solicitacaoId: string;
  usuarioId: string;
  isInterno: boolean;
}): Promise<ResultadoCumprimento> {
  const r: ResultadoCumprimento = {
    enviados: 0,
    falhas: [],
    primeiroDocId: null,
    criados: [],
  };
  for (const a of input.arquivos) {
    try {
      const nomeArq = a.nome.trim();
      // upsert só pra interno: a RLS de UPDATE em storage.objects exige
      // is_interno(), e supabase-js com upsert=true dispara INSERT ON
      // CONFLICT DO UPDATE — que tropeça na policy mesmo sem conflito real.
      // Parceiro leva prefixo de timestamp no path (nome auto-gerado é fixo
      // por tipo, então re-solicitação do mesmo tipo colidiria).
      const path =
        input.casoId +
        "/" +
        (input.isInterno ? "" : Date.now() + "_") +
        sanitizarNomeArquivo(nomeArq);
      const upResp = await supabase.storage
        .from("documentos")
        .upload(path, a.file, { upsert: input.isInterno });
      if (upResp.error) throw upResp.error;
      const docInsert = await supabase
        .from("documentos")
        .insert({
          caso_id: input.casoId,
          tipo: a.tipo,
          // "Outro" com nome editado: a listagem mostra o nome no lugar do
          // rótulo genérico.
          tipo_personalizado:
            a.tipo === "outro"
              ? nomeArq.replace(/\.[^.]+$/, "").replace(/_/g, " ") || null
              : null,
          nome_arquivo: nomeArq,
          storage_path: path,
          tamanho_bytes: a.file.size,
          uploaded_by: input.usuarioId,
          visivel_parceiro: true,
          solicitacao_id: input.solicitacaoId,
        })
        .select("id")
        .single();
      if (docInsert.error) throw docInsert.error;
      const docId = (docInsert.data as { id: string }).id;
      if (!r.primeiroDocId) r.primeiroDocId = docId;
      r.criados.push({ docId, nome: nomeArq, file: a.file });
      r.enviados++;
    } catch (err) {
      console.error("[solicitacao] upload falhou:", a.nome, err);
      r.falhas.push(a);
    }
  }
  return r;
}
