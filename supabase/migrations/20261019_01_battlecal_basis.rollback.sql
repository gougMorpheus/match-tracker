-- Rollback zu 20261019_01_battlecal_basis.sql: entfernt NUR Battle-Cal (Schema battlecal + public.bc_*).
-- Match-Tracker-Tabellen, mt_*-Funktionen und Realtime bleiben unberuehrt. Vorher Backup!
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'bc\_%' loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;
drop schema if exists battlecal cascade;
-- Optional (separat, nur falls angelegt): delete from vault.secrets where name = 'bc_admin_password_hash';
