// CPF e senha do Meu INSS do cliente, como aparecem no caso (cabeçalho e aba
// Visão geral). Um lugar só para as duas telas:
//
//   - a senha é lida UMA vez por visita (`SenhaMeuInssProvider`): a RPC
//     get_senha_meu_inss decifra e grava a leitura na trilha, então revelar no
//     cabeçalho e depois no card não gera segunda leitura; quem troca a senha
//     chama `invalidar()` e os dois lugares esquecem a antiga juntos;
//   - o valor mora no provider do caso: saiu do caso, saiu da memória;
//   - interno e parceiro selecionam e copiam. A diferença é só o CPF do
//     parceiro, que fica mascarado até o olhinho.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { copiarTexto } from "@/lib/copiar";
import { maskCPF, maskCPFParceiro } from "@/lib/cpf";

// ---------------------------------------------------------------------------
// Senha: leitura única por visita
// ---------------------------------------------------------------------------

type Leitura = { ok: boolean; valor: string | null };

interface SenhaMeuInssCtx {
  carregando: boolean;
  /** Já foi lida nesta visita (valor null = cliente sem senha cadastrada). */
  carregada: boolean;
  valor: string | null;
  /** Lê pela RPC (com trilha) ou devolve o que já foi lido. Erro já avisa na tela. */
  carregar: () => Promise<Leitura>;
  copiar: () => Promise<void>;
  /** A senha mudou: esquece a guardada; a próxima leitura busca a nova. */
  invalidar: () => void;
}

const Ctx = createContext<SenhaMeuInssCtx | null>(null);

const NAO_LIDA = { carregada: false, valor: null as string | null };

export function SenhaMeuInssProvider(props: { clienteId: string; children: ReactNode }) {
  const { clienteId, children } = props;
  const [estado, setEstado] = useState(NAO_LIDA);
  const [carregando, setCarregando] = useState(false);
  // Espelhos para as funções estáveis: o estado do render pode estar atrasado
  // entre dois cliques seguidos.
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const emCurso = useRef<Promise<Leitura> | null>(null);
  // Sobe a cada invalidação: resposta de leitura que começou antes é descartada.
  const versao = useRef(0);

  const invalidar = useCallback(() => {
    versao.current += 1;
    emCurso.current = null;
    estadoRef.current = NAO_LIDA;
    setEstado(NAO_LIDA);
    setCarregando(false);
  }, []);

  // Outro cliente na mesma tela: a senha guardada não é dele.
  useEffect(() => invalidar, [clienteId, invalidar]);

  const carregar = useCallback((): Promise<Leitura> => {
    if (estadoRef.current.carregada) {
      return Promise.resolve({ ok: true, valor: estadoRef.current.valor });
    }
    if (emCurso.current) return emCurso.current;
    const v = versao.current;
    setCarregando(true);
    const leitura = (async (): Promise<Leitura> => {
      try {
        const resp = await supabase.rpc("get_senha_meu_inss", { p_cliente_id: clienteId });
        if (resp.error) throw resp.error;
        const valor = (resp.data as string | null) ?? null;
        if (v !== versao.current) return { ok: false, valor: null };
        const lida = { carregada: true, valor };
        estadoRef.current = lida;
        setEstado(lida);
        return { ok: true, valor };
      } catch (err) {
        console.error(err);
        if (v === versao.current) {
          toast.error((err as { message?: string }).message || "Erro ao decifrar senha");
        }
        return { ok: false, valor: null };
      } finally {
        if (v === versao.current) {
          emCurso.current = null;
          setCarregando(false);
        }
      }
    })();
    emCurso.current = leitura;
    return leitura;
  }, [clienteId]);

  const copiar = useCallback(async () => {
    const r = await carregar();
    if (!r.ok) return;
    if (r.valor === null) {
      toast.error("Este cliente não tem senha do MEU INSS cadastrada");
      return;
    }
    await copiarTexto(r.valor, "Senha copiada");
  }, [carregar]);

  const valor = useMemo<SenhaMeuInssCtx>(
    () => ({ carregando, ...estado, carregar, copiar, invalidar }),
    [carregando, estado, carregar, copiar, invalidar],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSenhaMeuInss(): SenhaMeuInssCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSenhaMeuInss fora do SenhaMeuInssProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Peças de tela
// ---------------------------------------------------------------------------

/** CPF + copiar (só dígitos). Parceiro vê mascarado até clicar no olhinho. */
export function CpfCliente(props: { cpf: string; isInterno: boolean; className?: string }) {
  const { cpf, isInterno, className } = props;
  const [visivel, setVisivel] = useState(false);
  const completo = isInterno || visivel;
  return (
    <>
      <span className={className}>{completo ? maskCPF(cpf) : maskCPFParceiro(cpf)}</span>
      {!isInterno && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => setVisivel((v) => !v)}
          title={visivel ? "Ocultar CPF" : "Ver CPF completo"}
        >
          {visivel ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        onClick={() => void copiarTexto(cpf.replace(/\D/g, ""), "CPF copiado")}
        title="Copiar CPF"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

const VARIANTES = {
  // cabeçalho do caso: tudo numa linha, com os pontinhos enquanto escondida
  linha: { botao: "ghost", classe: "h-6 w-6 p-0", texto: "font-mono", pontos: true },
  // card "Dados do cliente": escondida não ocupa espaço
  card: { botao: "outline", classe: "h-7 w-7 p-0", texto: "text-sm font-mono truncate", pontos: false },
} as const;

/** Senha (escondida por padrão) + olhinho + copiar. Quem decide SE aparece é quem chama. */
export function SenhaMeuInss(props: { variante: keyof typeof VARIANTES }) {
  const v = VARIANTES[props.variante];
  const senha = useSenhaMeuInss();
  const [visivel, setVisivel] = useState(false);
  const mostrando = visivel && senha.carregada;

  // Senha trocada (ou outro cliente): volta a ficar escondida até pedirem de novo.
  useEffect(() => {
    if (!senha.carregada) setVisivel(false);
  }, [senha.carregada]);

  async function alternar() {
    if (mostrando) {
      setVisivel(false);
      return;
    }
    const r = await senha.carregar();
    if (r.ok) setVisivel(true);
  }

  return (
    <>
      {mostrando ? (
        senha.valor !== null ? (
          <span className={v.texto}>{senha.valor}</span>
        ) : (
          <span className="text-xs text-muted-foreground italic">não cadastrada</span>
        )
      ) : (
        v.pontos && <span className="font-mono tracking-widest text-muted-foreground">••••••</span>
      )}
      <Button
        size="sm"
        variant={v.botao}
        className={v.classe}
        onClick={alternar}
        disabled={senha.carregando}
        title={mostrando ? "Ocultar senha" : "Ver senha"}
      >
        {senha.carregando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : mostrando ? (
          <EyeOff className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        size="sm"
        variant={v.botao}
        className={v.classe}
        onClick={() => void senha.copiar()}
        disabled={senha.carregando}
        title="Copiar senha"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}
