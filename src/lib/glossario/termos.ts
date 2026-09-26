// Glossario do sistema: os termos que a equipe, os parceiros e a plataforma
// usam, com a definicao que vale AQUI (nao a do dicionario). E o texto curado;
// o que depende do banco (as permissoes de cada papel) e lido ao vivo pelo
// componente, a partir de `papel`/`papelStaff`.
//
// Regras para editar:
// - `id` e o slug estavel (vira ancora e link entre termos). Nao renomear.
// - `publico`: "todos" (padrao) aparece para equipe e parceiros; "interno" so
//   para a equipe do escritorio; "qg" so no painel da plataforma.
// - A definicao descreve o que a pessoa VE e PODE, nao a tabela por tras.

export type Categoria = "papeis" | "casos" | "parceria" | "automacoes" | "plataforma" | "tecnico";
export type Publico = "todos" | "interno" | "qg";

export interface Termo {
  id: string;
  termo: string;
  categoria: Categoria;
  definicao: string;
  sinonimos?: Array<string>;
  /** ids de outros termos */
  veja?: Array<string>;
  publico?: Publico;
  /** chave em `papeis`: o card mostra as permissoes ao vivo do banco */
  papel?: "admin" | "advogado" | "assistente" | "financeiro" | "parceiro";
  /** papel no QG (`plataforma_staff.papel`) */
  papelStaff?: "dono" | "operacao" | "suporte" | "leitura";
}

export const CATEGORIAS: Array<{ id: Categoria; nome: string; descricao: string }> = [
  { id: "papeis", nome: "Papéis e acessos", descricao: "Quem entra, com que papel, e o que cada papel pode." },
  { id: "casos", nome: "Casos e rotina", descricao: "O vocabulário do dia a dia: cliente, caso, andamento, tarefa, perícia." },
  { id: "parceria", nome: "Parceria e financeiro", descricao: "Como a parceria funciona e de onde sai o repasse." },
  { id: "automacoes", nome: "Integrações e automações", descricao: "O que o sistema busca ou faz sozinho, e de onde vem." },
  { id: "plataforma", nome: "Plataforma e QG", descricao: "O que existe acima do escritório: quem opera a plataforma e como entra no conteúdo." },
  { id: "tecnico", nome: "Ambientes e técnica", descricao: "Termos que aparecem em conversas com quem mantém o sistema." },
];

/** Remove acentos e caixa. Mantem o mesmo numero de caracteres para texto em portugues (NFC), o que permite destacar o trecho encontrado. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export const TERMOS: Array<Termo> = [
  // -------------------------------------------------------------------------
  // Papeis e acessos
  // -------------------------------------------------------------------------
  {
    id: "escritorio",
    termo: "Escritório",
    categoria: "papeis",
    definicao:
      "A unidade que agrupa tudo: clientes, casos, equipe, parceiros, etiquetas, templates, integrações e a própria marca (nome, logo e cor, em Configurações → Escritório). Cada pessoa entra num escritório por um vínculo, e nada de um escritório aparece para o outro — nem pela API. Quem tem vínculo em mais de um escolhe qual está aberto pelo seletor do cabeçalho.",
    veja: ["vinculo", "seletor-escritorio", "isolamento"],
  },
  {
    id: "vinculo",
    termo: "Vínculo",
    sinonimos: ["membro", "membro do escritório"],
    categoria: "papeis",
    definicao:
      "Liga uma pessoa a um escritório com um papel e um status (convidado, ativo ou desativado). É o vínculo que decide o que a pessoa pode fazer, não a conta: a mesma conta pode ter vínculos em escritórios diferentes, com papéis diferentes. Desativar o vínculo corta o acesso na hora, mesmo com a pessoa logada.",
    veja: ["papel", "desligar", "convite"],
  },
  {
    id: "papel",
    termo: "Papel",
    sinonimos: ["perfil", "função"],
    categoria: "papeis",
    definicao:
      "O conjunto de permissões que o vínculo dá. São cinco: Administrador, Advogado, Assistente, Financeiro e Parceiro. Só o administrador troca o papel de alguém (Equipe → menu da pessoa → “Tornar …”), e a troca vale na próxima ação da pessoa — ela não precisa sair e entrar. O papel é o padrão: uma pessoa pode ter permissões a mais ou a menos que ele, uma a uma (ver ajuste de permissão). Trocar o papel desfaz os ajustes anteriores.",
    veja: ["permissao", "ajuste-de-permissao", "admin", "advogado", "assistente", "financeiro", "parceiro"],
  },
  {
    id: "permissao",
    termo: "Permissão",
    categoria: "papeis",
    definicao:
      "Cada ação que o sistema controla tem um nome no formato recurso:ação — por exemplo casos:editar ou equipe:gerenciar. O papel reúne permissões, e o administrador pode somar ou tirar uma delas de uma pessoa específica. O menu e os botões só aparecem para quem tem a permissão, e o banco recusa quem tentar sem ela, mesmo chamando a API direto: sumir da tela e ser recusado são a mesma regra vista de dois lados.",
    veja: ["escopo", "papel", "ajuste-de-permissao", "permissao-sensivel", "rls"],
  },
  {
    id: "escopo",
    termo: "Escopo",
    categoria: "papeis",
    definicao:
      "Até onde uma permissão alcança. “Todos” é tudo do escritório; “atribuídos” é só o que está no nome da pessoa (as tarefas e compromissos do assistente); “indicados” é só os casos que a pessoa indicou (o parceiro); “próprios” é só o que é dela (os repasses do parceiro). Em tarefas e agenda o administrador pode mudar o alcance de uma pessoa entre “todos” e “só os atribuídos”, sem trocar o papel dela.",
    veja: ["permissao"],
  },
  {
    id: "ajuste-de-permissao",
    termo: "Ajuste de permissão",
    sinonimos: ["permissão individual", "exceção", "permissão por pessoa"],
    categoria: "papeis",
    publico: "interno",
    definicao:
      "Uma permissão somada ou tirada de UMA pessoa, por cima do papel dela. Fica em Equipe → menu da pessoa → Permissões: a lista mostra tudo que o sistema controla, com o que o papel dá já marcado, e o administrador marca ou desmarca o que quiser. O que se guarda é só a diferença — por isso a linha ajustada aparece com a etiqueta “ajustado” e um “voltar ao papel”, e melhorar o papel mais tarde continua alcançando essa pessoa. Vale para quem tem acesso interno — a tela Equipe não lista parceiros, e o papel de parceiro não se ajusta. Quem ajusta é quem gerencia a equipe; ninguém ajusta a si mesma nem concede o que não tem; e cada mudança fica na auditoria, com o que era e o que ficou.",
    veja: ["permissao", "permissao-sensivel", "papel", "equipe", "auditoria"],
  },
  {
    id: "permissao-sensivel",
    termo: "Permissão sensível",
    categoria: "papeis",
    publico: "interno",
    definicao:
      "As permissões que mudam o alcance da pessoa no escritório inteiro: gerenciar a equipe, configurar o escritório, ler a auditoria, mexer nas integrações, excluir cliente, excluir parceiro e emitir token do MCP. Elas aparecem marcadas na lista de permissões e, para conceder, a tela pede confirmação dizendo o que a pessoa passa a poder.",
    veja: ["ajuste-de-permissao", "permissao", "admin"],
  },
  {
    id: "admin",
    termo: "Administrador",
    sinonimos: ["admin", "administradora"],
    categoria: "papeis",
    papel: "admin",
    definicao:
      "Tornar alguém administrador é entregar o escritório a essa pessoa: ela convida e desliga gente, troca papéis (inclusive o seu), vê a auditoria, mexe nas integrações (IA, Google, webhooks), emite token do MCP, exclui clientes e parceiros e é quem aprova ou recusa o acesso de suporte da plataforma. Quando a ideia é dar só uma dessas coisas a alguém, não é preciso torná-la administradora: dá para conceder aquela permissão sozinha (ver ajuste de permissão). Todo escritório precisa de pelo menos uma pessoa que gerencie a equipe — o sistema não deixa tirar a última.",
    veja: ["equipe", "ajuste-de-permissao", "auditoria", "acesso-suporte", "token-mcp"],
  },
  {
    id: "advogado",
    termo: "Advogado",
    sinonimos: ["advogada", "interno"],
    categoria: "papeis",
    papel: "advogado",
    definicao:
      "O papel de quem toca os casos. Cria e edita clientes e casos, tarefas, agenda, documentos, andamentos e análises; lê publicações, processos e a senha do MEU INSS; usa a IA; gerencia parceiros, etiquetas e templates. Não vê Equipe, Auditoria nem integrações, e não exclui cliente nem parceiro — isso é do administrador, porque não tem volta (só se ele conceder a exclusão a uma pessoa em particular). É o “interno” de antes dos papéis.",
    veja: ["assistente", "admin", "ajuste-de-permissao", "caso"],
  },
  {
    id: "assistente",
    termo: "Assistente",
    categoria: "papeis",
    papel: "assistente",
    definicao:
      "Apoio ao advogado. Vê todos os casos, clientes e documentos, cadastra e edita, envia documentos e usa a IA — mas só mexe nas tarefas e compromissos atribuídos a ele, e só lê a senha do MEU INSS nos casos atribuídos a ele. Não gerencia parceiros, etiquetas nem templates, e não vê comercial nem repasses.",
    veja: ["escopo", "tarefa", "advogado"],
  },
  {
    id: "financeiro",
    termo: "Financeiro",
    sinonimos: ["financeira", "contas"],
    categoria: "papeis",
    papel: "financeiro",
    definicao:
      "Vê os casos, as tarefas, a agenda e os repasses para conferir o que há a pagar e a receber — mas não cria nem edita nada do trabalho jurídico: sem “Novo caso”, sem criar tarefa ou compromisso, sem enviar documento, sem andamentos internos, sem senha do INSS. O menu fica sem Comercial, Processos, Publicações, Parceiros e Etiquetas.",
    veja: ["repasse", "percentual-parceiro"],
  },
  {
    id: "parceiro",
    termo: "Parceiro",
    sinonimos: ["advogado parceiro", "captador", "correspondente", "parceira"],
    categoria: "papeis",
    papel: "parceiro",
    definicao:
      "Advogado de fora que indica clientes e acompanha só os casos que indicou. Nesses casos vê os andamentos marcados como visíveis ao parceiro, envia documentos, cumpre solicitações, lê publicações e processos e vê os próprios repasses. Não vê os outros casos do escritório nem a equipe. Entra pelo convite feito em Parceiros, cria a senha e aceita os termos no primeiro acesso.",
    veja: ["parceria", "visivel-parceiro", "repasse", "aceite-termos"],
  },
  {
    id: "interno",
    termo: "Interno × parceiro (modo de acesso)",
    sinonimos: ["equipe interna", "modo interno"],
    categoria: "papeis",
    definicao:
      "Os dois jeitos de ver o sistema. Interno é a equipe do escritório (administrador, advogado, assistente, financeiro): Tarefas é a tela inicial e o menu é completo. Parceiro vê a versão restrita aos casos dele, com Clientes como tela inicial. O papel decide o modo; o modo decide as telas.",
    veja: ["papel", "parceiro"],
  },
  {
    id: "convite",
    termo: "Convite",
    sinonimos: ["convidar", "primeiro acesso"],
    categoria: "papeis",
    definicao:
      "Como alguém entra no escritório. O administrador convida em Equipe (para a equipe) ou em Parceiros (para parceiros), escolhendo o papel. A pessoa recebe um e-mail, cria a própria senha e só então usa o sistema. Quem já tem conta em outro escritório não recebe senha nova: ganha um segundo vínculo e passa a ver o seletor de escritório.",
    veja: ["vinculo", "seletor-escritorio", "equipe"],
  },
  {
    id: "equipe",
    termo: "Equipe",
    categoria: "papeis",
    publico: "interno",
    definicao:
      "A tela de quem tem acesso interno ao escritório: papel de cada um, convite com papel, “Tornar …” para trocar o papel, desligar e reativar, e o painel de permissões de cada pessoa. Abre para quem gerencia a equipe — normalmente o administrador, mas essa permissão pode ser concedida a alguém sem tornar essa pessoa administradora. Parceiros ficam na tela Parceiros, não aqui.",
    veja: ["admin", "papel", "ajuste-de-permissao", "desligar"],
  },
  {
    id: "desligar",
    termo: "Desligar e reativar",
    sinonimos: ["desativar", "remover acesso", "reativar"],
    categoria: "papeis",
    definicao:
      "Desligar encerra o vínculo sem apagar a pessoa: o acesso cai na hora, o histórico continua no nome dela, e as tarefas abertas e os compromissos futuros passam para quem o administrador escolher. Reativar devolve o acesso com o mesmo papel. Quem está em mais de um escritório perde só o vínculo daquele.",
    veja: ["vinculo", "equipe"],
  },
  {
    id: "seletor-escritorio",
    termo: "Seletor de escritório",
    sinonimos: ["trocar de escritório"],
    categoria: "papeis",
    definicao:
      "Aparece no cabeçalho para quem tem vínculo em mais de um escritório. Trocar recarrega a página e mostra só o que é do escritório escolhido; cada aba do navegador fica no seu, então dá para trabalhar em dois ao mesmo tempo.",
    veja: ["escritorio", "vinculo"],
  },
  {
    id: "ver-como-parceiro",
    termo: "Ver como parceiro",
    categoria: "papeis",
    publico: "interno",
    definicao:
      "O administrador abre o sistema com os olhos de um parceiro, em somente leitura, para conferir o que ele enxerga antes de responder uma dúvida. Só Tarefas e Agenda entram no modo — as outras telas mostrariam o que é do administrador, não do parceiro.",
    veja: ["parceiro", "visivel-parceiro"],
  },
  {
    id: "auditoria",
    termo: "Auditoria",
    sinonimos: ["trilha", "registro de acessos"],
    categoria: "papeis",
    publico: "interno",
    definicao:
      "O registro de quem fez o quê: leituras da senha do MEU INSS, ajustes de permissão (quem mexeu, em quem, o que era e o que ficou), ações da plataforma sobre o escritório (suspensão, troca de titular, suporte) e cada tela que uma sessão de suporte abriu. Vê quem tem a permissão de ler auditoria — por padrão só o administrador, mas ela pode ser concedida a uma pessoa. O que a plataforma faz com o escritório fica visível para o escritório, sempre.",
    veja: ["senha-meu-inss", "ajuste-de-permissao", "acesso-suporte", "admin"],
  },
  {
    id: "token-mcp",
    termo: "Token do MCP",
    sinonimos: ["chave do Claude", "MCP"],
    categoria: "papeis",
    publico: "interno",
    definicao:
      "A chave que deixa o Claude Desktop (ou outra ferramenta de IA) consultar o sistema em nome de uma pessoa. Emite quem tem a permissão de emitir token — por padrão, só o administrador — para si ou para alguém do escritório, escolhido numa lista; o token vale só naquele escritório e roda como a pessoa (ela vê pelo Claude o que vê no sistema). O dono e quem emitiu veem e revogam; se quem emitiu deixa de poder conceder — perdeu a permissão, foi rebaixado ou desligado —, o token para na hora.",
    veja: ["ia", "admin", "permissao-sensivel"],
  },
  {
    id: "isolamento",
    termo: "Isolamento entre escritórios",
    categoria: "papeis",
    definicao:
      "A garantia de que um escritório nunca vê dado do outro. Não é um filtro da tela: é regra do banco, conferida em toda leitura e gravação, para qualquer papel, inclusive por trás das integrações e da IA. Por isso dois escritórios podem ter um cliente com o mesmo CPF sem conflito.",
    veja: ["escritorio", "rls"],
  },

  // -------------------------------------------------------------------------
  // Casos e rotina
  // -------------------------------------------------------------------------
  {
    id: "cliente",
    termo: "Cliente",
    sinonimos: ["segurado", "segurada"],
    categoria: "casos",
    definicao:
      "A pessoa atendida. Não tem login: quem fala por ela no sistema é a equipe ou o parceiro que a indicou. Um cliente pode ter mais de um caso. O CPF é único dentro do escritório.",
    veja: ["caso", "etiqueta"],
  },
  {
    id: "caso",
    termo: "Caso",
    sinonimos: ["processo do cliente", "pasta"],
    categoria: "casos",
    definicao:
      "Um pedido de benefício de um cliente, do começo ao fim: fase, status, tipo de benefício, responsável na equipe, parceiro indicador (se houver), documentos, andamentos, análises, tarefas, processos e repasses. A tela do caso reúne tudo isso em abas.",
    veja: ["fase", "status-caso", "tipo-beneficio", "andamento"],
  },
  {
    id: "fase",
    termo: "Fase do caso",
    categoria: "casos",
    definicao:
      "Onde o caso está no caminho: Análise (documentos e viabilidade), Administrativa (pedido protocolado no INSS), Judicial (ação na Justiça) e Finalizado. O kanban de Tarefas do parceiro se organiza por fase.",
    veja: ["status-caso", "processo"],
  },
  {
    id: "status-caso",
    termo: "Status do caso",
    categoria: "casos",
    definicao:
      "O detalhe dentro da fase: aguardando documentos, em análise, em revisão, em andamento, concluído com êxito, concluído sem êxito ou arquivado.",
    veja: ["fase"],
  },
  {
    id: "tipo-beneficio",
    termo: "Tipo de benefício",
    sinonimos: ["benefício", "aposentadoria", "auxílio-doença", "BPC", "LOAS", "pensão por morte"],
    categoria: "casos",
    definicao:
      "O que se pede ao INSS: aposentadoria por idade ou por tempo de contribuição, auxílio-doença, BPC/LOAS, pensão por morte, salário-maternidade, revisão… A lista é do escritório e se edita em Configurações → Benefícios.",
    veja: ["caso"],
  },
  {
    id: "andamento",
    termo: "Andamento",
    sinonimos: ["movimentação", "histórico"],
    categoria: "casos",
    definicao:
      "Cada acontecimento do caso, em ordem: nota da equipe, e-mail do INSS, movimentação do DataJud, publicação do DJEN, mensagem do parceiro. Cada um traz a origem. O que está marcado como visível ao parceiro aparece para ele; o resto é interno.",
    veja: ["visivel-parceiro", "datajud", "djen", "email-inss"],
  },
  {
    id: "visivel-parceiro",
    termo: "Visível ao parceiro",
    categoria: "casos",
    definicao:
      "A marca em andamentos e documentos que decide se o parceiro do caso enxerga aquilo. Vale no banco, não só na tela: sem a marca, nem pela API ele alcança. Análises técnicas são sempre internas.",
    veja: ["parceiro", "andamento", "analise-tecnica"],
  },
  {
    id: "analise-tecnica",
    termo: "Análise técnica",
    sinonimos: ["análise previdenciária", "viabilidade"],
    categoria: "casos",
    definicao:
      "O estudo do caso pela equipe — tempo de contribuição, carência, viabilidade, estratégia — feito à mão ou com ajuda da IA. É sempre interna; o parceiro fica sabendo do desfecho por um andamento visível.",
    veja: ["ia", "visivel-parceiro"],
  },
  {
    id: "documento",
    termo: "Documento",
    sinonimos: ["arquivo", "CNIS", "PPP", "CTPS", "laudo", "procuração"],
    categoria: "casos",
    definicao:
      "Um arquivo do caso, com tipo (CNIS, PPP, CTPS, laudo médico, procuração, contrato…). Sobe pelo sistema ou pela pasta do Google Drive espelhada. Pode ser marcado como visível ao parceiro. Só o parceiro do caso e a equipe alcançam o arquivo, e só dentro do escritório.",
    veja: ["solicitacao-documento", "google-drive", "visivel-parceiro"],
  },
  {
    id: "solicitacao-documento",
    termo: "Solicitação de documento",
    sinonimos: ["documentos pendentes", "pendência", "solicitação"],
    categoria: "casos",
    definicao:
      "Um pedido de documento a quem pode providenciar: interna (para a equipe), externa (para o parceiro) ou gerada por um template de exigência. Fica pendente até ser atendida ou dispensada. É o que o kanban de Tarefas do parceiro mostra e o que a tela Documentos pendentes lista para a equipe. Pedir, atender, dispensar ou excluir é de quem edita casos — o financeiro acompanha, mas não mexe.",
    veja: ["exigencia", "template-tarefa", "documento"],
  },
  {
    id: "exigencia",
    termo: "Exigência",
    categoria: "casos",
    definicao:
      "O pedido do INSS ou da Justiça para complementar o processo, com prazo. No sistema vira, a partir de um template, as solicitações de documento e uma tarefa de prazo, para ninguém perder a data.",
    veja: ["solicitacao-documento", "tarefa", "template-tarefa"],
  },
  {
    id: "tarefa",
    termo: "Tarefa",
    sinonimos: ["pendência da equipe", "to-do"],
    categoria: "casos",
    definicao:
      "A unidade de trabalho da equipe: título, responsável, prazo, prioridade e tipo (interna, prazo, perícia, pós-protocolo, contato com cliente). Nasce à mão, de um template, de uma sugestão da IA ou de uma automação (e-mail do INSS, DJEN, lembrete de perícia). Toda tarefa tem dono; excluir pede motivo e fica registrado.",
    veja: ["template-tarefa", "agenda", "assistente"],
  },
  {
    id: "template-tarefa",
    termo: "Template de tarefa",
    sinonimos: ["modelo de tarefa", "aplicar template"],
    categoria: "casos",
    publico: "interno",
    definicao:
      "Um conjunto de tarefas (e solicitações de documento) que se aplica a um caso de uma vez, para padronizar rotinas como exigência, pós-protocolo ou perícia marcada. Administrador e advogado gerenciam; quem pode editar o caso aplica. Cada escritório tem os seus.",
    veja: ["tarefa", "exigencia"],
  },
  {
    id: "agenda",
    termo: "Agenda",
    sinonimos: ["compromisso", "audiência"],
    categoria: "casos",
    definicao:
      "Os compromissos do escritório: perícias, audiências, reuniões. O parceiro vê só as perícias e audiências dos casos dele; o assistente só edita os compromissos atribuídos a ele. Datas sempre no horário de Brasília.",
    veja: ["pericia", "tarefa"],
  },
  {
    id: "pericia",
    termo: "Perícia",
    sinonimos: ["perícia médica", "perícia do INSS", "perícia judicial"],
    categoria: "casos",
    definicao:
      "O exame do INSS ou da Justiça, com data e local. Entra na agenda e gera tarefas de lembrete e de acompanhamento; o aviso ao cliente ou ao parceiro sai pela fila “A enviar”, para alguém conferir antes.",
    veja: ["agenda", "tarefa"],
  },
  {
    id: "processo",
    termo: "Processo administrativo × judicial",
    sinonimos: ["requerimento", "protocolo", "número CNJ", "ação"],
    categoria: "casos",
    definicao:
      "O administrativo é o protocolo no INSS (número do requerimento); o judicial é a ação na Justiça (número CNJ). Um caso pode ter os dois; andamentos e tarefas apontam para um deles. A tela Processos mostra todos os do escritório.",
    veja: ["fase", "datajud", "publicacao"],
  },
  {
    id: "publicacao",
    termo: "Publicação",
    sinonimos: ["intimação", "publicação órfã", "triagem"],
    categoria: "casos",
    definicao:
      "Uma intimação publicada no Diário (DJEN) para uma OAB do escritório. O sistema casa a publicação com o processo pelo número; a que não casa fica “órfã” e aparece na tela Publicações para alguém triar à mão.",
    veja: ["djen", "processo"],
  },
  {
    id: "etiqueta",
    termo: "Etiqueta",
    sinonimos: ["tag", "marcador"],
    categoria: "casos",
    definicao:
      "Um marcador colorido de cliente para organizar listas e filtros (por exemplo STATUS:ATIVO). Cada escritório tem as suas; administrador e advogado criam e editam.",
    veja: ["cliente"],
  },
  {
    id: "conversas",
    termo: "Conversas",
    sinonimos: ["comentários", "mensagens"],
    categoria: "casos",
    definicao:
      "Os comentários por caso entre a equipe e o parceiro, com aviso por e-mail a quem precisa responder. O parceiro só vê as conversas dos casos dele.",
    veja: ["caso", "parceiro"],
  },
  {
    id: "lead",
    termo: "Lead e Comercial",
    sinonimos: ["funil", "CRM", "captação"],
    categoria: "casos",
    publico: "interno",
    definicao:
      "Lead é o contato que chegou pelo site — um cliente em potencial ou um advogado interessado em parceria. A tela Comercial é o funil: novo, triagem, análise, agendar, agendado, fechamento, handoff (vira caso), fechado, sem direito, perdido.",
    veja: ["caso", "parceria"],
  },
  {
    id: "senha-meu-inss",
    termo: "Senha do MEU INSS",
    sinonimos: ["senha gov.br", "senha do INSS"],
    categoria: "casos",
    definicao:
      "A senha do cliente no portal do INSS, guardada cifrada por caso. Quem lê fica na auditoria. Administrador e advogado leem todas; o assistente, só dos casos em que tem tarefa; o parceiro, só dos casos que indicou; o financeiro não lê.",
    veja: ["auditoria", "escopo"],
  },

  // -------------------------------------------------------------------------
  // Parceria e financeiro
  // -------------------------------------------------------------------------
  {
    id: "parceria",
    termo: "Parceria (correspondência jurídica)",
    sinonimos: ["correspondência", "indicação"],
    categoria: "parceria",
    definicao:
      "O modelo comercial do escritório: o advogado parceiro indica o cliente e recebe um percentual dos honorários; o escritório toca o caso (administrativo e judicial) e fica com o restante. Procuração e contrato ficam com o escritório. O escritório também atende clientes diretos, sem parceiro.",
    veja: ["parceiro", "percentual-parceiro", "repasse"],
  },
  {
    id: "percentual-parceiro",
    termo: "Percentual do parceiro",
    sinonimos: ["comissão", "percentual"],
    categoria: "parceria",
    definicao:
      "A fatia dos honorários combinada com cada parceiro, definida no cadastro dele em Parceiros. É a base do cálculo do repasse e pode ser diferente de parceiro para parceiro.",
    veja: ["repasse", "parceria"],
  },
  {
    id: "repasse",
    termo: "Repasse",
    sinonimos: ["honorários do parceiro", "a pagar", "pago"],
    categoria: "parceria",
    definicao:
      "O valor devido ao parceiro por um caso: previsto (enquanto o caso corre), a pagar (honorário recebido) e pago. Fica na aba Repasses do caso. O parceiro vê só os seus; o financeiro e o advogado veem todos; o assistente não vê.",
    veja: ["percentual-parceiro", "financeiro"],
  },
  {
    id: "aceite-termos",
    termo: "Aceite de termos",
    sinonimos: ["termos da parceria", "onboarding"],
    categoria: "parceria",
    definicao:
      "No primeiro acesso, o parceiro lê e aceita os termos da parceria; o aceite fica registrado com data e versão. Até aceitar, ele não entra no sistema.",
    veja: ["parceiro", "convite"],
  },
  {
    id: "contrato",
    termo: "Contrato de honorários",
    categoria: "parceria",
    definicao:
      "O contrato do caso com o cliente: pendente, assinado, vigente ou encerrado. Fica com o escritório, nunca com o parceiro.",
    veja: ["caso", "parceria"],
  },

  // -------------------------------------------------------------------------
  // Integracoes e automacoes
  // -------------------------------------------------------------------------
  {
    id: "ia",
    termo: "Assistente de IA",
    sinonimos: ["IA", "Claude", "OpenAI", "análise por IA"],
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "O escritório conecta a própria chave (Anthropic ou OpenAI) em Configurações → Integrações; a equipe usa para analisar documentos, triar andamentos, sugerir a próxima tarefa e conversar sobre o caso. Só quem tem a permissão de usar IA; parceiro não usa. Tirar essa permissão de alguém fecha a IA de verdade: quem recusa é o servidor, não o sumiço do botão. A chave é do escritório e só vale nele.",
    veja: ["token-mcp", "analise-tecnica"],
  },
  {
    id: "djen",
    termo: "DJEN",
    sinonimos: ["Diário de Justiça Eletrônico Nacional", "Comunica CNJ", "diário"],
    categoria: "automacoes",
    definicao:
      "O Diário de Justiça Eletrônico Nacional, do CNJ. É de onde vêm as publicações, buscadas toda madrugada pelas OABs cadastradas em cada escritório — a rotina roda uma vez por escritório, e a publicação só casa com processos dele.",
    veja: ["publicacao", "processo"],
  },
  {
    id: "datajud",
    termo: "DataJud",
    sinonimos: ["movimentações", "CNJ"],
    categoria: "automacoes",
    definicao:
      "A base pública do CNJ com as movimentações dos processos judiciais. O sistema sincroniza e cada movimentação vira um andamento com origem DataJud; a tela Processos → Movimentações mostra o feed do dia.",
    veja: ["andamento", "processo"],
  },
  {
    id: "email-inss",
    termo: "E-mail do INSS",
    sinonimos: ["Gmail", "caixa do INSS"],
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "A caixa Gmail conectada em Configurações → Integrações recebe as comunicações do MEU INSS. Cada e-mail é lido, casado com o caso pelo CPF e vira andamento — e tarefa, quando há prazo. Cada escritório conecta a sua caixa; a rotina roda uma vez por escritório e só enxerga os casos dele.",
    veja: ["andamento", "tarefa"],
  },
  {
    id: "google-drive",
    termo: "Google Drive",
    sinonimos: ["pasta do caso", "Drive"],
    categoria: "automacoes",
    definicao:
      "A pasta espelho de documentos por caso: o que entra na pasta aparece no caso, e o que sobe no sistema vai para a pasta. O escritório conecta a própria conta Google.",
    veja: ["documento"],
  },
  {
    id: "legalmail",
    termo: "Legalmail",
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "Serviço de acompanhamento processual usado para importar processos e intimações. Só leitura e importação manual — o sistema nunca escreve lá.",
    veja: ["processo"],
  },
  {
    id: "ti",
    termo: "TI (Tramitação Inteligente)",
    sinonimos: ["Tramitação Inteligente", "importar do TI"],
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "O sistema anterior, de onde a base foi migrada. Sobrou “Buscar/Importar do TI” para casos antigos; a sincronização automática está desligada desde agosto de 2026. Só leitura.",
    veja: ["cliente"],
  },
  {
    id: "whatsapp",
    termo: "WhatsApp",
    sinonimos: ["Evolution", "mensagem ao parceiro"],
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "O canal de mensagens com o parceiro, ativado por código. Cada escritório cadastra a própria instância do Evolution em Configurações → Integrações (a chave fica cifrada no servidor); a mensagem que chega é do escritório daquela instância. O envio automático está pausado; o que existe hoje é o registro das mensagens.",
    veja: ["parceiro"],
  },
  {
    id: "resumo-do-dia",
    termo: "Resumo do dia",
    sinonimos: ["digest", "e-mail das 6h45"],
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "O e-mail automático da manhã com as tarefas e os prazos do dia para a equipe do escritório. Cada escritório recebe só o seu.",
    veja: ["tarefa", "agenda"],
  },
  {
    id: "webhook",
    termo: "Webhook",
    sinonimos: ["integração de saída", "n8n"],
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "Um aviso automático que o sistema envia a um endereço externo quando algo acontece — novo andamento, documento, tarefa — para outro sistema reagir, com cada envio assinado para o destino conferir a origem. Hoje a aba Webhooks mostra “Em breve”: a entrega era feita pelo n8n, que saiu das rotinas do sistema, e volta quando for refeita por function.",
    veja: ["admin"],
  },
  {
    id: "a-enviar",
    termo: "A enviar",
    sinonimos: ["fila de avisos", "aviso de perícia"],
    categoria: "automacoes",
    publico: "interno",
    definicao:
      "A fila de avisos (por exemplo, de perícia marcada) que o sistema preparou e que aguardam alguém da equipe conferir e enviar. Nada sai para o cliente sem passar por aqui.",
    veja: ["pericia"],
  },

  // -------------------------------------------------------------------------
  // Plataforma e QG
  // -------------------------------------------------------------------------
  {
    id: "legal-connect",
    termo: "Legal Connect",
    sinonimos: ["marca do produto", "logo"],
    categoria: "plataforma",
    definicao:
      "O nome e a marca do produto — os dois anéis entrelaçados, azul-marinho e dourado. Aparece onde ainda não se sabe (ou não importa) o escritório: tela de entrada, criar/redefinir senha, aba do navegador, ícone do app, cabeçalho dos e-mails, QG e o “por Legal Connect” no rodapé. Dentro do sistema, o topo mostra a marca do escritório.",
    veja: ["plataforma", "escritorio"],
  },
  {
    id: "plataforma",
    termo: "Plataforma",
    categoria: "plataforma",
    definicao:
      "O sistema como um todo, que atende vários escritórios ao mesmo tempo. Quem opera a plataforma é a equipe do QG — e ela não faz parte de nenhum escritório: não vê clientes, casos nem documentos.",
    veja: ["qg", "escritorio"],
  },
  {
    id: "qg",
    termo: "QG da plataforma",
    sinonimos: ["QG", "headquarter", "superadmin", "painel da plataforma"],
    categoria: "plataforma",
    definicao:
      "O painel, em endereço próprio, de onde a equipe da plataforma cria, edita, suspende e encerra escritórios e acompanha a saúde, o uso e a auditoria de todos — sem ver o conteúdo de nenhum. Só entra quem está na equipe do QG; ser administrador de um escritório não dá acesso.",
    veja: ["plataforma", "acesso-suporte", "escritorio-suspenso"],
  },
  {
    id: "acesso-suporte",
    termo: "Acesso de suporte",
    sinonimos: ["sessão de suporte", "suporte da plataforma"],
    categoria: "plataforma",
    definicao:
      "O único caminho para alguém da plataforma ver o conteúdo de um escritório. A pessoa pede pelo QG, com motivo e prazo (até 72 horas); o pedido recebe um número automático (SUP-ano-sequência) que serve para achá-lo depois na auditoria e na conversa com o escritório. O administrador vê o aviso no topo e aprova ou recusa em Configurações → Suporte. Aprovado, o acesso é somente leitura, com uma faixa âmbar na tela, e cada tela aberta fica na auditoria do escritório. Encerra sozinho no prazo, ou antes — pelo administrador (Configurações → Suporte) ou pelo QG.",
    veja: ["admin", "auditoria", "qg"],
  },
  {
    id: "break-glass",
    termo: "Break-glass",
    sinonimos: ["acesso de emergência"],
    categoria: "plataforma",
    publico: "qg",
    definicao:
      "Acesso de suporte sem esperar a aprovação do escritório, para emergência. Só quem tem a marca no QG consegue; fica registrado na auditoria do escritório, que vê o que foi aberto. Se nunca for usado, é sinal de que pode ser tirado.",
    veja: ["acesso-suporte"],
  },
  {
    id: "escritorio-suspenso",
    termo: "Escritório suspenso",
    sinonimos: ["suspender", "suspensão"],
    categoria: "plataforma",
    definicao:
      "Ninguém do escritório entra (todos veem o aviso de suspensão); os dados ficam intactos. O QG suspende com motivo e reativa quando resolver. O escritório padrão do sistema não pode ser suspenso.",
    veja: ["escritorio-encerrado", "qg"],
  },
  {
    id: "escritorio-encerrado",
    termo: "Escritório encerrado",
    sinonimos: ["encerrar", "encerramento"],
    categoria: "plataforma",
    definicao:
      "Saiu do ar em definitivo. Os dados ficam guardados até a eliminação, que precisa de pedido, carência e a aprovação de uma segunda pessoa do QG.",
    veja: ["eliminacao", "escritorio-suspenso"],
  },
  {
    id: "eliminacao",
    termo: "Eliminação de dados",
    sinonimos: ["apagar escritório", "exclusão definitiva"],
    categoria: "plataforma",
    publico: "qg",
    definicao:
      "Apagar tudo de um escritório encerrado. Exige duas pessoas diferentes do QG (quem pede não aprova) e o fim da carência — 30 dias em produção. Irreversível; fica na auditoria da plataforma.",
    veja: ["escritorio-encerrado"],
  },
  {
    id: "escritorio-padrao",
    termo: "Escritório padrão do sistema",
    categoria: "plataforma",
    publico: "qg",
    definicao:
      "O primeiro escritório, dono das integrações de sistema (e-mail do INSS, DJEN, WhatsApp) nesta versão. Não pode ser suspenso nem encerrado.",
    veja: ["escritorio", "email-inss"],
  },
  {
    id: "trocar-titular",
    termo: "Trocar titular",
    categoria: "plataforma",
    publico: "qg",
    definicao:
      "O QG passa a titularidade (o administrador principal) de um escritório para outra pessoa, a pedido — por exemplo quando o único administrador saiu. Fica na auditoria do escritório.",
    veja: ["admin", "qg"],
  },
  {
    id: "staff-dono",
    termo: "Dono (QG)",
    sinonimos: ["dona da plataforma"],
    categoria: "plataforma",
    publico: "qg",
    papelStaff: "dono",
    definicao:
      "Tudo no QG: cria, edita, suspende e encerra escritórios, opera membros, gerencia a equipe do QG e aprova eliminações. É o papel de quem responde pela plataforma.",
    veja: ["qg", "eliminacao"],
  },
  {
    id: "staff-operacao",
    termo: "Operação (QG)",
    categoria: "plataforma",
    publico: "qg",
    papelStaff: "operacao",
    definicao:
      "Cria, edita e suspende escritórios e opera membros (desativar, trocar titular). Não encerra escritório nem mexe na equipe do QG.",
    veja: ["qg"],
  },
  {
    id: "staff-suporte",
    termo: "Suporte (QG)",
    categoria: "plataforma",
    publico: "qg",
    papelStaff: "suporte",
    definicao:
      "Vê os painéis e pede acesso de suporte aos escritórios. Não cria, suspende nem encerra nada.",
    veja: ["acesso-suporte"],
  },
  {
    id: "staff-leitura",
    termo: "Leitura (QG)",
    categoria: "plataforma",
    publico: "qg",
    papelStaff: "leitura",
    definicao: "Só os painéis. Serve para quem acompanha números sem operar.",
    veja: ["qg"],
  },
  {
    id: "aal2",
    termo: "Verificação em duas etapas (AAL2)",
    sinonimos: ["MFA", "2FA", "segundo fator"],
    categoria: "plataforma",
    publico: "qg",
    definicao:
      "O segundo fator de autenticação (código do aplicativo autenticador), obrigatório para entrar no QG — quem chega sem ele cadastra o autenticador na hora, na própria tela. A exigência é uma chave no banco, ligada hoje em produção e no staging. Qualquer pessoa pode ativar o seu em Configurações → Segurança; a partir daí o código é pedido depois da senha.",
    veja: ["qg"],
  },

  // -------------------------------------------------------------------------
  // Ambientes e tecnica
  // -------------------------------------------------------------------------
  {
    id: "ambientes",
    termo: "Ambientes: produção, staging e local",
    sinonimos: ["staging", "produção", "homologação"],
    categoria: "tecnico",
    publico: "interno",
    definicao:
      "Produção é o sistema de verdade (marasandraconnect.com). Staging é a cópia onde se valida cada mudança antes (staging.marasandraconnect.com), com dados anonimizados. Local é a máquina de quem desenvolve. Cada um tem o próprio banco; nada passa de um para o outro sozinho.",
    veja: ["release", "migration"],
  },
  {
    id: "release",
    termo: "Release",
    sinonimos: ["deploy", "subir para produção"],
    categoria: "tecnico",
    publico: "interno",
    definicao:
      "Levar para a produção um lote que já foi validado no staging. Depois do release, o card correspondente vai para a coluna Produção do board.",
    veja: ["ambientes", "board"],
  },
  {
    id: "board",
    termo: "Board (Legal Connect)",
    sinonimos: ["quadro", "cards", "issue"],
    categoria: "tecnico",
    publico: "interno",
    definicao:
      "O quadro no GitHub onde vive o trabalho aberto. Cada card é uma issue e anda pelas colunas Backlog → Lote atual → Em revisão → Validar no staging → Produção.",
    veja: ["release"],
  },
  {
    id: "migration",
    termo: "Migration",
    categoria: "tecnico",
    publico: "interno",
    definicao:
      "Um arquivo SQL que altera o banco de dados. Aplica-se na ordem local → staging → produção e fica registrado no banco em que rodou — é esse registro que diz se uma mudança já chegou à produção.",
    veja: ["ambientes"],
  },
  {
    id: "rls",
    termo: "RLS (segurança por linha)",
    sinonimos: ["Row Level Security", "policy", "regra do banco"],
    categoria: "tecnico",
    publico: "interno",
    definicao:
      "A regra do banco que decide, linha a linha, quem vê e grava o quê. É ela — não a tela — que garante o isolamento entre escritórios e entre papéis. Por isso “o botão sumiu” e “o banco recusou” são a mesma regra vista de dois lados.",
    veja: ["isolamento", "permissao"],
  },
  {
    id: "gate-permissao",
    termo: "Gate de permissão",
    sinonimos: ["espelho de exigências", "botão que some"],
    categoria: "tecnico",
    publico: "interno",
    definicao:
      "O jeito de a tela saber o que o servidor vai aceitar. A exigência de cada escrita é declarada uma única vez, num espelho das regras do banco, e a tela pergunta a ele — nunca escreve a permissão à mão. Um conferidor automático compara o espelho com o banco e acusa sobra ou falta, para não voltar a existir botão que oferece o que o banco recusa.",
    veja: ["rls", "permissao", "edge-function"],
  },
  {
    id: "edge-function",
    termo: "Edge function",
    sinonimos: ["função de servidor", "backend"],
    categoria: "tecnico",
    publico: "interno",
    definicao:
      "Código que roda no servidor para o que o navegador não pode fazer sozinho: falar com a IA, com o Gmail, com o DJEN, enviar e-mail. Toda função começa conferindo quem chama, em qual escritório e — quando a ação pede uma permissão — se quem chama tem essa permissão; daí para a frente trabalha presa a esse escritório.",
    veja: ["ia", "gate-permissao", "email-inss"],
  },
];
