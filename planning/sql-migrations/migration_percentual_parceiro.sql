-- % de repasse padrão por parceiro.
--
-- Cada parceiro tem um percentual de divisão de honorários (varia por acordo:
-- 50/50, 70/30, 60/40 etc.). Guardado no próprio usuário e usado para
-- pré-preencher e calcular os repasses (repasses.valor = total × percentual).
-- O default 30 mantém compatibilidade com o default histórico de repasses.

alter table public.usuarios
  add column if not exists percentual_parceiro numeric not null default 30;
