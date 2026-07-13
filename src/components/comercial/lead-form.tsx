import { useEffect, useState } from "react";
import { MessageCircle, Scale, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Formulário público de captação de leads (home). Visitante anônimo insere
// direto na tabela `leads` — RLS garante insert-only. Depois do envio, oferece
// continuar no WhatsApp com mensagem pronta, amarrando a conversa ao lead.

const WHATSAPP = "5517997733081";

export type LeadTab = "cliente" | "parceiro";

const SITUACOES = [
  { value: "aposentadoria", label: "Aposentadoria" },
  { value: "incapacidade", label: "Auxílio-doença / incapacidade" },
  { value: "bpc_loas", label: "BPC / LOAS" },
  { value: "pensao_morte", label: "Pensão por morte" },
  { value: "salario_maternidade", label: "Salário-maternidade" },
  { value: "revisao", label: "Revisão de benefício" },
  { value: "planejamento", label: "Planejamento previdenciário" },
  { value: "outro", label: "Outro / não sei dizer" },
];

const INSS_STATUS = [
  { value: "negado", label: "Sim, foi negado" },
  { value: "em_analise", label: "Sim, está em análise" },
  { value: "nao_pedi", label: "Ainda não pedi" },
  { value: "nao_sei", label: "Não sei" },
];

const INTERESSES = [
  { value: "indicar_caso", label: "Indicar um caso agora" },
  { value: "conhecer_parceria", label: "Conhecer a parceria" },
  { value: "testar_demo", label: "Testar a demo do portal" },
];

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

// Captura UTMs da URL na primeira visita e guarda na sessão, pra não perder a
// origem se a pessoa navegar antes de preencher.
function capturarUtms(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const salvo = sessionStorage.getItem("msv_utms");
    const params = new URLSearchParams(window.location.search);
    const daUrl: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = params.get(k);
      if (v) daUrl[k] = v.slice(0, 120);
    }
    if (Object.keys(daUrl).length > 0) {
      sessionStorage.setItem("msv_utms", JSON.stringify(daUrl));
      return daUrl;
    }
    return salvo ? (JSON.parse(salvo) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function soDigitos(v: string) {
  return v.replace(/\D/g, "");
}

interface LeadFormProps {
  origem: "form-hero" | "form-contato";
  /** Versão escura (card do hero). Só mostra a aba cliente. */
  dark?: boolean;
  /** Aba controlada pelo pai (seção contato) */
  tab?: LeadTab;
  onTabChange?: (tab: LeadTab) => void;
}

export function LeadForm({ origem, dark, tab: tabProp, onTabChange }: LeadFormProps) {
  const [tabLocal, setTabLocal] = useState<LeadTab>("cliente");
  const tab = dark ? "cliente" : (tabProp ?? tabLocal);
  const setTab = (t: LeadTab) => {
    setTabLocal(t);
    onTabChange?.(t);
  };

  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [situacao, setSituacao] = useState("");
  const [inssStatus, setInssStatus] = useState("");
  const [oab, setOab] = useState("");
  const [interesse, setInteresse] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [utms, setUtms] = useState<Record<string, string>>({});

  useEffect(() => {
    setUtms(capturarUtms());
  }, []);

  const input = dark
    ? "w-full rounded-lg border border-white/15 bg-white/[0.08] px-3.5 py-3 text-sm text-white placeholder-[#9c9686] outline-none focus:border-[#caa14e]"
    : "w-full rounded-lg border border-border bg-background px-3.5 py-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-gold";
  const label = dark
    ? "mb-1.5 block text-[13px] font-semibold text-[#e4ddcd]"
    : "mb-1.5 block text-[13px] font-semibold";
  const muted = dark ? "text-[#9c9686]" : "text-muted-foreground";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const digitos = soDigitos(whatsapp);
    if (nome.trim().length < 2) {
      setErro("Escreva seu nome, por favor.");
      return;
    }
    if (digitos.length < 10 || digitos.length > 13) {
      setErro("Confira o número do WhatsApp (com DDD).");
      return;
    }
    if (tab === "cliente" && !situacao) {
      setErro("Escolha qual é a sua situação.");
      return;
    }
    if (tab === "parceiro" && oab.trim().length < 3) {
      setErro("Informe seu número de OAB e estado.");
      return;
    }

    // Honeypot: bot preencheu o campo invisível — finge sucesso, não grava.
    if (honeypot) {
      setEnviado(true);
      return;
    }

    setEnviando(true);
    const { error } = await supabase.from("leads").insert({
      tipo: tab,
      nome: nome.trim().slice(0, 200),
      whatsapp: digitos,
      situacao: tab === "cliente" ? situacao : null,
      inss_status: tab === "cliente" ? inssStatus || null : null,
      oab: tab === "parceiro" ? oab.trim().slice(0, 40) : null,
      interesse: tab === "parceiro" ? interesse || null : null,
      origem,
      ...utms,
    });
    setEnviando(false);

    if (error) {
      setErro("Não conseguimos enviar agora. Chame direto no WhatsApp que respondemos rápido.");
      return;
    }
    setEnviado(true);
  }

  if (enviado) {
    const msg =
      tab === "cliente"
        ? `Olá! Sou ${nome.trim()}, acabei de enviar meu caso pelo site.`
        : `Olá! Sou ${nome.trim()} (OAB ${oab.trim()}), enviei meu contato pelo site sobre parceria.`;
    return (
      <div className="text-center">
        <div
          className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${dark ? "bg-[#caa14e]/20" : "bg-gold-soft"}`}
        >
          <MessageCircle className={`h-7 w-7 ${dark ? "text-[#caa14e]" : "text-gold"}`} />
        </div>
        <h3 className={`font-serif text-2xl ${dark ? "text-white" : "text-foreground"}`}>
          Recebemos seus dados!
        </h3>
        <p className={`mt-2 text-sm ${muted}`}>
          Nossa equipe vai te chamar no WhatsApp. Se preferir, comece a conversa agora:
        </p>
        <a
          href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#a3741f]"
        >
          <MessageCircle className="h-4 w-4" />
          Continuar no WhatsApp
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} noValidate>
      {!dark && (
        <div className="mb-5 grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/40 p-1">
          {(
            [
              { t: "cliente" as const, Icon: User, texto: "Preciso de ajuda" },
              { t: "parceiro" as const, Icon: Scale, texto: "Sou advogado(a)" },
            ] as const
          ).map(({ t, Icon, texto }) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors ${
                tab === t ? "bg-gold text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {texto}
            </button>
          ))}
        </div>
      )}

      {/* honeypot anti-spam: invisível pra gente, irresistível pra bot */}
      <input
        type="text"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <label className={label} htmlFor={`${origem}-nome`}>
        Seu nome
      </label>
      <input
        id={`${origem}-nome`}
        className={`${input} mb-4`}
        placeholder={tab === "cliente" ? "Maria da Silva" : "Dr. João Pereira"}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        autoComplete="name"
      />

      <label className={label} htmlFor={`${origem}-whatsapp`}>
        WhatsApp
      </label>
      <input
        id={`${origem}-whatsapp`}
        className={`${input} mb-4`}
        placeholder="(17) 99999-0000"
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        inputMode="tel"
        autoComplete="tel"
      />

      {tab === "cliente" ? (
        <>
          <label className={label} htmlFor={`${origem}-situacao`}>
            Qual é a sua situação?
          </label>
          <select
            id={`${origem}-situacao`}
            className={`${input} mb-4 appearance-none`}
            value={situacao}
            onChange={(e) => setSituacao(e.target.value)}
          >
            <option value="" disabled>
              Escolha uma opção…
            </option>
            {SITUACOES.map((s) => (
              <option key={s.value} value={s.value} className="text-foreground">
                {s.label}
              </option>
            ))}
          </select>

          <label className={label} htmlFor={`${origem}-inss`}>
            Já fez o pedido no INSS?
          </label>
          <select
            id={`${origem}-inss`}
            className={`${input} mb-4 appearance-none`}
            value={inssStatus}
            onChange={(e) => setInssStatus(e.target.value)}
          >
            <option value="" disabled>
              Escolha uma opção…
            </option>
            {INSS_STATUS.map((s) => (
              <option key={s.value} value={s.value} className="text-foreground">
                {s.label}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label className={label} htmlFor={`${origem}-oab`}>
            OAB / UF
          </label>
          <input
            id={`${origem}-oab`}
            className={`${input} mb-4`}
            placeholder="123.456 / SP"
            value={oab}
            onChange={(e) => setOab(e.target.value)}
          />

          <label className={label} htmlFor={`${origem}-interesse`}>
            O que você procura?
          </label>
          <select
            id={`${origem}-interesse`}
            className={`${input} mb-4 appearance-none`}
            value={interesse}
            onChange={(e) => setInteresse(e.target.value)}
          >
            <option value="" disabled>
              Escolha uma opção…
            </option>
            {INTERESSES.map((s) => (
              <option key={s.value} value={s.value} className="text-foreground">
                {s.label}
              </option>
            ))}
          </select>
        </>
      )}

      {erro && (
        <p
          className={`mb-3 rounded-lg px-3 py-2 text-[13px] ${dark ? "bg-red-500/15 text-red-200" : "bg-red-50 text-red-700"}`}
        >
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#a3741f] disabled:opacity-60"
      >
        {enviando
          ? "Enviando…"
          : tab === "cliente"
            ? "Enviar meu caso"
            : "Falar com o escritório"}
      </button>
      <p className={`mt-3 block text-center text-[11.5px] ${muted}`}>
        🔒 Seus dados protegidos conforme a LGPD, usados apenas para contato.
      </p>
    </form>
  );
}
