// Telefone com país: um seletor de país (Brasil por padrão) e o número ao lado.
// No Brasil o número ganha a máscara de DDD enquanto a pessoa digita —
// "(17) 99999-9999"; nos outros países são só os dígitos. O valor que sai
// (`onChange`) já é o que o servidor entende: no Brasil o número com DDD, fora
// "+34 613761609"; campo vazio é "".
//
// O país é estado do campo: quem usa remonta (prop `key`) para voltar ao Brasil.
import { useState } from "react";
import { DDI_BRASIL, mascararTelefoneDoPais, PAISES_TELEFONE, telefoneParaEnvio } from "@/lib/telefone";
import { Input } from "@/components/ui/input";
import { Selecao, type OpcaoSelecao } from "@/components/ui/selecao";

const OPCOES: Array<OpcaoSelecao> = PAISES_TELEFONE.map((p) => ({
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
    <span className="flex items-center gap-1.5">
      <span aria-hidden>{p.bandeira}</span>
      <span>+{p.ddi}</span>
    </span>
  ),
}));

export function TelefoneComPais(props: {
  id?: string;
  /** Chamado com o telefone pronto para o servidor ("" = vazio). */
  onChange: (telefone: string) => void;
  /** O que aparece no campo vazio (ex.: o telefone do cadastro). */
  placeholder?: string;
  disabled?: boolean;
}) {
  const [ddi, setDdi] = useState(DDI_BRASIL);
  const [numero, setNumero] = useState("");

  function mudar(novoDdi: string, digitado: string) {
    const mascarado = mascararTelefoneDoPais(novoDdi, digitado);
    setDdi(novoDdi);
    setNumero(mascarado);
    props.onChange(telefoneParaEnvio(novoDdi, mascarado));
  }

  return (
    <div className="flex gap-2" data-telefone-com-pais>
      <div className="w-[8rem] shrink-0">
        <Selecao
          opcoes={OPCOES}
          value={ddi}
          // trocar de país refaz a máscara do que já foi digitado
          onChange={(novo) => mudar(novo, numero)}
          busca
          buscaPlaceholder="Buscar país"
          larguraLista="17rem"
          aria-label="País do telefone"
          disabled={props.disabled}
          data-selecao="telefone-pais"
        />
      </div>
      <Input
        id={props.id}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        value={numero}
        onChange={(e) => mudar(ddi, e.target.value)}
        placeholder={props.placeholder ?? (ddi === DDI_BRASIL ? "(00) 00000-0000" : "número com código de área")}
        disabled={props.disabled}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
