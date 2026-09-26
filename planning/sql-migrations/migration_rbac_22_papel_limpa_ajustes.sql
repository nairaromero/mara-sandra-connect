-- migration_rbac_22_papel_limpa_ajustes.sql
--
-- Trocar o papel de alguém passa a DESFAZER os ajustes individuais dela.
--
-- Sem isto, um ajuste feito para o papel antigo sobrevive e vira surpresa: a
-- assistente que teve `documentos:excluir` concedido continua com ele depois de
-- virar financeira, e o advogado que teve algo REMOVIDO segue sem aquilo mesmo
-- depois de virar admin — sem que ninguém lembre por quê.
--
-- A régua é a mesma do resto do desenho: o ajuste é uma diferença em relação a
-- UM papel; mudou o papel, a diferença perdeu o sentido. Quem quiser o ajuste
-- no papel novo refaz, e isso fica auditado como sempre.
--
-- A limpeza é auditada junto com a troca (quantos ajustes caíram).
--
-- Idempotente: o remendo parte da definição que está no banco e não se aplica
-- duas vezes.

do $$
declare
  v_def text;
  v_new text;
  v_achar text := 'update public.membros';
  v_trocar text :=
'  -- Ajustes individuais são diferenças em relação ao papel ANTIGO: mudou o
  -- papel, caem (migration_rbac_22). Quem quiser mantê-los refaz no papel novo.
  delete from public.membro_permissoes where membro_id = v_m.id;
  update public.membros';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'definir_papel'
   limit 1;

  if v_def is null then
    raise warning 'definir_papel não existe neste banco — pulada';
  elsif position('membro_permissoes' in v_def) > 0 then
    null; -- já aplicado
  elsif position(v_achar in v_def) = 0 then
    raise exception 'definir_papel: não achei o "update public.membros" — a função mudou, revisar o remendo';
  else
    v_new := overlay(v_def placing v_trocar from position(v_achar in v_def) for length(v_achar));
    execute v_new;
    raise notice 'definir_papel: passa a desfazer os ajustes individuais';
  end if;
end $$;

notify pgrst, 'reload schema';
