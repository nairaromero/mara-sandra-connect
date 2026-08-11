// Extrai o motivo real de uma edge function que falhou.
//
// Quando uma function responde 4xx/5xx, o supabase-js joga um FunctionsHttpError
// cuja `.message` e sempre a mesma frase inutil: "Edge Function returned a
// non-2xx status code". O motivo de verdade esta no body da resposta, que fica
// pendurado em `.context` (o Response cru) e nunca chega na tela.
//
// Isso ja custou tempo de debug: trocar o email de uma parceira falhava com
// "non-2xx status code" na tela enquanto o servidor dizia, no body, que o email
// ja pertencia a outro usuario.
//
// Nossas functions respondem { error, detail? }, entao e isso que priorizamos.

export async function mensagemDeErroEdge(err: unknown, fallback: string): Promise<string> {
  const ctx = (err as { context?: unknown } | null)?.context;

  if (ctx instanceof Response) {
    try {
      // clone() porque o body so pode ser lido uma vez e quem chamou pode
      // querer ler de novo.
      const body = (await ctx.clone().json()) as {
        error?: string;
        message?: string;
        detail?: string;
        warning?: string;
      };
      const motivo = body.error ?? body.message ?? body.warning;
      if (motivo) {
        return body.detail ? `${motivo} (${body.detail})` : motivo;
      }
    } catch {
      // Body vazio ou nao-JSON: cai no texto puro, se houver.
      try {
        const txt = (await ctx.clone().text()).trim();
        if (txt) return txt.slice(0, 300);
      } catch {
        // desiste e usa o fallback
      }
    }
  }

  return (err as { message?: string } | null)?.message || fallback;
}
