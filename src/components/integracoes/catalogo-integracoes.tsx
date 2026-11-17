// Catálogo de integrações (Configurações → Integrações): cada integração é uma
// linha — ícone e nome, o que ela faz, o estado NESTE escritório e o botão que
// abre a configuração ali mesmo. As linhas ficam em grupos que abrem e fecham.
//
// Antes eram oito cards grandes empilhados e todos abertos (≈4.500 px de
// página). O formulário de cada integração continua sendo o card que já
// existia: o catálogo só decide QUANDO ele aparece — e só monta o que está
// aberto, então a página não dispara mais oito consultas ao carregar.
import { useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useIntegracoesEscritorio, type IntegracaoStatus } from "@/hooks/use-integracoes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface ItemIntegracao {
  /** Vai para a URL (`?abrir=<id>`): estável. */
  id: string;
  nome: string;
  /** Uma frase: o que a integração faz para o escritório. */
  resumo: string;
  icone: ComponentType<{ className?: string }>;
  /** O `tipo` em `minhas_integracoes`, quando o estado vem de lá. Sem isto a linha não mostra estado. */
  tipo?: string;
  /** O formulário de configuração: montado só quando a linha está aberta. */
  conteudo: ReactNode;
}
export interface GrupoIntegracoes {
  id: string;
  titulo: string;
  descricao: string;
  itens: ReadonlyArray<ItemIntegracao>;
}

/** Valor de `?abrir=` que mostra todas as configurações de uma vez. */
export const ABRIR_TODAS = "todas";

type Estado = "ativa" | "desligada" | "sistema" | "nao_configurada";
const ROTULO_ESTADO: Record<Estado, string> = {
  ativa: "Ativa",
  desligada: "Desligada",
  sistema: "Configuração do sistema",
  nao_configurada: "Não configurada",
};
function estadoDe(lista: ReadonlyArray<IntegracaoStatus>, tipo: string): Estado {
  const i = lista.find((x) => x.tipo === tipo);
  if (!i || !i.configurada) return "nao_configurada";
  if (i.legado) return "sistema";
  return i.ativo ? "ativa" : "desligada";
}

export function CatalogoIntegracoes(props: {
  escritorioNome: string;
  grupos: ReadonlyArray<GrupoIntegracoes>;
  /** `id` da integração aberta, `ABRIR_TODAS` ou nada. Vem da URL. */
  aberta: string | undefined;
  onAbrir: (id: string | undefined) => void;
}) {
  const { grupos, aberta, onAbrir } = props;
  const integracoes = useIntegracoesEscritorio();
  const [recolhidos, setRecolhidos] = useState<ReadonlySet<string>>(new Set());
  const todas = aberta === ABRIR_TODAS;

  return (
    <Card data-catalogo-integracoes>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Integrações do escritório</CardTitle>
          <CardDescription>
            O que está ligado aqui vale só para <strong>{props.escritorioNome}</strong>: cada escritório tem as suas
            contas e as suas chaves.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 self-start" onClick={() => onAbrir(todas ? undefined : ABRIR_TODAS)} data-integracoes-todas>
          {todas ? "Fechar todas" : "Abrir todas"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {grupos.map((g) => {
          // o grupo da integração aberta nunca fica recolhido por cima dela
          const aberto = todas || g.itens.some((i) => i.id === aberta) || !recolhidos.has(g.id);
          return (
            <Collapsible
              key={g.id}
              open={aberto}
              onOpenChange={(abrir) =>
                setRecolhidos((atual) => {
                  const novo = new Set(atual);
                  if (abrir) novo.delete(g.id);
                  else novo.add(g.id);
                  return novo;
                })
              }
              data-integracoes-grupo={g.id}
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-left text-sm font-semibold hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <span>
                  {g.titulo} <span className="ml-1 font-normal text-muted-foreground">({g.itens.length})</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", aberto && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="px-3 pt-3 text-sm text-muted-foreground">{g.descricao}</p>
                <ul className="divide-y">
                  {g.itens.map((item) => (
                    <LinhaIntegracao
                      key={item.id}
                      item={item}
                      estado={item.tipo && integracoes.lista ? estadoDe(integracoes.lista, item.tipo) : null}
                      aberta={todas || aberta === item.id}
                      onAlternar={() => onAbrir(aberta === item.id ? undefined : item.id)}
                    />
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}

function LinhaIntegracao(props: { item: ItemIntegracao; estado: Estado | null; aberta: boolean; onAlternar: () => void }) {
  const { item, estado, aberta, onAlternar } = props;
  const Icone = item.icone;
  const painel = `integracao-${item.id}`;
  return (
    <li className="px-3 py-3" data-integracao-linha={item.id} data-integracao-aberta={aberta}>
      <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icone className="h-5 w-5" />
          </span>
          <span className="min-w-0 text-sm font-semibold leading-snug">{item.nome}</span>
        </div>
        <p className="text-sm text-muted-foreground">{item.resumo}</p>
        <div className="flex items-center gap-2 sm:justify-end">
          {estado && (
            <Badge variant={estado === "ativa" ? "default" : "secondary"} data-integracao-linha-estado={estado}>
              {ROTULO_ESTADO[estado]}
            </Badge>
          )}
          <Button
            size="sm"
            variant={aberta ? "outline" : "secondary"}
            onClick={onAlternar}
            aria-expanded={aberta}
            aria-controls={painel}
            data-integracao-abrir={item.id}
          >
            {aberta ? "Fechar" : estado === "nao_configurada" ? "Integrar" : "Configurar"}
          </Button>
        </div>
      </div>
      {aberta && (
        <div id={painel} className="mt-3 space-y-4 rounded-lg bg-muted/40 p-3">
          {item.conteudo}
        </div>
      )}
    </li>
  );
}
