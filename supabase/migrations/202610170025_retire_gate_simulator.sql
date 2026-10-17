-- Historical records are retained under existing admin SELECT RLS. The shared
-- manual booking/session lifecycle, timeout and retention helpers remain.
drop function public.simulate_gate(text,uuid,text);
drop function public.parking_access_dashboard();
update public.gates set is_active=false;
revoke all on public.gates from anon,authenticated;
revoke insert,update,delete on public.access_events,public.parking_sessions from anon,authenticated;
create or replace function public.seed_access_catalog() returns void language plpgsql security definer set search_path='' as $$begin return;end $$;
-- Reset fixtures using stable floor-specific zone codes, independent of names.
do $$declare d text;begin
select pg_get_functiondef('public.reset_demo_internal(text)'::regprocedure) into d;
d:=replace(d,$q$z.name=case when scenario='A' then 'Zone B' else 'Zone A' end$q$,$q$z.code=case when scenario='A' then 'B' else 'A' end$q$);execute d;
select pg_get_functiondef('public.reset_demo(text)'::regprocedure) into d;
d:=replace(d,$q$z.name=case when sc='E' then 'Zone A' else 'Zone B' end$q$,$q$z.code=case when sc='E' then 'A' else 'B' end$q$);
d:=replace(d,$q$and x.is_active and x.inventory_class='bookable'$q$,$q$and z.floor='B1' and x.is_active and x.inventory_class='bookable'$q$);execute d;
end $$;
