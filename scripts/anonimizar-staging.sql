-- Anonimização do espelho de STAGING. Roda NO BANCO DE STAGING logo após o
-- restore dos dados de produção, dentro do pipeline scripts/espelho-staging.sh.
-- NUNCA rodar em produção (o guard abaixo aborta se detectar dados sem máscara
-- num banco que não é staging — verificação por nome do projeto via URL não é
-- possível em SQL, então o guard é operacional: o script exige a variável
-- :senha_sintetica, que só o pipeline define).
--
-- Estratégia (LGPD/ANPD: anonimização é tratamento; risco reavaliado a cada
-- refresh — ver planning/AMBIENTES.md):
--   1. TRUNCATE de tabelas que não fazem sentido/são perigosas no staging
--      (chaves de IA, tokens OAuth, trilhas de auditoria, WhatsApp, webhooks).
--   2. Máscara determinística de PII estruturada (clientes, usuarios, leads).
--   3. Passe de TEXTO LIVRE: substitui cada nome real de cliente pelos nomes
--      mascarados em títulos/descrições/comentários (o vazamento clássico),
--      e apaga padrões de CPF remanescentes.
--   4. Usuários de Auth SINTÉTICOS: mesmos UUIDs de public.usuarios, e-mails
--      mascarados, senha única de staging — nenhuma credencial real existe.
--
-- Texto de publicações DJEN/DataJud (andamentos origem djen/datajud e
-- publicacoes_dje) é mantido: fonte pública oficial (publicidade processual).

begin;

create extension if not exists pgcrypto with schema extensions;

-- ============ 1. TRUNCATES ============
truncate table
  public.ia_integracoes,
  public.ia_tokens,
  public.ia_acoes,
  public.usuario_gmail_oauth,
  public.aceites_termos,
  public.acessos_documento,
  public.acessos_senha_inss,
  public.alertas_duplicidade,
  public.mensagens,
  public.webhook_eventos,
  public.whatsapp_mensagens,
  public.whatsapp_outbox,
  public.whatsapp_sessoes,
  public.whatsapp_lid_map,
  public.whatsapp_ativacao_codigos
  cascade;

-- Webhooks ficam DESLIGADOS no staging (n8n é o de produção).
update public.webhook_destinos
   set ativo = false, url = 'https://staging.invalid/webhook';

-- ============ 2. MÁSCARAS DETERMINÍSTICAS ============
-- Sufixo estável por id: staging consistente entre refreshes.
create or replace function pg_temp.sufixo(p_id uuid) returns text
language sql immutable as $$ select upper(substr(md5(p_id::text), 1, 6)) $$;

-- Mapa nome real -> nome mascarado (usado no passe de texto livre).
create temp table mapa_nomes as
select id,
       nome as nome_real,
       'Cliente ' || pg_temp.sufixo(id) as nome_fake
  from public.clientes
 where nome is not null and length(trim(nome)) > 2;

update public.clientes c set
  nome            = m.nome_fake,
  cpf             = lpad((('x' || substr(md5(c.id::text), 1, 10))::bit(40)::bigint % 100000000000)::text, 11, '0'),
  telefone        = case when c.telefone is null then null
                         else '659' || lpad((('x' || substr(md5(c.id::text), 13, 7))::bit(28)::bigint % 100000000)::text, 8, '0') end,
  email           = case when c.email is null then null
                         else 'cliente+' || lower(pg_temp.sufixo(c.id)) || '@staging.invalid' end,
  senha_meu_inss  = null,
  endereco        = case when c.endereco is null then null else 'Endereço mascarado (staging)' end,
  data_nascimento = case when c.data_nascimento is null then null
                         else make_date(extract(year from c.data_nascimento)::int, 1, 1) end,
  observacoes     = case when c.observacoes is null then null else '[observações removidas no espelho]' end,
  ti_dados        = null
from mapa_nomes m where m.id = c.id;

-- Usuários: internos mantêm nome; parceiros REAIS são mascarados. Contas da
-- própria equipe (nairaromerovian+*, e2e+*, @marasandraconnect.com) mantêm o
-- e-mail — são de teste/equipe, não PII de terceiro — pra login familiar no
-- staging (senha vira a sintética de qualquer forma).
update public.usuarios u set
  nome      = case when u.tipo = 'parceiro'
                    and u.email not like 'nairaromerovian%'
                   then 'Parceiro ' || pg_temp.sufixo(u.id) else u.nome end,
  email     = case when u.email like 'nairaromerovian%'
                     or u.email like 'e2e+%'
                     or u.email like '%@marasandraconnect.com'
                   then u.email
                   else lower(u.tipo::text) || '+' || lower(pg_temp.sufixo(u.id)) || '@staging.invalid' end,
  telefone  = null,
  oab       = case when u.oab is null then null else 'UF' || substr(md5(u.id::text), 1, 5) end,
  documento = null,
  endereco  = null,
  avatar_url = null;

update public.leads set
  nome        = 'Lead ' || pg_temp.sufixo(id),
  whatsapp    = case when whatsapp is null then null
                     else '659' || lpad((('x' || substr(md5(id::text), 1, 7))::bit(28)::bigint % 100000000)::text, 8, '0') end,
  observacoes = case when observacoes is null then null else '[removido no espelho]' end,
  oab         = null;
update public.lead_comentarios set texto = '[comentário removido no espelho]';

update public.oabs_monitoradas
   set numero = lpad((('x' || substr(md5(id::text), 1, 6))::bit(24)::bigint % 1000000)::text, 6, '0');

-- Análises técnicas carregam dados de saúde no JSON — só a estrutura fica.
update public.analises_tecnicas set
  resultado_json  = '{"mascarado": true}'::jsonb,
  resumo_parceiro = case when resumo_parceiro is null then null else '[resumo removido no espelho]' end;

-- ============ 3. TEXTO LIVRE: troca nomes reais pelos mascarados ============
do $$
declare
  m record;
  padrao text;
  primeiro text;
begin
  for m in select nome_real, nome_fake from mapa_nomes loop
    -- Case-insensitive ('gi') pega "CAROLINI…", "Carolini…" etc.; escapa
    -- metacaracteres de regex que porventura existam no nome.
    padrao := regexp_replace(m.nome_real, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g');
    -- Segundo padrão: PRIMEIRO nome isolado ("do Edilvan…"), com fronteira
    -- de palavra e mínimo de 5 letras (evita capturar palavras comuns).
    primeiro := split_part(m.nome_real, ' ', 1);
    if length(primeiro) >= 5 then
      padrao := '(' || padrao || '|\m' ||
                regexp_replace(primeiro, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') ||
                '\M)';
    end if;
    update public.tarefas set titulo = regexp_replace(titulo, padrao, m.nome_fake, 'gi'),
                              descricao = regexp_replace(descricao, padrao, m.nome_fake, 'gi')
      where titulo ~* padrao or descricao ~* padrao;
    update public.agenda_eventos set titulo = regexp_replace(titulo, padrao, m.nome_fake, 'gi'),
                                     descricao = regexp_replace(descricao, padrao, m.nome_fake, 'gi')
      where titulo ~* padrao or descricao ~* padrao;
    update public.notificacoes set titulo = regexp_replace(titulo, padrao, m.nome_fake, 'gi'),
                                   descricao = regexp_replace(descricao, padrao, m.nome_fake, 'gi')
      where titulo ~* padrao or descricao ~* padrao;
    update public.comentarios set texto = regexp_replace(texto, padrao, m.nome_fake, 'gi')
      where texto ~* padrao;
    update public.solicitacoes_documento set descricao = regexp_replace(descricao, padrao, m.nome_fake, 'gi'),
                                             comentario = regexp_replace(comentario, padrao, m.nome_fake, 'gi')
      where descricao ~* padrao or comentario ~* padrao;
    -- Nome de arquivo: underscore é "letra" pra \m\M, então além do padrão
    -- normal aplica o primeiro nome SEM fronteira ("_Edilvan_LOAS.docx").
    update public.documentos set nome_arquivo = regexp_replace(
        regexp_replace(nome_arquivo, padrao, m.nome_fake, 'gi'),
        regexp_replace(split_part(m.nome_real, ' ', 1), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'),
        m.nome_fake, 'gi')
      where nome_arquivo ~* padrao
         or (length(split_part(m.nome_real, ' ', 1)) >= 5
             and nome_arquivo ~* split_part(m.nome_real, ' ', 1));
    update public.casos set observacoes = regexp_replace(observacoes, padrao, m.nome_fake, 'gi')
      where observacoes ~* padrao;
    -- Andamentos NÃO-públicos (manuais/internos/TI). DJEN/DataJud é fonte pública.
    update public.andamentos set titulo = regexp_replace(titulo, padrao, m.nome_fake, 'gi'),
                                 descricao = regexp_replace(descricao, padrao, m.nome_fake, 'gi')
      where origem not in ('djen', 'datajud')
        and (titulo ~* padrao or descricao ~* padrao);
  end loop;
end $$;

-- CPFs formatados remanescentes em texto livre.
update public.comentarios set texto = regexp_replace(texto, '\d{3}\.\d{3}\.\d{3}-\d{2}', '***.***.***-**', 'g')
 where texto ~ '\d{3}\.\d{3}\.\d{3}-\d{2}';
update public.tarefas set descricao = regexp_replace(descricao, '\d{3}\.\d{3}\.\d{3}-\d{2}', '***.***.***-**', 'g')
 where descricao ~ '\d{3}\.\d{3}\.\d{3}-\d{2}';
update public.casos set observacoes = regexp_replace(observacoes, '\d{3}\.\d{3}\.\d{3}-\d{2}', '***.***.***-**', 'g')
 where observacoes ~ '\d{3}\.\d{3}\.\d{3}-\d{2}';

-- ============ 4. USUÁRIOS DE AUTH SINTÉTICOS ============
-- Mesmos UUIDs de public.usuarios; senha única (:senha_sintetica) pra todos.
-- O wipe de auth.users/identities acontece no passo 2 do pipeline (antes do
-- restore), senão o cascade esbarra nas FKs das tabelas já populadas.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, extensions.crypt(:'senha_sintetica', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
       '', '', '', ''
from public.usuarios u where u.ativo;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from public.usuarios u where u.ativo;

commit;

-- Relatório rápido.
select 'clientes mascarados: ' || count(*) from public.clientes
union all select 'usuarios auth sintéticos: ' || count(*) from auth.users
union all select 'webhooks ativos (deve ser 0): ' || count(*) from public.webhook_destinos where ativo;
