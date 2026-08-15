-- Auditoria do processador de e-mails do INSS.
--
-- Hoje, se ele cria uma tarefa errada, não há como saber de qual e-mail veio,
-- que campos ele extraiu nem por que casou com aquele cliente. Esta tabela
-- guarda a trilha completa de CADA mensagem lida — inclusive nas execuções
-- `dry_run`, que é justamente onde a gente confere antes de valer.
--
-- Não substitui a dedup (que continua sendo por tarefas.origem_ref): aqui
-- guardamos até o que foi PULADO, pra ficar explícito que a mensagem foi vista
-- e por que nada aconteceu.
--
-- Idempotente.

create table if not exists public.inss_email_log (
  id uuid primary key default gen_random_uuid(),

  -- Identificação da mensagem no Gmail
  gmail_message_id text not null,
  assunto          text,
  remetente        text,
  recebido_em      text,          -- header Date cru, como veio

  -- O que a extração entendeu
  campos_extraidos jsonb,         -- nome, cpf, protocolo, despacho, etc.
  despacho         text,
  classificacao    text,          -- id da matriz, ou 'status_fora_da_matriz'

  -- Casamento com o cliente
  match_via        text,          -- 'nome' | 'cpf' | 'protocolo' | 'sem_match'
  cliente_id       uuid references public.clientes(id) on delete set null,
  caso_id          uuid references public.casos(id) on delete set null,

  -- O que foi feito
  template_aplicado text,
  andamento_id      uuid references public.andamentos(id) on delete set null,
  tarefas_criadas   jsonb,        -- lista de ids (ou títulos, no dry_run)
  qtd_tarefas       int not null default 0,
  pulado_por_dedup  boolean not null default false,
  erros             jsonb,

  -- Contexto da execução
  dry_run       boolean not null default false,
  processado_em timestamptz not null default now()
);

-- Consultas típicas: "o que rodou hoje", "o que veio deste e-mail",
-- "o que ficou sem casar".
create index if not exists inss_email_log_msg_idx on public.inss_email_log(gmail_message_id);
create index if not exists inss_email_log_quando_idx on public.inss_email_log(processado_em desc);
create index if not exists inss_email_log_caso_idx on public.inss_email_log(caso_id);

-- RLS: trilha de auditoria é assunto da equipe. O parceiro não vê nada, e
-- ninguém edita — quem escreve é a edge function, com service_role (que passa
-- por cima da RLS).
alter table public.inss_email_log enable row level security;

drop policy if exists inss_email_log_select_interno on public.inss_email_log;
create policy inss_email_log_select_interno on public.inss_email_log
  for select using (public.is_interno());

-- Grants de API. Tabela nova não herda DML para os papéis do PostgREST: sem
-- isto a edge function (service_role) recebia "permission denied" e a
-- auditoria ficava silenciosamente vazia. `authenticated` já vem com os
-- grants padrão; quem limita a leitura é a policy acima, e escrever é
-- bloqueado por não existir policy de insert/update.
grant select, insert, update on public.inss_email_log to service_role;
