// Telefone com país: a caixa do país (Brasil por padrão) e o número ao lado.
// É O campo de telefone do sistema — todo formulário usa este.
//
// No Brasil o número ganha a máscara de DDD enquanto a pessoa digita —
// "(17) 99999-9999"; nos outros países são só os dígitos. O valor (`value` /
// `onChange`) é o que se guarda e o que o servidor entende: no Brasil o número
// com DDD, fora "+34 613761609"; campo vazio é "".
//
// `somenteBrasil`: o país fica fixo. É para o telefone de PARCEIRO, que o
// WhatsApp do sistema usa para reconhecer quem escreveu — e ele só casa número
// brasileiro (`whatsapp_canon_br`). Oferecer outro país ali seria convidar a um
// cadastro que não funciona.
import { useState } from "react";
import { DDI_BRASIL, mascararTelefoneDoPais, PAISES_TELEFONE, separarTelefone, telefoneParaEnvio } from "@/lib/telefone";
import { Input } from "@/components/ui/input";
import { Selecao, type OpcaoSelecao } from "@/components/ui/selecao";
import { cn } from "@/lib/utils";

const opcaoDe = (p: { ddi: string; nome: string; bandeira: string }): OpcaoSelecao => ({
  value: p.ddi,
  // a busca procura no rótulo: nome e código
  label: `${p.nome} +${p.ddi}`,
  // na lista: bandeira, nome e código; no botão (estreito): só bandeira e código
  conteudo: (
    <span className="flex items-center gap-2">
      <span aria-hidden>{p.bandeira}</span>
      <span>{p.nome}</span>
      <span className="text-muted-foreground">+{p.ddi}</span>
    </span>
  ),
  noBotao: (
    <span className="flex items-center gap-1">
      <span aria-hidden>{p.bandeira}</span>
      <span>+{p.ddi}</span>
    </span>
  ),
});
const OPCOES: Array<OpcaoSelecao> = PAISES_TELEFONE.map(opcaoDe);

export function TelefoneComPais(props: {
  id?: string;
  /** O telefone como está guardado: "(17) 99999-0000", "17999990000" ou "+34 613761609". */
  value: string;
  /** Chamado com o telefone pronto para guardar/enviar ("" = vazio). */
  onChange: (telefone: string) => void;
  /** O que aparece no campo vazio (ex.: o telefone do cadastro). */
  placeholder?: string;
  disabled?: boolean;
  /** País fixo no Brasil (telefone de parceiro: ver o cabeçalho). */
  somenteBrasil?: boolean;
  onBlur?: () => void;
  /** Preenchimento automático do navegador ("tel" no formulário público). Padrão: desligado. */
  autoComplete?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** Classe do campo do número (formulários com estilo próprio). */
  className?: string;
}) {
  const guardado = separarTelefone(props.value);
  // o país escolhido enquanto o campo está vazio (com número, quem manda é o valor)
  const [ddiVazio, setDdiVazio] = useState(guardado.ddi);
  const ddi = props.somenteBrasil ? DDI_BRASIL : guardado.numero ? guardado.ddi : ddiVazio;
  // país que veio do banco e não está na lista continua aparecendo (e escolhível)
  const opcoes = OPCOES.some((o) => o.value === ddi) ? OPCOES : [...OPCOES, opcaoDe({ ddi, nome: "Outro país", bandeira: "🌐" })];

  const emitir = (novoDdi: string, digitado: string) => props.onChange(telefoneParaEnvio(novoDdi, mascararTelefoneDoPais(novoDdi, digitado)));
  /**
   * O que a pessoa pôs no campo do número. Digitando, vale o país da caixa.
   * COLANDO (ou vindo do preenchimento automático do navegador) um número que
   * já traz o código do país — "+55 17 99999-0000", "5517999990000",
   * "+34 613761609" — o código sai do número e, se for de outro país, a caixa
   * muda junto. Sem isso o "55" virava DDD e o campo aceitava "(55) 17999-9900".
   * Colar = o texto ganhou mais de um dígito de uma vez.
   */
  const aoMudarNumero = (texto: string) => {
    const digitos = texto.replace(/\D/g, "");
    const comMais = texto.trim().startsWith("+");
    const colou = digitos.length - guardado.numero.replace(/\D/g, "").length > 1 && digitos.length > 11;
    if (!comMais && !colou) return emitir(ddi, texto);
    const lido = separarTelefone(texto);
    // Sem o "+", só troca de país com certeza: abre com o 55, ou com o código de
    // um país da lista. Número comprido de outro país (12 dígitos num campo da
    // Alemanha) continua sendo do país da caixa.
    if (!comMais && !digitos.startsWith(DDI_BRASIL) && lido.ddi === DDI_BRASIL) return emitir(ddi, texto);
    // país fixo no Brasil: número de fora não entra (fica o que a máscara do Brasil fizer dele)
    if (props.somenteBrasil && lido.ddi !== DDI_BRASIL) return emitir(ddi, texto);
    emitir(lido.ddi, lido.numero);
  };

  return (
    <div className="flex gap-1.5" data-telefone-com-pais>
      {props.somenteBrasil ? (
        <span
          className="flex min-h-9 shrink-0 items-center gap-1 rounded-md border bg-muted/50 px-2 text-sm text-muted-foreground"
          title="Este telefone é usado pelo WhatsApp do sistema, que atende números do Brasil."
          data-telefone-pais-fixo
        >
          <span aria-hidden>🇧🇷</span>
          <span>+55</span>
        </span>
      ) : (
        <div className="shrink-0">
          <Selecao
            opcoes={opcoes}
            value={ddi}
            // trocar de país refaz a máscara do que já foi digitado
            onChange={(novo) => {
              setDdiVazio(novo);
              emitir(novo, guardado.numero);
            }}
            busca
            buscaPlaceholder="Buscar país"
            larguraLista="17rem"
            aria-label="País do telefone"
            disabled={props.disabled}
            // h-full: acompanha a altura do campo do número (formulários com campo mais alto)
            className="h-full min-h-9 gap-0 px-2"
            data-selecao="telefone-pais"
          />
        </div>
      )}
      <Input
        id={props.id}
        type="tel"
        inputMode="tel"
        autoComplete={props.autoComplete ?? "off"}
        value={ddi === guardado.ddi ? guardado.numero : mascararTelefoneDoPais(ddi, guardado.numero)}
        onChange={(e) => aoMudarNumero(e.target.value)}
        onBlur={props.onBlur}
        placeholder={props.placeholder ?? (ddi === DDI_BRASIL ? "(00) 00000-0000" : "número com código de área")}
        disabled={props.disabled}
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
        className={cn("min-w-0 flex-1", props.className)}
      />
    </div>
  );
}
