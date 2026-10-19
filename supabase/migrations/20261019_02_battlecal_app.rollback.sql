-- Rollback zu 20261019_02_battlecal_app.sql (Basis-Migration 20261019_01 bleibt bestehen).
-- Die alten ID-Grenzen (120/200) lassen sich nur wiederherstellen, wenn keine laengeren IDs gespeichert sind;
-- sonst schlaegt das "add constraint" fehl und die ganze Transaktion bleibt unveraendert. Dann nur die Funktionen entfernen.
begin;
drop function if exists public.bc_roster_import(uuid, text, jsonb, jsonb, jsonb);
drop function if exists public.bc_results_upsert_many(uuid, text, jsonb);
alter table battlecal.results      drop constraint if exists results_id_check;
alter table battlecal.results      add  constraint results_id_check      check (length(id) between 1 and 120);
alter table battlecal.army_rosters drop constraint if exists army_rosters_id_check;
alter table battlecal.army_rosters add  constraint army_rosters_id_check check (length(id) between 1 and 120);
alter table battlecal.army_units   drop constraint if exists army_units_id_check;
alter table battlecal.army_units   add  constraint army_units_id_check   check (length(id) between 1 and 200);
alter table battlecal.army_weapons drop constraint if exists army_weapons_id_check;
alter table battlecal.army_weapons add  constraint army_weapons_id_check check (length(id) between 1 and 200);
commit;
