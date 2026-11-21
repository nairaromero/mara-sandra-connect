// "Gerar contrato pelo ZapSign" (#522): escolher um modelo de contrato da conta
// do ZapSign do escritório, conferir os campos (já preenchidos com o cadastro
// do cliente) e enviar para assinatura — sem sair do caso.
//
// Dois passos no mesmo diálogo:
//   1. ESCOLHER — todos os modelos da conta, achados rápido: busca pelo nome,
//      os sugeridos para o tipo de benefício do caso no topo e o resto agrupado
//      pela pasta do ZapSign;
//   2. PREENCHER — os campos do modelo, o contato do cliente e o tipo com que o
//      PDF assinado entra nos documentos do caso. O que o modelo define como
//      padrão (ex.: honorários de 35%) já vem preenchido e pode ser trocado; o
//      extenso do número é escrito pelo sistema;
//   3. CONFERIR — o contrato já preenchido, com cada valor destacado, antes de
//      qualquer coisa ir ao ZapSign.
// Quem escreve é a function `zapsign-enviar`; daqui em diante o fluxo é o mesmo
// do envio de um arquivo (tarefas, painel de assinaturas, PDF assinado).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, FileSignature, Folder, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { chamarZapsign, detalharModeloZapsign, listarModelosZapsign, textoDoModeloZapsign, type CampoDoModelo, type ModeloZapsign } from "@/lib/assinaturas";
import { ESTADOS_CIVIS, faixaDoCampo, NACIONALIDADES, type OrigemDoValor, type ParagrafoDoContrato, type PartesDaQualificacao, partesDoCadastro, previaDoContrato, PROFISSOES, qualificacaoDe, respostasDoModelo } from "@shared/modelo-contrato";
import { filtrarModelos, modelosSugeridos, porPasta } from "@/lib/assinaturas-modelos";
import { TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Selecao } from "@/components/ui/selecao";
import { Textarea } from "@/components/ui/textarea";
import { TelefoneComPais } from "@/components/telefone-com-pais";
import { AvisoDoEnvio } from "@/components/assinaturas/assinaturas-caso";
import { formatarTelefone, telefoneCompleto } from "@/lib/telefone";

interface Detalhe {
  modelo: ModeloZapsign;
  campos: Array<CampoDoModelo>;
  cliente: { nome: string; email: string; telefone: string; cpf: string; endereco: string };
}

export function GerarContratoDialog(props: {
  aberto: boolean;
  casoId: string;
  /** Tipo de benefício do caso: é dele que saem os modelos sugeridos. */
  tipoBeneficio: string | null;
  onFechar: () => void;
  onEnviado: () => void;
}) {
  const { aberto, casoId, tipoBeneficio, onFechar, onEnviado } = props;
  const [modelos, setModelos] = useState<Array<ModeloZapsign> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("contrato_honorarios");
  const [enviando, setEnviando] = useState(false);
  // O texto do modelo aberto (campos por preencher), lido UMA vez: conferir de novo não volta ao ZapSign.
  const [texto, setTexto] = useState<Array<ParagrafoDoContrato> | null>(null);
  // false = preenchendo; true = conferindo o contrato montado
  const [conferindo, setConferindo] = useState(false);
  const [montando, setMontando] = useState(false);
  // Qual pedido de "abrir modelo" ainda vale. A leitura vai ao ZapSign e demora:
  // sem isto, a resposta atrasada do modelo A trocava o modelo B que a pessoa
  // já estava preenchendo (ou abria sozinha um diálogo fechado e reaberto).
  const pedidoDeModelo = useRef(0);

  // Cada abertura começa na lista, lida de novo (o modelo criado agora no ZapSign já aparece).
  useEffect(() => {
    pedidoDeModelo.current++; // abrir ou fechar descarta o modelo que ainda estava chegando
    if (!aberto) return;
    let vivo = true;
    setModelos(null);
    setErro(null);
    setBusca("");
    setDetalhe(null);
    setTexto(null);
    setConferindo(false);
    setAbrindo(null);
    listarModelosZapsign().then(
      (lista) => vivo && setModelos(lista),
      (e: unknown) => vivo && setErro(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      vivo = false;
    };
  }, [aberto]);

  const achados = useMemo(() => filtrarModelos(modelos ?? [], busca), [modelos, busca]);
  // com busca digitada a lista já é curta: a sugestão só aparece na lista inteira
  const sugeridos = useMemo(() => (busca.trim() ? [] : modelosSugeridos(modelos ?? [], tipoBeneficio)), [modelos, busca, tipoBeneficio]);
  const grupos = useMemo(() => porPasta(achados), [achados]);

  async function escolher(m: ModeloZapsign) {
    const pedido = ++pedidoDeModelo.current;
    setAbrindo(m.token);
    try {
      const d = await detalharModeloZapsign(casoId, m.token);
      if (pedido !== pedidoDeModelo.current) return;
      setRespostas(Object.fromEntries(d.campos.map((c) => [c.variavel, c.sugestao])));
      setEmail("");
      setTelefone("");
      setTipoDocumento("contrato_honorarios");
      setTexto(null);
      setConferindo(false);
      setDetalhe(d);
    } catch (e) {
      if (pedido === pedidoDeModelo.current) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (pedido === pedidoDeModelo.current) setAbrindo(null);
    }
  }

  async function enviar() {
    if (!detalhe) return;
    setEnviando(true);
    try {
      const cliente: Record<string, string> = {};
      if (email.trim()) cliente.email = email.trim();
      if (telefone.trim()) cliente.telefone = telefone.trim();
      const { aviso } = await chamarZapsign({
        action: "enviar_modelo",
        caso_id: casoId,
        modelo_token: detalhe.modelo.token,
        respostas,
        tipo_documento: tipoDocumento,
        ...(Object.keys(cliente).length ? { cliente } : {}),
      });
      toast.success("Contrato enviado para assinatura. O cliente recebe o link pelo ZapSign.");
      if (aviso) toast.warning(aviso);
      onEnviado();
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  async function conferir() {
    if (!detalhe) return;
    if (texto) return setConferindo(true);
    const pedido = pedidoDeModelo.current;
    setMontando(true);
    try {
      const lido = await textoDoModeloZapsign(casoId, detalhe.modelo.token);
      if (pedido !== pedidoDeModelo.current) return;
      setTexto(lido);
      setConferindo(true);
    } catch (e) {
      if (pedido === pedidoDeModelo.current) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMontando(false);
    }
  }

  // A MESMA conta que o servidor refaz no envio: o valor de cada campo (com o
  // extenso escrito pelo sistema) e o que impede o envio.
  const conta = useMemo(() => respostasDoModelo(detalhe?.campos ?? [], respostas), [detalhe, respostas]);
  const valores = useMemo(() => new Map(conta.respostas.map((r) => [r.variavel, r.valor])), [conta]);
  const valorDe = (variavel: string) => valores.get(variavel) ?? "";
  // o contrato montado com os MESMOS valores que vão ao ZapSign (null = preenchendo)
  const previa = useMemo(() => (conferindo && texto ? previaDoContrato(texto, conta.respostas) : null), [conferindo, texto, conta]);
  // o que o sistema escreve sozinho (o extenso, o benefício repetido) não vira campo
  const visiveis = detalhe ? detalhe.campos.filter((c) => !c.extensoDe && !c.copiaDe) : [];
  // campo → o campo que o sistema escreve a partir dele (ex.: o percentual por extenso)
  const extensoDe = useMemo(() => new Map((detalhe?.campos ?? []).filter((c) => c.extensoDe).map((c) => [c.extensoDe!, c.variavel])), [detalhe]);

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && !enviando && onFechar()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl" data-dialog-modelos>
        <DialogHeader>
          <DialogTitle>{detalhe ? detalhe.modelo.nome : "Gerar contrato pelo ZapSign"}</DialogTitle>
          <DialogDescription>
            {previa
              ? "É assim que o contrato vai ao cliente. O que foi preenchido está destacado. Nada foi enviado ainda."
              : detalhe
              ? "Confira os campos: o que o cadastro do cliente e o próprio modelo já sabem veio preenchido. Antes de enviar, veja o contrato montado."
              : "Escolha o modelo do serviço que será prestado. São os modelos da conta do ZapSign deste escritório."}
          </DialogDescription>
        </DialogHeader>

        {!detalhe ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pelo nome do modelo ou da pasta"
                aria-label="Buscar modelo"
                className="pl-9"
                data-busca-modelo
              />
            </div>
            {erro && <p className="text-sm text-red-700">Não consegui ler os modelos: {erro}</p>}
            {modelos === null && !erro && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo os modelos do ZapSign…
              </div>
            )}
            {modelos !== null && (
              <>
                <p className="text-xs text-muted-foreground" data-contagem-modelos>
                  {busca.trim() ? `${achados.length} de ${modelos.length} modelos` : `${modelos.length} ${modelos.length === 1 ? "modelo" : "modelos"}`}
                </p>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {modelos.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      A conta do ZapSign ainda não tem modelo de contrato. Crie um no ZapSign (Modelos → Criar modelo, em DOCX) e ele aparece aqui.
                    </p>
                  )}
                  {modelos.length > 0 && achados.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">Nenhum modelo com “{busca.trim()}”.</p>
                  )}
                  {sugeridos.length > 0 && (
                    <section data-modelos-sugeridos>
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5" /> Sugeridos para {tipoBeneficio}
                      </h3>
                      <ListaDeModelos modelos={sugeridos} abrindo={abrindo} onEscolher={escolher} mostrarPasta />
                    </section>
                  )}
                  {grupos.map((g) => (
                    <section key={g.pasta} data-modelos-pasta={g.pasta}>
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Folder className="h-3.5 w-3.5" /> {g.rotulo} <span className="font-normal">({g.modelos.length})</span>
                      </h3>
                      <ListaDeModelos modelos={g.modelos} abrindo={abrindo} onEscolher={escolher} />
                    </section>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
          {previa && <PreviaDoContrato paragrafos={previa} />}
          {/* Na prévia os campos só somem da vista: desmontar apagaria o que foi escolhido nas listas (estado civil, profissão). */}
          <div className={previa ? "hidden" : "min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"} data-campos-modelo>
            {visiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este modelo não tem campo para preencher.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {visiveis.map((c) => (
                  <CampoDoContrato
                    key={`${detalhe.modelo.token}:${c.variavel}`}
                    campo={c}
                    cliente={detalhe.cliente}
                    valor={respostas[c.variavel] ?? ""}
                    onChange={(v) => setRespostas((r) => ({ ...r, [c.variavel]: v }))}
                    extenso={extensoDe.has(c.variavel) ? valorDe(extensoDe.get(c.variavel)!) : null}
                    valorFinal={valorDe(c.variavel)}
                  />
                ))}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium">Quem assina: {detalhe.cliente.nome}</p>
              <p className="text-xs text-muted-foreground">
                Em branco, vale o e-mail e o WhatsApp do cadastro. Preencha só para mandar a outro contato desta vez.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="modelo-email">E-mail</Label>
                  <Input id="modelo-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={detalhe.cliente.email || "sem e-mail no cadastro"} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="modelo-telefone">WhatsApp</Label>
                  {/* remonta a cada modelo aberto: o país volta ao Brasil */}
                  <TelefoneComPais
                    key={detalhe.modelo.token}
                    id="modelo-telefone"
                    value={telefone}
                    onChange={setTelefone}
                    placeholder={detalhe.cliente.telefone ? formatarTelefone(detalhe.cliente.telefone) : "sem telefone no cadastro"}
                  />
                </div>
              </div>
              {!telefone && detalhe.cliente.telefone && !telefoneCompleto(detalhe.cliente.telefone) && (
                <p className="text-xs text-amber-700" data-telefone-do-cadastro-invalido>
                  O telefone do cadastro ({detalhe.cliente.telefone}) não serve para WhatsApp: sem outro número aqui, o
                  link vai só por e-mail.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="modelo-tipo">O PDF assinado entra no caso como</Label>
              <Selecao id="modelo-tipo" opcoes={TIPOS_DOCUMENTO_OPTIONS} value={tipoDocumento} onChange={setTipoDocumento} />
            </div>
            <AvisoDoEnvio />
          </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {previa ? (
            <Button variant="ghost" onClick={() => setConferindo(false)} disabled={enviando} data-voltar-aos-campos>
              <ArrowLeft className="mr-2 h-4 w-4" /> Corrigir os campos
            </Button>
          ) : detalhe ? (
            <Button variant="ghost" onClick={() => setDetalhe(null)} disabled={enviando || montando}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Outro modelo
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onFechar} disabled={enviando}>
              Cancelar
            </Button>
            {detalhe && !previa && (
              <Button variant="outline" onClick={conferir} disabled={montando || enviando} data-conferir-contrato>
                {montando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                Conferir o contrato
              </Button>
            )}
            {detalhe && (
              <Button onClick={enviar} disabled={enviando || montando || conta.erros.length > 0} title={conta.erros.length ? conta.erros.join(" ") : undefined} data-enviar-modelo>
                {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSignature className="mr-2 h-4 w-4" />}
                Enviar para assinatura
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListaDeModelos(props: {
  modelos: ReadonlyArray<ModeloZapsign>;
  abrindo: string | null;
  onEscolher: (m: ModeloZapsign) => void;
  /** Na seção de sugeridos o modelo vem fora da pasta dele: mostra de qual é. */
  mostrarPasta?: boolean;
}) {
  return (
    <ul className="divide-y rounded-md border">
      {props.modelos.map((m) => (
        <li key={m.token}>
          <button
            type="button"
            onClick={() => props.onEscolher(m)}
            disabled={props.abrindo !== null}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-60"
            data-modelo={m.token}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FileSignature className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 font-medium">{m.nome}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {props.mostrarPasta && m.pasta !== "/" && <Badge variant="secondary">{m.pasta.replace(/^\/+|\/+$/g, "")}</Badge>}
              {props.abrindo === m.token && <Loader2 className="h-4 w-4 animate-spin" />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Um campo do modelo. Número (percentual, quantidade) tem a faixa do modelo e
 * mostra como o contrato vai escrever; texto cresce com o que se digita, para
 * caber uma cláusula inteira.
 */
function CampoDoContrato(props: {
  campo: CampoDoModelo;
  cliente: { nome: string; cpf: string; endereco: string };
  valor: string;
  onChange: (v: string) => void;
  /** como o sistema escreve este valor por extenso; null = o modelo não pede extenso */
  extenso: string | null;
  /** o valor como vai ao contrato (ex.: "30" digitado vira "30%") */
  valorFinal: string;
}) {
  const { campo: c, valor, onChange, extenso, valorFinal } = props;
  if (c.especie === "qualificacao") return <CampoQualificacao campo={c} cliente={props.cliente} valor={valor} onChange={onChange} />;
  const numero = c.tipo !== "texto";
  // de onde veio o valor que já está no campo — quem diz é o servidor (`origem`), não o nome do campo
  const origem = valor && valor === c.sugestao ? ROTULO_DA_ORIGEM[c.origem] : "";
  const padrao = !c.padrao ? "" : valorFinal === c.padrao ? "padrão do modelo" : `padrão do modelo: ${c.padrao}`;
  const faixa = faixaDoCampo(c);
  // o modelo chama de "objeto do serviço" ou "benefício ou serviço"; para quem preenche é o benefício
  const rotulo = c.especie === "beneficio" ? "Benefício" : c.rotulo;
  return (
    <div className={numero ? "space-y-1" : "space-y-1 sm:col-span-2"} data-campo={c.variavel}>
      <Label htmlFor={`campo-${c.variavel}`}>
        {rotulo}
        {c.obrigatorio && <span className="text-red-600"> *</span>}
        {origem && <span className="ml-2 text-xs font-normal text-muted-foreground">{origem}</span>}
      </Label>
      {numero ? (
        <Input id={`campo-${c.variavel}`} inputMode="decimal" value={valor} onChange={(e) => onChange(e.target.value)} />
      ) : c.opcoes.length > 0 ? (
        <EscolhaOuTexto id={`campo-${c.variavel}`} opcoes={c.opcoes} value={valor} onChange={onChange} rotulo={rotulo} />
      ) : (
        <Textarea
          id={`campo-${c.variavel}`}
          rows={1}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          // cresce com o texto (até um teto), sem barra de rolagem para uma linha
          className="min-h-9 resize-none [field-sizing:content] max-h-48"
        />
      )}
      {extenso !== null && valorFinal && (
        <p className="text-xs text-muted-foreground" data-extenso>
          No contrato: <span className="font-medium text-foreground">{extenso ? `${valorFinal} (${extenso})` : valorFinal}</span>
        </p>
      )}
      {(c.ajuda || faixa || padrao) && (
        <p className="text-xs text-muted-foreground">
          {padrao && <span data-origem-do-valor>{padrao}</span>}
          {padrao && (c.ajuda || faixa) ? " · " : ""}
          {[c.ajuda, faixa && `aceita ${faixa}`].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** "modelo" não entra: o padrão do modelo já aparece embaixo do campo, com o valor. */
const ROTULO_DA_ORIGEM: Record<OrigemDoValor, string> = { cadastro: "do cadastro", caso: "do caso", hoje: "hoje", modelo: "", "": "" };

const OUTRO = "__outro__";

/**
 * Escolher numa lista em vez de digitar. "Outro…" abre o campo de texto para o
 * que a lista não tem — e o valor que já veio fora da lista abre direto nele.
 */
function EscolhaOuTexto(props: { id?: string; opcoes: ReadonlyArray<string>; value: string; onChange: (v: string) => void; rotulo: string }) {
  const { opcoes, value, onChange } = props;
  const [escrevendo, setEscrevendo] = useState(() => !!value && !opcoes.includes(value));
  if (escrevendo) {
    return (
      <div className="flex gap-2">
        <Input id={props.id} autoFocus={!value} value={value} onChange={(e) => onChange(e.target.value)} aria-label={props.rotulo} />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => {
            setEscrevendo(false);
            if (!opcoes.includes(value)) onChange("");
          }}
        >
          Lista
        </Button>
      </div>
    );
  }
  return (
    <Selecao
      id={props.id}
      aria-label={props.rotulo}
      placeholder="Escolher"
      opcoes={[...opcoes.map((o) => ({ value: o, label: o })), { value: OUTRO, label: "Outro… (escrever)" }]}
      value={value || undefined}
      onChange={(v) => {
        if (v !== OUTRO) return onChange(v);
        onChange("");
        setEscrevendo(true);
      }}
    />
  );
}

/**
 * A qualificação do contratante sem digitar a frase: nome, CPF e endereço vêm
 * do cadastro; nacionalidade, estado civil e profissão se escolhem em lista. O
 * sistema escreve a frase (`qualificacaoDe`) e mostra como vai ao contrato.
 */
function CampoQualificacao(props: { campo: CampoDoModelo; cliente: { nome: string; cpf: string; endereco: string }; valor: string; onChange: (v: string) => void }) {
  const { campo: c, cliente, valor, onChange } = props;
  // as MESMAS partes de que o servidor montou a frase que já está em `valor`
  const [p, setP] = useState<PartesDaQualificacao>(() => partesDoCadastro(cliente));
  const mudar = (parte: Partial<PartesDaQualificacao>) => {
    const novo = { ...p, ...parte };
    setP(novo);
    onChange(qualificacaoDe(novo));
  };
  const id = `campo-${c.variavel}`;
  return (
    <fieldset className="space-y-2 rounded-md border p-3 sm:col-span-2" data-campo={c.variavel} data-qualificacao>
      <legend className="px-1 text-sm font-medium">
        {c.rotulo}
        {c.obrigatorio && <span className="text-red-600"> *</span>}
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1" data-parte="nacionalidade">
          <Label htmlFor={`${id}-nac`}>Nacionalidade</Label>
          <EscolhaOuTexto id={`${id}-nac`} rotulo="Nacionalidade" opcoes={NACIONALIDADES} value={p.nacionalidade} onChange={(v) => mudar({ nacionalidade: v })} />
        </div>
        <div className="space-y-1" data-parte="estado-civil">
          <Label htmlFor={`${id}-civil`}>Estado civil</Label>
          <EscolhaOuTexto id={`${id}-civil`} rotulo="Estado civil" opcoes={ESTADOS_CIVIS} value={p.estadoCivil} onChange={(v) => mudar({ estadoCivil: v })} />
        </div>
        <div className="space-y-1" data-parte="profissao">
          <Label htmlFor={`${id}-prof`}>Profissão</Label>
          <EscolhaOuTexto id={`${id}-prof`} rotulo="Profissão" opcoes={PROFISSOES} value={p.profissao} onChange={(v) => mudar({ profissao: v })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-rg`}>RG</Label>
          <Input id={`${id}-rg`} value={p.rg} onChange={(e) => mudar({ rg: e.target.value })} placeholder="opcional" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${id}-end`}>
            Endereço
            {p.endereco && p.endereco === cliente.endereco && <span className="ml-2 text-xs font-normal text-muted-foreground">do cadastro</span>}
          </Label>
          <Input id={`${id}-end`} value={p.endereco} onChange={(e) => mudar({ endereco: e.target.value })} placeholder="sem endereço no cadastro" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-qualificacao-texto>
        No contrato: <span className="font-medium text-foreground">{valor || "—"}</span>
      </p>
    </fieldset>
  );
}

/** O contrato montado: texto exato, com negrito e títulos; a aparência final (fonte, margens) é a do PDF do ZapSign. */
function PreviaDoContrato(props: { paragrafos: ReadonlyArray<ParagrafoDoContrato> }) {
  const vazios = props.paragrafos.reduce((n, p) => n + p.trechos.filter((t) => t.marca === "vazio").length, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-previa-contrato>
      {vazios > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-previa-vazios>
          {vazios === 1 ? "1 campo vai em branco" : `${vazios} campos vão em branco`} no contrato (marcados em amarelo). Se não era a intenção, volte e preencha.
        </p>
      )}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-md border bg-white px-6 py-5 text-[13px] leading-relaxed text-neutral-900">
        {props.paragrafos.map((p, i) => (
          <p key={i} className={p.centro ? "whitespace-pre-wrap text-center" : "whitespace-pre-wrap text-justify"}>
            {p.trechos.map((t, j) => (
              <span
                key={j}
                data-trecho={t.marca}
                className={[t.n ? "font-semibold" : "", t.marca === "preenchido" ? "rounded bg-emerald-100 px-0.5" : "", t.marca === "vazio" ? "rounded bg-amber-200 px-0.5 italic" : ""].join(" ")}
              >
                {t.t}
              </span>
            ))}
          </p>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">O texto é o do modelo. Fonte, margens e quebra de página são as do PDF que o ZapSign gera.</p>
    </div>
  );
}
