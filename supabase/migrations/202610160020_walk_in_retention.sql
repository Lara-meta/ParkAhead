-- Purge the session copy for every closed session originating as a walk-in,
-- including an early arrival later associated with a reservation. The separate
-- reservation plate is deliberately untouched by this session-retention rule.
do $$declare d text;begin
select pg_get_functiondef('public.session_maintenance()'::regprocedure) into d;
d:=replace(d,'and reservation_id is null and normalized_plate is not null','and normalized_plate is not null');
execute d;
end $$;
