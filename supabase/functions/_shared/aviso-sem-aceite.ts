// Parceiro sem aceite dos termos: aviso SEM dado de cliente (card #249).
//
// Decisão da Naira (05/10): quem não assinou os termos vigentes (DPA, termo de
// uso, política) não recebe andamento, comentário nem pedido de documento com o
// nome do cliente. No lugar, um aviso genérico — "há novidades nos seus casos,
// entre e assine os termos para ver" — no máximo UM por dia por escritório. O
// limite mora no banco (`reservar_aviso_aceite`, dia de Brasília); aqui só se
// pede a vaga e se manda.
//
// UM lugar para as três functions (notify-novo-andamento, notify-novo-comentario,
// notify-solicitacao-doc): quem decide o aceite é `parceiroSemAceite` de ./termos.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { enviarEmail } from "./email.ts";
import { marcaDoEscritorio, remetente } from "./marca.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://marasandraconnect.com";

export interface ParceiroDestino {
  id: string;
  nome: string | null;
  email: string;
}

export interface ResultadoAviso {
  enviado: boolean;
  aviso_sem_aceite: true;
  motivo: string;
  /** Falha de envio do aviso (a vaga do dia é devolvida). */
  erro?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Manda o aviso genérico, se ainda não saiu um hoje para este parceiro neste
 * escritório. Nunca leva nome de cliente, caso, título ou texto do evento.
 * Erro de banco ESTOURA (não vira "já avisado"): quem chama devolve 500.
 */
export async function avisarParceiroSemAceite(
  admin: SupabaseClient,
  escritorioId: string,
  parceiro: ParceiroDestino,
): Promise<ResultadoAviso> {
  const { data: reservado, error } = await admin.rpc("reservar_aviso_aceite", {
    p_escritorio: escritorioId,
    p_usuario: parceiro.id,
  });
  if (error) throw new Error(`reservar_aviso_aceite: ${error.message}`);
  if (!reservado) {
    return { enviado: false, aviso_sem_aceite: true, motivo: "parceiro sem aceite dos termos — o aviso de hoje já foi enviado" };
  }

  const marca = await marcaDoEscritorio(admin, escritorioId);
  const nome = parceiro.nome || parceiro.email;
  const link = `${APP_BASE_URL}/login`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px 28px">
<h1 style="margin:0 0 16px 0;font-size:18px;font-weight:600">${escapeHtml(marca.nome)}</h1>
<p style="margin:0 0 12px 0;font-size:15px">Olá, <strong>${escapeHtml(nome)}</strong>.</p>
<p style="margin:0 0 12px 0;font-size:15px">Há novidades nos seus casos com ${escapeHtml(marca.nome)}.</p>
<p style="margin:0 0 20px 0;font-size:15px">Para ver os detalhes, entre na plataforma e assine os termos de uso e o acordo de tratamento de dados. Enquanto os termos não forem assinados, os avisos chegam só assim, sem informações dos clientes.</p>
<a href="${link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">Entrar e assinar os termos</a>
<p style="margin:24px 0 0 0;font-size:12px;color:#6b7280">Este e-mail foi enviado automaticamente. Você recebe no máximo um aviso destes por dia.</p>
</td></tr></table></td></tr></table></body></html>`;
  const texto = [
    `Olá, ${nome}.`,
    "",
    `Há novidades nos seus casos com ${marca.nome}.`,
    "Para ver os detalhes, entre na plataforma e assine os termos de uso e o acordo de tratamento de dados:",
    link,
    "",
    "Enquanto os termos não forem assinados, os avisos chegam só assim, sem informações dos clientes.",
  ].join("\n");

  const r = await enviarEmail({
    de: remetente(marca),
    para: parceiro.email,
    assunto: `Novidades nos seus casos — assine os termos para ver`,
    html,
    texto,
  });
  if (!r.ok) {
    // Devolve a vaga do dia: senão o aviso que falhou contaria como enviado.
    const { error: eLib } = await admin.rpc("liberar_aviso_aceite", {
      p_escritorio: escritorioId,
      p_usuario: parceiro.id,
    });
    if (eLib) console.error("liberar_aviso_aceite", eLib.message);
    return { enviado: false, aviso_sem_aceite: true, motivo: "falha ao enviar o aviso", erro: `resend ${r.status}: ${r.detalhe.slice(0, 200)}` };
  }
  return { enviado: true, aviso_sem_aceite: true, motivo: "parceiro sem aceite dos termos — mandado o aviso sem dado de cliente" };
}
