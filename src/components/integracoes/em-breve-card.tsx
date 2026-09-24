// Card "Em breve": funcionalidade desligada na tela por decisão (2026-09-23),
// sem apagar o que existe por baixo. Usado em Webhooks (a aba fica, o módulo
// não é oferecido) e no envio de WhatsApp pelo sistema (fila pausada; a saída
// vai virar function, sem n8n, quando for retomada).
import type { ComponentType } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function EmBreveCard(props: {
  titulo: string;
  descricao: string;
  icone: ComponentType<{ className?: string }>;
  marcador: string;
}) {
  const Icone = props.icone;
  return (
    <Card data-em-breve={props.marcador}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icone className="h-4 w-4" />
          {props.titulo}
          <Badge variant="secondary" className="ml-1">
            Em breve
          </Badge>
        </CardTitle>
        <CardDescription>{props.descricao}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Esta parte ainda não está disponível. Quando entrar no ar, aparece aqui, sem mudar nada do que você já usa.
        </p>
      </CardContent>
    </Card>
  );
}
