-- Fictional gates and explicit inventory; no zone percentages.
insert into public.gates(id,mall_id,name,direction) select md5('parkahead:gate:'||m.id||':'||d)::uuid,m.id,case when d='entry' then 'Demo entry gate' else 'Demo exit gate' end,d from public.malls m cross join unnest(array['entry','exit']) d where m.layout_key like 'fictional-layout-%' on conflict(id) do nothing;
update public.bays b set inventory_class='walk_in_only' where b.id in(select x.id from public.bays x join public.zones z on z.id=x.zone_id join public.parking_floors f on f.id=z.floor_id where f.name='B2' and x.bay_type='standard' and right(x.label,2) in('07','08')) and not exists(select 1 from public.reservations r where r.bay_id=b.id and r.status in('confirmed','checked_in'));
create function public.plate_confirmation_event() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at) values(new.id,auth.uid(),'plate_confirmed',public.parking_now(new.is_demo));return new;end $$;
create trigger plate_confirmation_event after insert on public.reservations for each row execute function public.plate_confirmation_event();
create function public.parking_access_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;perform public.lock_parking_clock();
return jsonb_build_object('serverTime',public.parking_now((select demo_mode from public.runtime_settings where singleton)),
'gates',coalesce((select jsonb_agg(to_jsonb(g) order by mall_id,direction) from public.gates g),'[]'),
'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by entered_at desc) from public.parking_sessions s),'[]'),
'exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc) from public.access_events e where event_type in('unmatched_exit','cross_mall_session_anomaly')),'[]'),
'metrics',jsonb_build_object('vehiclesInside',(select count(*) from public.parking_sessions where status='open'),'openBooked',(select count(*) from public.parking_sessions where status='open' and reservation_id is not null),'openUnassociatedWalkIns',(select count(*) from public.parking_sessions where status='open' and reservation_id is null),
'walkInEntries',(select count(*) from public.access_events where event_type='gate_entry_walk_in'),'plateMatchedCheckIns',(select count(*) from public.access_events where event_type='gate_entry_booking_match'),'earlyArrivalReconciliations',(select count(*) from public.access_events where event_type='early_arrival_reconciled'),'manualFallbackCheckIns',(select count(*) from public.access_events where event_type='manual_check_in'),'exits',(select count(*) from public.access_events where event_type='gate_exit'),'unmatchedExits',(select count(*) from public.access_events where event_type='unmatched_exit'),'autoClosed',(select count(*) from public.access_events where event_type='session_auto_closed'),'noShowReleases',(select count(*) from public.booking_events where event_type='no_show_released')),
'capacity',coalesce((select jsonb_agg(jsonb_build_object('mallId',m.id,'mallName',m.name,'walkInBayCount',(select count(*) from public.bays b join public.zones z on z.id=b.zone_id join public.parking_floors f on f.id=z.floor_id where b.mall_id=m.id and b.is_active and z.is_active and f.is_active and b.inventory_class='walk_in_only'),'openUnassociatedWalkIns',(select count(*) from public.parking_sessions s where s.mall_id=m.id and s.status='open' and s.reservation_id is null))) from public.malls m where m.is_active),'[]'),
'bookings',coalesce((select jsonb_agg(public.booking_details(r.id) order by r.start_at desc) from public.reservations r),'[]'));
end $$;
-- Reset only invoking admin's demo sessions and fixtures.
do $$declare d text;begin
select pg_get_functiondef('public.reset_demo(text)'::regprocedure) into d;
d:=replace(d,'perform 1 from public.runtime_settings where singleton and demo_mode for update;','perform public.lock_parking_clock(); perform 1 from public.runtime_settings where singleton and demo_mode for update;');
d:=replace(d,'delete from public.booking_events e using', 'delete from public.access_events where session_id in(select id from public.parking_sessions where is_demo and created_by=auth.uid()) or reservation_id in(select id from public.reservations where is_demo and demo_scenario is not null and user_id=auth.uid()); delete from public.parking_sessions where is_demo and created_by=auth.uid(); delete from public.booking_events e using');
execute d;
select pg_get_functiondef('public.advance_demo_clock(integer)'::regprocedure) into d;d:=replace(d,'begin','begin perform public.lock_parking_clock();');execute d;
select pg_get_functiondef('public.rebook_demo(uuid)'::regprocedure) into d;d:=replace(d,'old.id);','old.id,old.normalized_plate);');execute d;
end $$;
alter function public.reset_demo(text) rename to reset_demo_internal;
alter table public.reservations drop constraint reservations_demo_scenario_check;
alter table public.reservations add constraint reservations_demo_scenario_check check(demo_scenario in('A','B','E','F'));
create function public.reset_demo(p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$declare m record;sc text;b uuid;s timestamptz;begin
perform public.lock_parking_clock();perform public.reset_demo_internal(p_confirmation);
for m in select id from public.malls where is_demo and is_active and layout_key like 'fictional-layout-%' order by id loop
foreach sc in array array['E','F'] loop
select x.id into b from public.bays x join public.zones z on z.id=x.zone_id where x.mall_id=m.id and z.name=case when sc='E' then 'Zone A' else 'Zone B' end and x.is_active and x.inventory_class='bookable' and x.bay_type='standard' order by x.label offset 1 limit 1;
s:=public.parking_now(true)+interval '10 minutes';
insert into public.reservations(user_id,bay_id,preference,start_at,end_at,idempotency_key,demo_scenario) values(auth.uid(),b,'none',s,s+interval '2 hours',gen_random_uuid(),sc);
end loop;end loop;return public.demo_dashboard();end $$;
do $$declare f record;begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('normalize_plate','lock_plate','reservation_plate_guard','reserve','reserve_bay','update_booking_plate','access_audit','simulate_gate','session_maintenance','plate_confirmation_event','parking_access_dashboard','reset_demo_internal','reset_demo') loop execute 'revoke all on function '||f.signature||' from public,anon,authenticated';end loop;end $$;
grant execute on function public.reserve(uuid,uuid,timestamptz,timestamptz,uuid,text,uuid,text),public.reserve_bay(uuid,uuid,timestamptz,timestamptz,uuid,text[],text[],uuid,text),public.update_booking_plate(uuid,text),public.simulate_gate(text,uuid,text),public.parking_access_dashboard(),public.reset_demo(text) to authenticated;
