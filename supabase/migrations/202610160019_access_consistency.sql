-- Reconcile before collecting a single coherent dashboard snapshot.
do $$declare d text;begin
select pg_get_functiondef('public.parking_access_dashboard()'::regprocedure) into d;
d:=replace(d,'perform public.lock_parking_clock();','perform public.lock_parking_clock();perform public.release_due_no_shows();');
execute d;
-- E/F are real stored reservations and participate in reservation metrics.
select pg_get_functiondef('public.reset_demo(text)'::regprocedure) into d;
d:=replace(d,'sc text;b uuid;s timestamptz;','sc text;b uuid;s timestamptz;r public.reservations;');
d:=replace(d,'gen_random_uuid(),sc);','gen_random_uuid(),sc) returning * into r; insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),''confirmed'',public.parking_now(true),jsonb_build_object(''scenario'',sc,''simulated'',true));');
execute d;
end $$;
