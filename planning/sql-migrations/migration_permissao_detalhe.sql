-- ============================================================================
-- Permissão com explicação longa: o que ela deixa fazer, onde aparece e o que
-- NÃO cobre (2026-09-28)
--
-- POR QUE: a tela de ajuste de permissões (/equipe → Permissões) mostrava só a
-- `descricao`, que é um rótulo de 3 a 6 palavras ("Ver casos", "Enviar
-- documentos"). Quem administra precisa decidir conceder ou não a partir disso,
-- e o que mais pesa na decisão — a FRONTEIRA da permissão, o que ela não
-- alcança — não estava escrito em lugar nenhum.
--
-- ONDE MORA: aqui, no banco, junto da permissão. Não numa constante do front.
-- É a mesma regra do glossário (CLAUDE.md): "permissões vêm do banco em tempo
-- real — não escrever matriz de permissão em texto". Assim a explicação nasce e
-- morre com a permissão, e quem acrescentar uma permissão nova sem detalhe vê
-- o campo vazio na tela em vez de uma frase errada herdada de outro lugar.
--
-- A função `permissoes_do_membro` passa a devolver o campo. Como o tipo de
-- retorno muda, ela é DERRUBADA e recriada — `create or replace` recusa
-- mudança de assinatura. O corpo abaixo saiu do `pg_get_functiondef` da
-- PRODUÇÃO em 28/09 (não de uma migration velha), com uma única diferença: a
-- coluna `detalhe`. Os grants são refeitos porque o drop os leva junto.
--
-- Idempotente.
-- ============================================================================

alter table public.permissoes add column if not exists detalhe text;

comment on column public.permissoes.detalhe is
  'Explicação longa mostrada no "i" da tela de permissões: o que a permissão deixa fazer, onde aparece e o que ela NÃO cobre.';

-- ---------------------------------------------------------------------------
-- O texto de cada permissão. A última frase é quase sempre a fronteira: é ela
-- que responde "e se eu não der?".
-- ---------------------------------------------------------------------------
update public.permissoes set detalhe = v.detalhe
  from (values
    ('etiquetas:gerenciar',
     'Abre a tela Etiquetas e deixa criar, renomear e apagar as etiquetas que classificam clientes e casos. Sem ela a pessoa continua vendo as etiquetas nos casos — só não mexe no catálogo do escritório.'),
    ('templates:gerenciar',
     'Deixa criar e editar os modelos de tarefa que o sistema aplica sozinho (montagem inicial, cumprimento de exigência, perícia). Sem ela a pessoa usa os modelos que existem, mas não altera o que eles criam para todo o escritório.'),

    ('analises:ler',
     'Mostra a aba de análise técnica do caso, com o parecer e os cálculos. Sem ela o caso abre normalmente, só sem essa aba.'),
    ('andamentos:ler_internos',
     'Mostra os andamentos marcados como internos — os que o escritório escreve para si e o parceiro não vê. Sem ela a pessoa enxerga apenas os andamentos visíveis ao parceiro.'),
    ('casos:editar',
     'Deixa criar cliente e caso e alterar o caso: responsável, fase, benefício, etiquetas. Não inclui apagar cliente, que é permissão à parte.'),
    ('casos:ler',
     'É a base do sistema: sem ela a pessoa não vê caso nenhum e as telas ficam vazias. Com ela, vê os casos do escritório — o parceiro vê só os que indicou.'),
    ('processos:ler',
     'Mostra os processos administrativos e judiciais do caso, com número, fase e movimentações. Sem ela o caso abre sem a aba de processos.'),
    ('publicacoes:ler',
     'Abre a tela Publicações, com o que chega do Diário Oficial pelo DJEN, e deixa vincular uma publicação ao caso certo.'),

    ('clientes:excluir',
     'Apaga o cliente e tudo que está pendurado nele: casos, documentos, tarefas e andamentos. NÃO tem desfazer. Fica registrado na Auditoria com o seu nome e o que foi apagado.'),
    ('clientes:ler_contato',
     'Mostra telefone, e-mail e endereço do cliente no card de dados. Sem ela a pessoa trabalha o caso normalmente, com os dados de contato ocultos.'),
    ('senha_inss:ler',
     'Deixa revelar a senha do Meu INSS do cliente. Cada leitura é registrada com nome, data e cliente — a Auditoria mostra quem viu o quê.'),

    ('comercial:gerenciar',
     'Abre a tela Comercial e deixa criar e mover leads no funil até virarem cliente. Sem ela a tela responde "Área restrita a quem gerencia o comercial".'),

    ('documentos:enviar',
     'Deixa anexar arquivo ao caso e cumprir solicitação de documento. Sem ela a pessoa vê os documentos, mas não envia nenhum.'),
    ('documentos:excluir',
     'Deixa apagar documento do caso. O arquivo sai, mas fica o rastro de quem apagou, quando e qual era o nome.'),

    ('auditoria:ler',
     'Abre a tela Auditoria: quem mudou papel ou permissão de quem, quem leu senha do Meu INSS, quem apagou o quê. É a trilha que responde "quem fez isso?" — por isso é sensível.'),
    ('equipe:gerenciar',
     'Abre a tela Equipe: convidar pessoa, trocar papel, ajustar permissão, desligar e reativar. É esta permissão que dá acesso a esta própria tela, e o sistema não deixa o escritório ficar sem ninguém que a tenha.'),
    ('escritorio:configurar',
     'Deixa mudar dados, marca (nome, logo e cor) e configurações do escritório. A marca aparece no topo do sistema e nos e-mails que o cliente recebe.'),
    ('ia:mcp_conceder',
     'Deixa emitir o token que conecta o Claude ao sistema, para si ou para outra pessoa do escritório. O token roda com os limites de quem o recebe — e para de valer se quem emitiu perder esta permissão.'),
    ('integracoes:gerenciar',
     'Deixa cadastrar e testar as credenciais do escritório: chave de IA, Google, Legalmail, Tramitação Inteligente e WhatsApp. As chaves são guardadas cifradas e nunca voltam para a tela.'),

    ('repasses:ler',
     'Mostra os valores de repasse ao parceiro no caso e nos relatórios. Sem ela a pessoa vê o caso sem a parte financeira.'),

    ('ia:usar',
     'Libera o assistente de IA, a triagem de andamentos, a sugestão de próxima tarefa e a extração de dados de documento. Vale só para quem é da equipe interna — parceiro não usa IA.'),

    ('parceiros:excluir',
     'Apaga o cadastro do parceiro. Os casos que ele indicou continuam no escritório e o histórico segue com o nome dele. Fica registrado na Auditoria.'),
    ('parceiros:gerenciar',
     'Abre a tela Parceiros: cadastrar, editar, desligar e reativar. Desligar não apaga — o parceiro perde o acesso e o histórico permanece.'),
    ('parceiros:ver_como',
     'Deixa abrir o sistema com os olhos de um parceiro, em modo somente leitura, para conferir o que ele enxerga. Uma faixa no topo avisa que é visão de parceiro.'),

    ('agenda:gerenciar',
     'Deixa criar e editar compromissos, perícias e audiências na Agenda. Com alcance "só os atribuídos", a pessoa mexe apenas nos compromissos dela.'),
    ('tarefas:gerenciar',
     'Deixa criar, editar e concluir tarefas. Com alcance "só as atribuídas", a pessoa mexe apenas nas tarefas em que é a responsável.')
  ) as v(chave, detalhe)
 where public.permissoes.chave = v.chave;

-- ---------------------------------------------------------------------------
-- A função devolve o campo novo. Corpo igual ao da produção em 28/09, mais a
-- coluna `detalhe`. Drop + create porque o tipo de retorno mudou.
-- ---------------------------------------------------------------------------
drop function if exists public.permissoes_do_membro(uuid);

create function public.permissoes_do_membro(p_usuario_id uuid)
returns table (permissao text, grupo text, descricao text, detalhe text, sensivel boolean,
               do_papel boolean, tem boolean, escopo text, ajustada boolean,
               definida_por_nome text, definida_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esc    uuid := private.escritorio_ativo();
  v_membro uuid;
begin
  if not private.tem_permissao('equipe:gerenciar') then
    raise exception 'Sem permissão: apenas quem gerencia a equipe vê os ajustes' using errcode = '42501';
  end if;
  select m.id into v_membro from public.membros m
   where m.escritorio_id = v_esc and m.usuario_id = p_usuario_id;
  if v_membro is null then
    raise exception 'Pessoa sem vínculo neste escritório' using errcode = '42501';
  end if;

  return query
  select p.chave,
         p.grupo,
         p.descricao,
         p.detalhe,
         p.sensivel,
         (pp.permissao is not null)          as do_papel,
         (e.permissao is not null)           as tem,
         coalesce(e.escopo, pp.escopo)       as escopo,
         (mp.permissao is not null)          as ajustada,
         u.nome                              as definida_por_nome,
         mp.definida_em
    from public.permissoes p
    left join public.membros m on m.id = v_membro
    left join public.papel_permissoes pp on pp.papel_id = m.papel_id and pp.permissao = p.chave
    left join private.permissoes_efetivas(v_membro) e on e.permissao = p.chave
    left join public.membro_permissoes mp on mp.membro_id = v_membro and mp.permissao = p.chave
    left join public.usuarios u on u.id = mp.definida_por
   order by p.grupo, p.chave;
end;
$$;

-- o drop levou os grants junto
grant execute on function public.permissoes_do_membro(uuid) to authenticated, service_role;
