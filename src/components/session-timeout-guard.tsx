import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import {
  CHECK_INTERVAL_MS,
  avaliarSessao,
  garantirInicioSessao,
  limparMarcadores,
  marcarAtividade,
  registrarMotivoLogout,
  type MotivoLogout,
} from "@/lib/auth/session-policy";

// Eventos que contam como "a pessoa está usando o sistema". mousemove ficou de
// fora de propósito: mouse tremendo na mesa ou notificação passando por cima do
// cursor não é uso, e manteria a sessão viva pra sempre.
const EVENTOS_ATIVIDADE = ["pointerdown", "keydown", "wheel", "touchstart", "submit"] as const;

// Não faz sentido escrever no localStorage a cada tecla digitada.
const THROTTLE_ATIVIDADE_MS = 5000;

/**
 * Aplica a política de expiração enquanto o usuário está logado: monta dentro
 * do layout autenticado, então não roda em /login nem na landing pública.
 */
export function SessionTimeoutGuard() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [restanteMs, setRestanteMs] = useState<number | null>(null);
  const avisoAtivoRef = useRef(false);
  const encerrandoRef = useRef(false);
  const ultimaEscritaRef = useRef(0);

  avisoAtivoRef.current = restanteMs !== null;

  const encerrar = useCallback(
    async (motivo: MotivoLogout) => {
      // signOut é async e o timer continua rodando: sem esse guard a sessão
      // seria encerrada várias vezes seguidas.
      if (encerrandoRef.current) return;
      encerrandoRef.current = true;
      registrarMotivoLogout(motivo);
      limparMarcadores();
      await signOut();
      navigate({ to: "/login" });
    },
    [signOut, navigate],
  );

  useEffect(() => {
    // Sem sessão não há o que vigiar — e é importante NÃO limpar marcadores
    // aqui: no primeiro render a sessão ainda não foi lida do localStorage, e
    // limpar zeraria o teto de 12h a cada reload da página. Quem limpa é o
    // signOut (use-auth) e o encerramento automático abaixo.
    if (!session) {
      encerrandoRef.current = false;
      setRestanteMs(null);
      return;
    }

    garantirInicioSessao();

    function aoInteragir() {
      // Durante o aviso, ignora atividade solta: sair do estado de alerta exige
      // clicar em "Continuar conectado". Senão um Esc ou um scroll por reflexo
      // renovaria a sessão sem a pessoa ler o que aconteceu.
      if (avisoAtivoRef.current) return;
      const agora = Date.now();
      if (agora - ultimaEscritaRef.current < THROTTLE_ATIVIDADE_MS) return;
      ultimaEscritaRef.current = agora;
      marcarAtividade(agora);
    }

    function verificar() {
      const estado = avaliarSessao();
      if (estado.situacao === "expirou") {
        void encerrar(estado.motivo);
        return;
      }
      setRestanteMs(estado.situacao === "avisar" ? estado.restanteMs : null);
    }

    for (const evt of EVENTOS_ATIVIDADE) {
      window.addEventListener(evt, aoInteragir, { passive: true, capture: true });
    }
    // Timer de aba em segundo plano é estrangulado pelo navegador (e para de
    // vez se a máquina dorme). Reavaliar ao voltar o foco é o que garante que
    // um notebook fechado à noite não reapareça logado de manhã.
    document.addEventListener("visibilitychange", verificar);
    window.addEventListener("focus", verificar);

    const id = window.setInterval(verificar, CHECK_INTERVAL_MS);
    verificar();

    return () => {
      for (const evt of EVENTOS_ATIVIDADE) {
        window.removeEventListener(evt, aoInteragir, { capture: true });
      }
      document.removeEventListener("visibilitychange", verificar);
      window.removeEventListener("focus", verificar);
      window.clearInterval(id);
    };
  }, [session, encerrar]);

  function continuarConectado() {
    const agora = Date.now();
    ultimaEscritaRef.current = agora;
    marcarAtividade(agora);
    setRestanteMs(null);
  }

  const segundos = restanteMs === null ? 0 : Math.max(0, Math.ceil(restanteMs / 1000));

  return (
    <AlertDialog open={restanteMs !== null}>
      <AlertDialogContent
        // Fechar no Esc / clique fora contaria como "continuar conectado" sem a
        // pessoa decidir nada — a escolha tem que ser explícita.
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-[var(--gold)]" />
            Sua sessão vai expirar
          </AlertDialogTitle>
          <AlertDialogDescription>
            Por segurança, o sistema encerra a sessão após 1 hora sem uso. Você será desconectado em{" "}
            <strong className="tabular-nums text-foreground">{segundos}s</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void encerrar("ociosidade")}>
            Sair agora
          </AlertDialogCancel>
          <AlertDialogAction onClick={continuarConectado}>Continuar conectado</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
