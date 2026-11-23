// A aba Integrações de Configurações: a lista das integrações do escritório,
// em grupos, para o catálogo. Integração nova entra AQUI (uma linha) e ganha o
// card de configuração em `conteudo`.
import { FileSignature, Mail, MessageCircle, Plug, Scale, Sparkles, Table2 } from "lucide-react";
import { ConexaoClaudeCard } from "@/components/ia/conexao-claude-card";
import { IntegracaoIaCard } from "@/components/ia/integracao-ia-card";
import { CatalogoIntegracoes, type GrupoIntegracoes } from "@/components/integracoes/catalogo-integracoes";
import { IntegracaoGmailCard } from "@/components/integracoes/integracao-gmail-card";
import { IntegracaoLegalmailCard } from "@/components/integracoes/integracao-legalmail-card";
import { IntegracaoTiCard } from "@/components/integracoes/integracao-ti-card";
import { IntegracaoWhatsappCard } from "@/components/integracoes/integracao-whatsapp-card";
import { IntegracaoZapsignCard } from "@/components/integracoes/integracao-zapsign-card";
import { ProcuradoresInssCard } from "@/components/integracoes/procuradores-inss-card";

const GRUPOS: ReadonlyArray<GrupoIntegracoes> = [
  {
    id: "ia",
    titulo: "Inteligência artificial",
    descricao: "A IA que lê documentos, sugere tarefas e responde no sistema, e a ligação com o Claude ou o ChatGPT de quem trabalha aqui.",
    itens: [
      {
        id: "ia", tipo: "ia", nome: "IA do escritório", icone: Sparkles,
        resumo: "A chave e o modelo que o sistema usa para ler documentos, triar andamentos e redigir mensagens.",
        conteudo: <IntegracaoIaCard />,
      },
      {
        id: "claude", nome: "Conectar Claude ou ChatGPT", icone: Plug,
        resumo: "Deixa o assistente de uma pessoa da equipe consultar os casos do escritório, com o acesso dela.",
        conteudo: <ConexaoClaudeCard />,
      },
    ],
  },
  {
    id: "comunicacao",
    titulo: "Comunicação",
    descricao: "Por onde chegam os e-mails do INSS e as mensagens dos parceiros.",
    itens: [
      {
        id: "gmail", nome: "Gmail (INSS)", icone: Mail,
        resumo: "As caixas de entrada que recebem os e-mails do INSS (uma ou mais); o sistema lê todas e cria andamentos e tarefas nos casos.",
        // o procurador é uma regra dessa mesma leitura de e-mails: mora junto
        conteudo: (
          <>
            <IntegracaoGmailCard />
            <ProcuradoresInssCard />
          </>
        ),
      },
      {
        id: "whatsapp", tipo: "whatsapp", nome: "WhatsApp (Evolution)", icone: MessageCircle,
        resumo: "A instância do Evolution do escritório: por ela chegam as mensagens dos parceiros e saem as respostas.",
        conteudo: <IntegracaoWhatsappCard />,
      },
    ],
  },
  {
    id: "processos",
    titulo: "Processos e andamentos",
    descricao: "Busca de processos e de clientes em outros sistemas, e a importação das movimentações para o caso.",
    itens: [
      {
        id: "legalmail", tipo: "legalmail", nome: "Legalmail", icone: Scale,
        resumo: "Busca processos pelo nome do cliente e importa as movimentações.",
        conteudo: <IntegracaoLegalmailCard />,
      },
      {
        id: "ti", tipo: "ti", nome: "Tramitação Inteligente", icone: Table2,
        resumo: "Busca clientes pelo nome e importa as notas para o caso.",
        conteudo: <IntegracaoTiCard />,
      },
    ],
  },
  {
    id: "assinatura",
    titulo: "Assinatura e documentos",
    descricao: "Contrato e procuração assinados pelo cliente sem sair do caso.",
    itens: [
      {
        id: "zapsign", tipo: "zapsign", nome: "ZapSign", icone: FileSignature,
        resumo: "Envia o documento do caso para assinatura e traz o PDF assinado de volta, com as tarefas de acompanhamento.",
        conteudo: <IntegracaoZapsignCard />,
      },
    ],
  },
];

export function AbaIntegracoes(props: { escritorioNome: string; aberta: string | undefined; onAbrir: (id: string | undefined) => void }) {
  return <CatalogoIntegracoes grupos={GRUPOS} escritorioNome={props.escritorioNome} aberta={props.aberta} onAbrir={props.onAbrir} />;
}
