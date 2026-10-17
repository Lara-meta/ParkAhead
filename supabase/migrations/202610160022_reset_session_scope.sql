-- A fixture reset must preserve ordinary booking-linked sessions, even when
-- their simulated gate entry was performed by the invoking demo admin.
do $$declare d text;begin
select pg_get_functiondef('public.reset_demo_internal(text)'::regprocedure) into d;
d:=replace(d,'where is_demo and created_by=auth.uid()',
'where is_demo and ((reservation_id is null and created_by=auth.uid()) or reservation_id in(select id from public.reservations where is_demo and demo_scenario is not null and user_id=auth.uid()))');
execute d;
end $$;
