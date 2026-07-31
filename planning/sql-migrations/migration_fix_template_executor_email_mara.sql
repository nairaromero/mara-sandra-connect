-- Corrige e-mail órfão nos templates de tarefa.
--
-- Os templates "concedido" e "indeferido" apontavam executor_email (e
-- interessados_emails) pra marasandra.adv@gmail.com, mas a conta da Mara no
-- sistema é nairaromerovian+mara@gmail.com. O lookup e-mail→usuário falhava
-- silenciosamente e a tarefa dela saía SEM responsável — era a causa raiz do
-- "responsável só aparece numa das tarefas do template".
--
-- Idempotente: replace não acha nada na segunda execução.

update public.tarefa_templates
set itens = replace(itens::text,
                    'marasandra.adv@gmail.com',
                    'nairaromerovian+mara@gmail.com')::jsonb
where itens::text like '%marasandra.adv@gmail.com%';
