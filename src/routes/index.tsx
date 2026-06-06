import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MessageCircle,
  Scale,
  Stethoscope,
  HeartHandshake,
  Bird,
  Baby,
  TrendingUp,
  Check,
  Mail,
  MapPin,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mara Sandra Vian Advocacia — Direito Previdenciário" },
      {
        name: "description",
        content:
          "Advocacia especializada em Direito Previdenciário. Aposentadoria, auxílio-doença, BPC/LOAS, pensão por morte e revisões. Atendimento humano e 100% online em São Paulo e Mato Grosso.",
      },
      { property: "og:title", content: "Mara Sandra Vian Advocacia — Direito Previdenciário" },
      {
        property: "og:description",
        content:
          "Seu benefício foi negado pelo INSS? A gente luta pelo seu direito. Análise gratuita pelo WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/logo.png" },
    ],
  }),
  component: HomePage,
});

// Número placeholder — trocar pelo WhatsApp oficial do escritório.
const WHATSAPP = "5517997733081";
const WA_LINK = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  "Olá! Vim pelo site e gostaria de uma análise do meu caso.",
)}`;

const btn =
  "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors";

const NAV = [
  { href: "#sobre", label: "Sobre" },
  { href: "#areas", label: "Áreas de atuação" },
  { href: "#como", label: "Como funciona" },
  { href: "#depoimentos", label: "Depoimentos" },
  { href: "#parceiro", label: "Parceiros" },
  { href: "#contato", label: "Contato" },
];

const AREAS = [
  {
    icon: Scale,
    title: "Aposentadorias",
    desc: "Por idade, tempo de contribuição, especial e da pessoa com deficiência (LC 142).",
  },
  {
    icon: Stethoscope,
    title: "Benefícios por incapacidade",
    desc: "Auxílio-doença, aposentadoria por invalidez e auxílio-acidente.",
  },
  {
    icon: HeartHandshake,
    title: "BPC / LOAS",
    desc: "Benefício assistencial para idosos e pessoas com deficiência de baixa renda.",
  },
  {
    icon: Bird,
    title: "Pensão por morte",
    desc: "Garantia do benefício aos dependentes do segurado falecido.",
  },
  {
    icon: Baby,
    title: "Salário-maternidade",
    desc: "Para seguradas em diversas situações de trabalho e contribuição.",
  },
  {
    icon: TrendingUp,
    title: "Revisões de benefício",
    desc: "Revisão de valores pagos a menor pelo INSS, com recálculo da renda.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Conte seu caso",
    desc: "Você fala com a gente pelo WhatsApp, sem compromisso.",
  },
  {
    n: "02",
    title: "Análise jurídica",
    desc: "Avaliamos seu direito gratuitamente e explicamos as opções.",
  },
  {
    n: "03",
    title: "Estratégia",
    desc: "Entramos com o pedido no INSS ou na Justiça, conforme o melhor caminho.",
  },
  {
    n: "04",
    title: "Acompanhamento",
    desc: "Cuidamos de tudo e mantemos você informado até o resultado.",
  },
];

const DEPOIMENTOS = [
  {
    inicial: "M",
    nome: "Maria S.",
    caso: "Aposentadoria por idade",
    texto:
      "Meu auxílio tinha sido negado e eu já tinha perdido as esperanças. A Dra. resolveu tudo com muita atenção.",
  },
  {
    inicial: "J",
    nome: "João P.",
    caso: "BPC/LOAS",
    texto: "Atendimento humano de verdade. Explicaram cada passo numa linguagem que eu entendi.",
  },
  {
    inicial: "A",
    nome: "Antônia R.",
    caso: "Revisão de benefício",
    texto: "Recebi minha revisão com valores atrasados. Profissionalismo do começo ao fim.",
  },
];

const PARCEIRO_BENEFITS = [
  "Você mantém o relacionamento com o seu cliente",
  "Cuidamos de tudo: administrativo no INSS e judicial",
  "Divisão de honorários justa e transparente",
  "Acompanhe cada andamento em tempo real pelo portal",
];

const FAQ = [
  {
    q: "O INSS negou meu pedido. Ainda tenho chance?",
    a: "Sim. Muitos benefícios negados administrativamente são conquistados na via judicial. Fazemos uma análise gratuita do seu caso.",
  },
  {
    q: "Preciso ir até o escritório?",
    a: "Não. O atendimento é 100% online, por WhatsApp e videochamada — atuamos em São Paulo e Mato Grosso, onde você estiver.",
  },
  {
    q: "Quanto custa?",
    a: "A análise inicial é gratuita. Os honorários são combinados com transparência antes de qualquer passo.",
  },
  {
    q: "Quanto tempo demora?",
    a: "Depende do tipo de benefício e da via (administrativa ou judicial). Explicamos o prazo estimado já na análise.",
  },
  {
    q: "Como funciona a parceria para advogados?",
    a: "Você indica o caso e acompanha tudo pelo portal. Cuidamos do processo e dividimos os honorários de forma justa.",
  },
];

const PORTAL_PREVIEW = [
  {
    caso: "Aposentadoria por idade",
    cliente: "J. P. Souza",
    status: "Deferido",
    tone: "ok" as const,
  },
  { caso: "Auxílio-doença", cliente: "M. A. Lima", status: "Em análise", tone: "wait" as const },
  { caso: "BPC/LOAS", cliente: "A. R. Costa", status: "Aguardando doc.", tone: "wait" as const },
  { caso: "Revisão de benefício", cliente: "C. F. Dias", status: "Deferido", tone: "ok" as const },
];

function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
  const color = light ? "text-[#caa14e]" : "text-gold";
  const line = light ? "bg-[#caa14e]" : "bg-gold";
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] ${color}`}
    >
      <span className={`h-px w-7 ${line}`} />
      {children}
    </span>
  );
}

function SectionHead({
  eyebrow,
  title,
  subtitle,
  light,
}: {
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  light?: boolean;
}) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <div className="flex justify-center">
        <Eyebrow light={light}>{eyebrow}</Eyebrow>
      </div>
      <h2
        className={`mt-3 font-serif text-3xl font-semibold leading-tight sm:text-4xl ${light ? "text-white" : "text-foreground"}`}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-3 text-base ${light ? "text-[#c9c1b0]" : "text-muted-foreground"}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

function HomePage() {
  return (
    <div className="bg-background font-sans text-foreground">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1140px] items-center justify-between px-5 sm:px-6">
          <img
            src="/logo.png"
            alt="Mara Sandra Vian Advocacia"
            className="h-11 w-auto object-contain sm:h-12"
          />
          <nav className="hidden items-center gap-7 lg:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-gold"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/login"
              className={`${btn} hidden border border-border text-foreground hover:border-gold hover:text-gold sm:inline-flex`}
            >
              <Scale className="h-4 w-4" />
              Entrar no portal
            </Link>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} bg-gold text-white shadow-[0_6px_20px_-6px_rgba(184,134,46,.6)] hover:bg-[#a3741f]`}
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Falar no WhatsApp</span>
              <span className="sm:hidden">WhatsApp</span>
            </a>
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section
        className="relative overflow-hidden text-white"
        style={{ background: "linear-gradient(135deg,#2a251b 0%,#3a3324 55%,#4a4029 100%)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(circle at 80% 20%,rgba(184,134,46,.28),transparent 45%)",
          }}
        />
        <div className="relative z-[2] mx-auto grid max-w-[1140px] items-center gap-12 px-5 py-16 sm:px-6 lg:grid-cols-[1.15fr_.85fr] lg:py-24">
          <div>
            <Eyebrow light>Direito Previdenciário</Eyebrow>
            <h1 className="mt-5 font-serif text-4xl font-semibold leading-[1.08] sm:text-5xl lg:text-[54px]">
              Seu benefício foi <span className="text-[#caa14e]">negado pelo INSS</span>? A gente
              luta pelo seu direito.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-[#d9d2c2]">
              Aposentadoria, auxílio-doença, BPC/LOAS, pensão por morte e revisões. Atendimento
              humano e 100% online, em São Paulo e Mato Grosso.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a
                href={WA_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className={`${btn} bg-gold text-white shadow-[0_6px_20px_-6px_rgba(184,134,46,.6)] hover:bg-[#a3741f]`}
              >
                Analisar meu caso grátis
              </a>
              <a
                href="#sobre"
                className={`${btn} border border-white/30 text-white hover:border-white/60`}
              >
                Conhecer o escritório
              </a>
            </div>
            <div className="mt-12 flex flex-wrap gap-9 border-t border-white/10 pt-8">
              {[
                { n: "+10", l: "anos de atuação" },
                { n: "+700", l: "clientes atendidos" },
                { n: "100%", l: "online e seguro" },
              ].map((t) => (
                <div key={t.l}>
                  <div className="font-serif text-3xl font-bold leading-none text-[#caa14e]">
                    {t.n}
                  </div>
                  <div className="mt-1.5 text-[13px] text-[#bdb6a6]">{t.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* card de análise */}
          <div className="rounded-2xl border border-[#caa14e]/30 bg-white/[0.06] p-7 backdrop-blur-sm">
            <h3 className="font-serif text-2xl text-white">Análise gratuita</h3>
            <p className="mt-1 text-sm text-[#cfc8b8]">
              Conte seu caso. Respondemos rápido pelo WhatsApp.
            </p>
            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-white/15 bg-white/[0.08] px-3.5 py-3 text-sm text-[#9c9686]">
                Seu nome
              </div>
              <div className="rounded-lg border border-white/15 bg-white/[0.08] px-3.5 py-3 text-sm text-[#9c9686]">
                WhatsApp
              </div>
              <div className="rounded-lg border border-white/15 bg-white/[0.08] px-3.5 pb-9 pt-3 text-sm text-[#9c9686]">
                Resumo do seu caso…
              </div>
            </div>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} mt-4 w-full bg-gold text-white hover:bg-[#a3741f]`}
            >
              Quero minha análise
            </a>
            <small className="mt-3 block text-center text-[11.5px] text-[#9c9686]">
              🔒 Seus dados protegidos conforme a LGPD
            </small>
          </div>
        </div>
      </section>

      {/* ===== SOBRE ===== */}
      <section id="sobre" className="bg-secondary/40 py-20 sm:py-24">
        <div className="mx-auto grid max-w-[1140px] items-center gap-10 px-5 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-gradient-to-br from-[#e9e0cc] to-[#d8caa6] shadow-[0_10px_40px_-12px_rgba(42,37,27,.18)]">
            <img
              src="/dra-mara-sandra.jpg"
              alt="Dra. Mara Sandra Vian"
              className="h-full w-full object-cover object-top"
            />
            <span className="absolute bottom-4 left-4 rounded-md bg-white/90 px-3 py-1.5 text-xs text-muted-foreground">
              📍 Atendimento em São Paulo e Mato Grosso
            </span>
          </div>
          <div>
            <Eyebrow>Quem cuida do seu caso</Eyebrow>
            <h2 className="mt-3 font-serif text-3xl font-semibold sm:text-4xl">Mara Sandra Vian</h2>
            <div className="mt-2 text-sm font-semibold text-gold">
              Advogada • Especialista em Direito Previdenciário • OAB/MT 22.928 e OAB/SP 439.016
            </div>
            <p className="mt-5 text-base text-muted-foreground">
              Dedicada exclusivamente ao Direito Previdenciário, ajudo segurados a conquistar os
              benefícios a que têm direito — do pedido administrativo no INSS até a ação judicial,
              quando necessário.
            </p>
            <p className="mt-4 text-base text-muted-foreground">
              Cada caso é tratado com atenção, linguagem simples e transparência total em cada
              etapa.
            </p>
            <ul className="mt-6 grid gap-3">
              {[
                "Atendimento direto, sem intermediários",
                "Acompanhamento administrativo e judicial",
                "Você acompanha o andamento do seu caso de perto",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px]">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ===== ÁREAS ===== */}
      <section id="areas" className="py-20 sm:py-24">
        <div className="mx-auto max-w-[1140px] px-5 sm:px-6">
          <SectionHead
            eyebrow="Áreas de atuação"
            title="Em que podemos te ajudar"
            subtitle={
              <>
                Estes são alguns dos casos mais comuns — mas atuamos em{" "}
                <strong className="font-semibold text-foreground">
                  todos os benefícios e direitos junto ao INSS
                </strong>
                .
              </>
            }
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group rounded-2xl border border-border bg-card p-7 transition-all hover:-translate-y-1 hover:border-gold hover:shadow-[0_10px_40px_-12px_rgba(42,37,27,.18)]"
              >
                <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-gold-soft">
                  <Icon className="h-6 w-6 text-gold" />
                </div>
                <h3 className="font-serif text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-[14.5px] text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
          {/* faixa: não encontrou seu caso */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-border bg-gold-soft px-6 py-6 sm:px-8">
            <div>
              <b className="block font-serif text-2xl text-foreground">
                Não encontrou o seu caso aqui?
              </b>
              <span className="text-[14.5px] text-muted-foreground">
                Cada situação é única. Atuamos em todo tipo de benefício, recurso e revisão
                previdenciária.
              </span>
            </div>
            <a href="#contato" className={`${btn} shrink-0 bg-gold text-white hover:bg-[#a3741f]`}>
              Falar sobre o meu caso
            </a>
          </div>
        </div>
      </section>

      {/* ===== COMO FUNCIONA ===== */}
      <section id="como" className="bg-primary py-20 text-white sm:py-24">
        <div className="mx-auto max-w-[1140px] px-5 sm:px-6">
          <SectionHead
            light
            eyebrow="Como funciona"
            title="Simples do início ao fim"
            subtitle="Você cuida da sua vida. A gente cuida do seu processo."
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl border border-[#caa14e]/25 bg-white/[0.04] p-6">
                <div className="font-serif text-5xl font-bold leading-none text-[#caa14e]">
                  {s.n}
                </div>
                <h3 className="mt-3.5 font-serif text-xl text-white">{s.title}</h3>
                <p className="mt-2 text-sm text-[#c9c1b0]">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== DEPOIMENTOS ===== */}
      <section id="depoimentos" className="py-20 sm:py-24">
        <div className="mx-auto max-w-[1140px] px-5 sm:px-6">
          <SectionHead
            eyebrow="Depoimentos"
            title="Quem confiou, recomenda"
            subtitle="Histórias reais de quem conquistou seus direitos."
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DEPOIMENTOS.map((d) => (
              <div key={d.nome} className="rounded-2xl border border-border bg-card p-7">
                <div className="tracking-[2px] text-gold">★★★★★</div>
                <p className="mt-3.5 text-[15px] italic text-foreground">"{d.texto}"</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-soft font-bold text-gold">
                    {d.inicial}
                  </div>
                  <div>
                    <b className="block text-sm">{d.nome}</b>
                    <small className="text-[12.5px] text-muted-foreground">{d.caso}</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PARCEIRO ===== */}
      <section
        id="parceiro"
        className="text-white"
        style={{ background: "linear-gradient(135deg,#3a3324,#2a251b)" }}
      >
        <div className="mx-auto grid max-w-[1140px] items-center gap-12 px-5 py-20 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <Eyebrow light>Para advogados</Eyebrow>
            <h2 className="mt-4 font-serif text-3xl font-semibold leading-tight sm:text-4xl">
              É advogado? <span className="text-[#caa14e]">Indique casos previdenciários</span> e
              ganhe junto.
            </h2>
            <p className="mt-4 text-base text-[#cfc8b8]">
              Você indica o cliente e mantém o relacionamento. Nós cuidamos de todo o processo —
              administrativo no INSS e judicial. Honorários divididos de forma justa e transparente.
            </p>
            <ul className="my-6 grid gap-3">
              {PARCEIRO_BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-3 text-[15px] text-[#e4ddcd]">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#caa14e]" />
                  {b}
                </li>
              ))}
            </ul>
            {/* caixa demo */}
            <div className="my-2 flex flex-wrap items-center justify-between gap-5 rounded-xl border border-dashed border-[#caa14e]/50 bg-[#caa14e]/10 px-6 py-5">
              <div>
                <b className="block font-serif text-[22px] text-white">
                  Conheça o portal por dentro
                </b>
                <span className="text-[13.5px] text-[#cfc8b8]">
                  Agende uma demonstração e teste o aplicativo sem compromisso.
                </span>
              </div>
              <a
                href="#contato"
                className={`${btn} shrink-0 bg-gold text-white hover:bg-[#a3741f]`}
              >
                Testar a demo do app
              </a>
            </div>
            <div className="mt-2 flex flex-wrap gap-3.5">
              <a
                href="#contato"
                className={`${btn} border border-white/30 text-white hover:border-white/60`}
              >
                Quero ser parceiro
              </a>
              <Link
                to="/login"
                className={`${btn} border border-white/30 text-white hover:border-white/60`}
              >
                <Scale className="h-4 w-4" />
                Já sou parceiro — entrar no portal
              </Link>
            </div>
          </div>

          {/* mockup do portal */}
          <div className="overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(0,0,0,.5)]">
            <div className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-3.5 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#d8caa6]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#d8caa6]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#d8caa6]" />
              <span className="ml-2 text-[11px] text-[#a08a52]">Portal do Parceiro</span>
            </div>
            <div className="space-y-2.5 p-4">
              {PORTAL_PREVIEW.map((r) => (
                <div
                  key={r.caso}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <b className="text-[13px] text-foreground">{r.caso}</b>
                    <div className="text-[11px] text-muted-foreground">Cliente: {r.cliente}</div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${
                      r.tone === "ok" ? "bg-[#dff3e4] text-[#1a7a3e]" : "bg-gold-soft text-gold"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="bg-secondary/40 py-20 sm:py-24">
        <div className="mx-auto max-w-[1140px] px-5 sm:px-6">
          <SectionHead eyebrow="Dúvidas frequentes" title="Perguntas comuns" />
          <div className="mx-auto grid max-w-3xl gap-3.5">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group rounded-xl border border-border bg-card px-6 py-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold">
                  {item.q}
                  <span className="text-2xl font-light text-gold transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[15px] text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CONTATO ===== */}
      <section id="contato" className="py-20 sm:py-24">
        <div className="mx-auto grid max-w-[1140px] items-center gap-12 px-5 sm:px-6 lg:grid-cols-2">
          <div>
            <Eyebrow>Fale com a gente</Eyebrow>
            <h2 className="mt-3 font-serif text-3xl font-semibold sm:text-4xl">
              Conte seu caso agora
            </h2>
            <p className="mb-7 mt-3.5 text-base text-muted-foreground">
              Resposta rápida e sem compromisso. Estamos prontos para ajudar você.
            </p>
            {[
              {
                icon: MessageCircle,
                title: "WhatsApp",
                sub: "(17) 99773-3081 — atendimento em horário comercial",
              },
              { icon: Mail, title: "E-mail", sub: "contato@marasandravian.com.br" },
              { icon: MapPin, title: "Atuação", sub: "São Paulo e Mato Grosso" },
            ].map(({ icon: Icon, title, sub }) => (
              <div key={title} className="mb-4 flex items-center gap-3.5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-soft">
                  <Icon className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <b className="block text-[15px]">{title}</b>
                  <small className="text-[13px] text-muted-foreground">{sub}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_10px_40px_-12px_rgba(42,37,27,.18)]">
            <label className="mb-1.5 block text-[13px] font-semibold">Nome completo</label>
            <div className="mb-4 rounded-lg border border-border bg-background px-3.5 py-3 text-sm text-muted-foreground">
              Digite seu nome
            </div>
            <label className="mb-1.5 block text-[13px] font-semibold">WhatsApp</label>
            <div className="mb-4 rounded-lg border border-border bg-background px-3.5 py-3 text-sm text-muted-foreground">
              (17) 99773-3081
            </div>
            <label className="mb-1.5 block text-[13px] font-semibold">Resumo do seu caso</label>
            <div className="mb-4 rounded-lg border border-border bg-background px-3.5 pb-10 pt-3 text-sm text-muted-foreground">
              Conte resumidamente o que aconteceu…
            </div>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} w-full bg-gold text-white hover:bg-[#a3741f]`}
            >
              Enviar e falar com a advogada
            </a>
            <p className="mt-3.5 text-center text-[11.5px] text-muted-foreground">
              🔒 Ao enviar, você concorda com o uso dos seus dados apenas para contato, conforme a
              LGPD.
            </p>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="bg-primary py-14 text-[#cfc8b8]">
        <div className="mx-auto max-w-[1140px] px-5 sm:px-6">
          <div className="grid gap-10 border-b border-white/10 pb-9 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
            <div>
              <img
                src="/logo.png"
                alt="Mara Sandra Vian Advocacia"
                className="mb-4 h-14 w-auto object-contain brightness-0 invert"
              />
              <p className="max-w-xs text-sm">
                Advocacia especializada em Direito Previdenciário. Atendimento humano e online em
                São Paulo e Mato Grosso.
              </p>
            </div>
            <div>
              <h4 className="mb-4 text-[15px] font-semibold text-white">Navegação</h4>
              <ul className="grid gap-2.5">
                {NAV.slice(0, 4).map((n) => (
                  <li key={n.href}>
                    <a href={n.href} className="text-sm text-[#cfc8b8] hover:text-[#caa14e]">
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-4 text-[15px] font-semibold text-white">Acesso</h4>
              <ul className="grid gap-2.5">
                <li>
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1.5 text-sm text-[#cfc8b8] hover:text-[#caa14e]"
                  >
                    <Scale className="h-3.5 w-3.5" />
                    Portal do Parceiro
                  </Link>
                </li>
                <li>
                  <a href="#parceiro" className="text-sm text-[#cfc8b8] hover:text-[#caa14e]">
                    Seja parceiro
                  </a>
                </li>
                <li>
                  <a
                    href={WA_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#cfc8b8] hover:text-[#caa14e]"
                  >
                    Falar no WhatsApp
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-6 text-[12.5px] text-[#9c9686]">
            <span>
              © 2026 Mara Sandra Vian Advocacia — OAB/MT 22.928 • OAB/SP 439.016. Todos os direitos
              reservados.
            </span>
            <span>
              Conteúdo de caráter meramente informativo, conforme o Provimento 205/2021 da OAB.
            </span>
          </div>
        </div>
      </footer>

      {/* ===== WHATSAPP FLUTUANTE ===== */}
      <a
        href={WA_LINK}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-6 right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_10px_30px_-6px_rgba(37,211,102,.6)] transition-transform hover:scale-105"
      >
        <MessageCircle className="h-7 w-7" />
      </a>
    </div>
  );
}
