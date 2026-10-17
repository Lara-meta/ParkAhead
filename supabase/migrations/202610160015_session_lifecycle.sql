-- Unified session lifecycle. All mutation paths lock global -> clock -> plate -> rows.
create function public.access_audit(t text,s uuid,r uuid,g uuid,n timestamptz,d boolean,reason text default null) returns void language sql security definer set search_path='' as $$insert into public.access_events(event_type,session_id,reservation_id,gate_id,created_at,is_demo,actor_user_id,reason_code) values(t,s,r,g,n,d,auth.uid(),reason)$$;
create or replace function public.release_one_no_show(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.reservations;s public.parking_sessions;n timestamptz;m uuid;
begin perform public.lock_parking_clock();select * into r from public.reservations where id=p_id; if not found then return false;end if;perform public.lock_plate(r.normalized_plate);
select * into r from public.reservations where id=p_id for update;n:=public.parking_now(r.is_demo);
if r.status<>'confirmed' or n<r.arrival_deadline then return false;end if;
select mall_id into m from public.bays where id=r.bay_id;
select * into s from public.parking_sessions where normalized_plate=r.normalized_plate and mall_id=m and status='open' and reservation_id is null and entry_classification='walk_in' and entered_at<r.start_at and is_demo=r.is_demo for update;
if found then
update public.parking_sessions set reservation_id=r.id,association_type='early_arrival',updated_at=n where id=s.id;
update public.reservations set status='checked_in',checked_in_at=n,updated_at=n where id=r.id;
insert into public.booking_events(reservation_id,event_type,created_at,details) values(r.id,'early_arrival_reconciled',n,jsonb_build_object('sessionId',s.id));
perform public.access_audit('early_arrival_reconciled',s.id,r.id,null,n,r.is_demo);return false;
end if;
update public.reservations set status='no_show',released_at=n,updated_at=n where id=r.id;
insert into public.booking_events(reservation_id,event_type,created_at,details) values(r.id,'no_show_released',n,jsonb_build_object('simulated',true,'released_minutes',greatest(0,extract(epoch from(r.end_at-n))/60)));return true;end $$;
create or replace function public.release_due_no_shows() returns integer language plpgsql security definer set search_path='' as $$declare v record;c integer:=0;begin
perform public.lock_parking_clock();for v in select id from public.reservations where status='confirmed' and arrival_deadline<=public.parking_now(is_demo) order by normalized_plate nulls last,id loop if public.release_one_no_show(v.id) then c:=c+1;end if;end loop;
insert into public.cleanup_runs(released_count) values(c);return c;end $$;
create function public.simulate_gate(p_plate text,p_gate uuid,p_direction text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.gates;v text;s public.parking_sessions;r public.reservations;n timestamptz;d boolean;classification text;message text;
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
perform public.lock_parking_clock();v:=public.normalize_plate(p_plate);perform public.lock_plate(v);
select * into g from public.gates where id=p_gate and is_active and direction=p_direction for share;
if not found or p_direction not in('entry','exit') then raise exception 'INVALID_GATE' using errcode='22023';end if;
d:=public.mall_uses_demo(g.mall_id);
if not g.is_demo or not d then raise exception 'SIMULATOR_REQUIRES_DEMO_MODE' using errcode='22023';end if;
n:=public.parking_now(d);
-- Only this plate is reconciled. Never revive a final booking.
perform public.release_one_no_show(id) from public.reservations where normalized_plate=v and status='confirmed' and arrival_deadline<=n order by id;
select * into s from public.parking_sessions where normalized_plate=v and status='open' for update;
if found and (s.mall_id<>g.mall_id or s.is_demo<>d) then
perform public.access_audit('cross_mall_session_anomaly',s.id,null,g.id,n,d,'OPEN_AT_OTHER_MALL');
return jsonb_build_object('classification','exception','message','Open session at another mall; entry was not registered. Operator review required.','barrierOpen',true,'registered',false,'serverTime',n,'gateId',g.id);
end if;
if p_direction='entry' then
if s.id is not null then
perform public.access_audit('duplicate_entry',s.id,s.reservation_id,g.id,n,d);
return jsonb_build_object('classification','existing_session','message','Vehicle already has an open session; existing session returned.','barrierOpen',true,'sessionId',s.id,'reservationId',s.reservation_id,'serverTime',n,'gateId',g.id);
end if;
select x.* into r from public.reservations x join public.bays b on b.id=x.bay_id where x.normalized_plate=v and b.mall_id=g.mall_id and x.is_demo=d and x.status='confirmed' and x.start_at<=n and n<x.arrival_deadline order by x.start_at limit 1 for update of x;
insert into public.parking_sessions(mall_id,normalized_plate,entry_gate_id,entered_at,entry_classification,reservation_id,association_type,is_demo,created_by,updated_at) values(g.mall_id,v,g.id,n,case when r.id is null then 'walk_in' else 'booking' end,r.id,case when r.id is not null then 'direct_booking' end,d,auth.uid(),n) returning * into s;
if r.id is not null then
update public.reservations set status='checked_in',checked_in_at=n,updated_at=n where id=r.id;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),'checked_in',n,jsonb_build_object('source','plate_match','sessionId',s.id));
perform public.access_audit('gate_entry_booking_match',s.id,r.id,g.id,n,d);classification:='booking_checked_in';message:='Booking found, checked in. Plate matched at gate';
else perform public.access_audit('gate_entry_walk_in',s.id,null,g.id,n,d);classification:='walk_in_registered';message:='Registered as walk-in';end if;
else
if s.id is null then
select * into s from public.parking_sessions where normalized_plate=v and mall_id=g.mall_id and is_demo=d and status<>'open' order by exited_at desc limit 1;
if found then classification:='already_closed';message:='Session already closed';
else
-- Compatibility for pre-session checked-in records with a real stored plate.
select x.* into r from public.reservations x join public.bays b on b.id=x.bay_id where x.normalized_plate=v and b.mall_id=g.mall_id and x.is_demo=d and x.status='checked_in' order by x.start_at limit 1 for update of x;
if found then
update public.reservations set status='completed',completed_at=n,updated_at=n where id=r.id;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),'completed',n,'{"source":"legacy_gate_exit"}');
perform public.access_audit('gate_exit',null,r.id,g.id,n,d);classification:='booking_completed';message:='Legacy booking completed; no session was fabricated';
else perform public.access_audit('unmatched_exit',null,null,g.id,n,d,'NO_OPEN_SESSION');classification:='unmatched_exit';message:='No matching open session; exit exception recorded';end if;end if;
else
update public.parking_sessions set status='closed',exited_at=n,exit_gate_id=g.id,closure_reason='simulated_exit',updated_at=n where id=s.id;
update public.reservations set status='completed',completed_at=n,updated_at=n where id=s.reservation_id and status='checked_in' returning * into r;
if found then insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),'completed',n,jsonb_build_object('source','gate_exit','sessionId',s.id));classification:='booking_completed';else classification:='session_closed';end if;
perform public.access_audit('gate_exit',s.id,s.reservation_id,g.id,n,d);message:='Session closed';
end if;
message:=message||'. Demo exit approved; payment verification is simulated.';
end if;
return jsonb_build_object('classification',classification,'message',message,'barrierOpen',true,'sessionId',s.id,'reservationId',coalesce(r.id,s.reservation_id),'serverTime',n,'gateId',g.id,'normalizedPlate',v);
end $$;
create or replace function public.transition(p_id uuid,p_next text) returns public.reservations language plpgsql security definer set search_path='' as $$
declare r public.reservations;s public.parking_sessions;n timestamptz;m uuid;
begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
perform public.lock_parking_clock();select * into r from public.reservations where id=p_id and(user_id=auth.uid() or public.is_admin());if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
perform public.lock_plate(r.normalized_plate);select * into r from public.reservations where id=p_id for update;n:=public.parking_now(r.is_demo);select mall_id into m from public.bays where id=r.bay_id;
if r.status=p_next then return r;end if;
if r.status='confirmed' and n>=r.arrival_deadline then perform public.release_one_no_show(r.id);select * into r from public.reservations where id=p_id;return r;end if;
if p_next='checked_in' then
if r.status<>'confirmed' then return r;end if;
if n<r.start_at then raise exception 'ARRIVAL_TOO_EARLY' using errcode='P0001';end if;
if r.normalized_plate is null and not public.is_admin() then raise exception 'LEGACY_PLATE_REQUIRES_ADMIN_ASSISTANCE' using errcode='23P01';end if;
select * into s from public.parking_sessions where status='open' and(normalized_plate=r.normalized_plate or reservation_id=r.id) for update;
if found then
if s.mall_id<>m or s.is_demo<>r.is_demo or(s.reservation_id is not null and s.reservation_id<>r.id) then raise exception 'SESSION_ASSOCIATION_CONFLICT' using errcode='23P01';end if;
update public.parking_sessions set reservation_id=r.id,association_type='manual_fallback',updated_at=n where id=s.id;
else
insert into public.parking_sessions(mall_id,normalized_plate,entered_at,entry_classification,reservation_id,association_type,is_demo,created_by,updated_at) values(m,r.normalized_plate,n,'booking',r.id,'manual_fallback',r.is_demo,auth.uid(),n) returning * into s;
end if;
perform public.access_audit('manual_check_in',s.id,r.id,null,n,r.is_demo);
elsif p_next='completed' then
if r.status<>'checked_in' then raise exception 'INVALID_TRANSITION' using errcode='23P01';end if;
update public.parking_sessions set status='closed',exited_at=n,closure_reason='manual_departure',updated_at=n where reservation_id=r.id and status='open' returning * into s;
perform public.access_audit('gate_exit',s.id,r.id,null,n,r.is_demo,'MANUAL_DEPARTURE');
elsif p_next='cancelled' then
if r.user_id<>auth.uid() or r.status<>'confirmed' or n>=r.start_at then raise exception 'INVALID_TRANSITION' using errcode='23P01';end if;
elsif p_next='no_show' then
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;raise exception 'ARRIVAL_NOT_DUE' using errcode='P0001';
else raise exception 'INVALID_TRANSITION' using errcode='23P01';end if;
update public.reservations set status=p_next,updated_at=n,checked_in_at=case when p_next='checked_in' then n else checked_in_at end,completed_at=case when p_next='completed' then n else completed_at end,cancelled_at=case when p_next='cancelled' then n else cancelled_at end where id=r.id returning * into r;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),p_next,n,jsonb_build_object('source','manual_fallback','sessionId',s.id));return r;end $$;
create function public.session_maintenance() returns integer language plpgsql security definer set search_path='' as $$declare s public.parking_sessions;n timestamptz;hours integer;days integer;c integer:=0;begin
perform public.lock_parking_clock();select session_timeout_hours,walk_in_retention_days into hours,days from public.runtime_settings where singleton;
for s in select * from public.parking_sessions where status='open' order by normalized_plate nulls last,id loop
perform public.lock_plate(s.normalized_plate);n:=public.parking_now(s.is_demo);
if n>=s.entered_at+make_interval(hours=>hours) then
update public.parking_sessions set status='auto_closed',exited_at=n,closure_reason='timeout',updated_at=n where id=s.id;
update public.reservations set status='completed',completed_at=n,updated_at=n where id=s.reservation_id and status='checked_in';
if found then insert into public.booking_events(reservation_id,event_type,created_at,details) values(s.reservation_id,'completed',n,'{"source":"administrative_timeout","physicalDepartureVerified":false}');end if;
perform public.access_audit('session_auto_closed',s.id,s.reservation_id,null,n,s.is_demo,'TIMEOUT');c:=c+1;end if;end loop;
for s in select * from public.parking_sessions where status<>'open' and entry_classification='walk_in' and reservation_id is null and normalized_plate is not null loop
n:=public.parking_now(s.is_demo);if n>=s.exited_at+make_interval(days=>days) then
update public.parking_sessions set normalized_plate=null,updated_at=n where id=s.id;perform public.access_audit('plate_retention_purge',s.id,null,null,n,s.is_demo);end if;end loop;return c;end $$;
-- Preserve existing no-show job; second minute job uses identical lock order.
select cron.schedule('parkahead-session-maintenance','* * * * *','select public.session_maintenance();');
-- Remove token lookup authority, keeping column only for historical compatibility.
do $$declare d text;begin select pg_get_functiondef('public.booking_details(uuid,uuid)'::regprocedure) into d;d:=replace(d,'(id=p_id or check_in_token=p_token)',' id=p_id');d:=replace(d,'where(id=p_id or check_in_token=p_token)','where id=p_id');d:=replace(d,'select to_jsonb(v)||','select (to_jsonb(v)-''check_in_token'')||');execute d;end $$;

