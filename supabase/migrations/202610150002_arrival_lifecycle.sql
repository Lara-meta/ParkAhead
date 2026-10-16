-- Additive arrival lifecycle. Existing reservations remain real-clock records.
create table public.runtime_settings (
  singleton boolean primary key default true check(singleton),
  demo_mode boolean not null default false,
  demo_now timestamptz not null default '2030-01-15 02:00:00+00',
  grace_minutes integer not null default 15 check(grace_minutes between 1 and 479)
);
insert into public.runtime_settings(singleton) values(true);
alter table public.runtime_settings enable row level security;
revoke all on public.runtime_settings from anon,authenticated;
alter table public.malls add column is_demo boolean not null default false;
update public.malls set is_demo=true where id='10000000-0000-4000-8000-000000000001' and name='Demo Central Mall';
alter table public.reservations
  add column arrival_deadline timestamptz,
  add column check_in_token uuid not null default gen_random_uuid(),
  add column released_at timestamptz,
  add column is_demo boolean not null default false,
  add column demo_scenario text check(demo_scenario in ('A','B'));
update public.reservations set arrival_deadline=least(end_at,start_at+interval '15 minutes');
alter table public.reservations alter column arrival_deadline set not null;
alter table public.reservations add constraint valid_arrival_deadline check(arrival_deadline>start_at and arrival_deadline<=end_at);
create unique index reservation_arrival_token on public.reservations(check_in_token);
create index reservations_due_arrival on public.reservations(arrival_deadline,id) where status='confirmed';
create unique index lifecycle_event_once on public.booking_events(reservation_id,event_type)
  where event_type in ('checked_in','completed','no_show_released');
create table public.cleanup_runs(id uuid primary key default gen_random_uuid(),executed_at timestamptz not null default clock_timestamp(),released_count integer not null);
alter table public.cleanup_runs enable row level security;
revoke all on public.cleanup_runs from anon,authenticated;
create table public.zone_guidance(
  zone_id uuid primary key references public.zones,
  vehicle_entrance text not null,lift_lobby text not null,
  driving_instructions text[] not null
);
alter table public.zone_guidance enable row level security;
grant select on public.zone_guidance to anon,authenticated;
create policy safe_guidance on public.zone_guidance for select using(true);
insert into public.zone_guidance(zone_id,vehicle_entrance,lift_lobby,driving_instructions)
select id,'East Entrance',case name when 'Zone A' then 'Lift Lobby 1' else 'Lift Lobby 2' end,
array['Enter using the East Entrance.','Follow signs to Level B1.','Follow the vehicle aisle toward '||name||'.']
from public.zones where mall_id='10000000-0000-4000-8000-000000000001' and name in ('Zone A','Zone B');

-- Every writer takes the clock lock before reservation/bay locks. Clock advances
-- cannot occur halfway through a booking decision. Real time is evaluated later,
-- after the relevant reservation lock, using clock_timestamp(), not transaction now().
create function public.lock_parking_clock() returns void language plpgsql security definer set search_path='' as $$
begin perform 1 from public.runtime_settings where singleton for share; end $$;
create function public.parking_now(p_demo boolean default false) returns timestamptz language sql volatile security definer set search_path='' as $$
select case when p_demo then demo_now else clock_timestamp() end from public.runtime_settings where singleton
$$;
create function public.mall_uses_demo(p_mall uuid) returns boolean language sql stable security definer set search_path='' as $$
select coalesce((select m.is_demo and s.demo_mode from public.malls m cross join public.runtime_settings s where m.id=p_mall and s.singleton),false)
$$;
create function public.clock_context(p_mall uuid default null) returns jsonb language sql volatile security definer set search_path='' as $$
select jsonb_build_object('demoMode',s.demo_mode,'mallDemo',public.mall_uses_demo(p_mall),
'now',public.parking_now(public.mall_uses_demo(p_mall)),'graceMinutes',s.grace_minutes) from public.runtime_settings s where singleton
$$;
create function public.validate_booking_interval(s timestamptz,e timestamptz,p_demo boolean) returns void language plpgsql security definer set search_path='' as $$
declare n timestamptz:=public.parking_now(p_demo);g integer;
begin select grace_minutes into g from public.runtime_settings where singleton;
if s is null or e is null or not isfinite(s) or not isfinite(e) or s<=n or s>n+interval '30 days' or e-s<interval '30 minutes' or e-s>interval '8 hours' or e-s<=make_interval(mins=>g) then
raise exception 'INVALID_INTERVAL' using errcode='22023';end if;end $$;
create or replace function public.validate_interval(s timestamptz,e timestamptz) returns void language plpgsql set search_path='' as $$
begin perform public.validate_booking_interval(s,e,false);end $$;
create function public.reservation_arrival_defaults() returns trigger language plpgsql security definer set search_path='' as $$
declare m uuid;g integer;
begin
perform public.lock_parking_clock();
select z.mall_id into m from public.bays b join public.zones z on z.id=b.zone_id where b.id=new.bay_id;
new.is_demo:=public.mall_uses_demo(m);
select grace_minutes into g from public.runtime_settings where singleton;
if new.end_at-new.start_at<=make_interval(mins=>g) then raise exception 'DURATION_MUST_EXCEED_GRACE' using errcode='22023';end if;
new.arrival_deadline:=new.start_at+make_interval(mins=>g);
new.created_at:=public.parking_now(new.is_demo);new.updated_at:=new.created_at;
return new;end $$;
create trigger reservation_arrival_defaults before insert on public.reservations for each row execute function public.reservation_arrival_defaults();

-- Internal helper; rechecks eligibility using authoritative time after row lock.
create function public.release_one_no_show(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.reservations;n timestamptz;
begin
select * into r from public.reservations where id=p_id for update;
if not found then return false;end if;
n:=public.parking_now(r.is_demo);
if r.status<>'confirmed' or n<r.arrival_deadline then return false;end if;
update public.reservations set status='no_show',released_at=n,updated_at=n where id=r.id;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details)
values(r.id,null,'no_show_released',n,jsonb_build_object('simulated',true,'released_minutes',greatest(0,extract(epoch from(r.end_at-n))/60)));
return true;end $$;
create function public.release_due_no_shows() returns integer language plpgsql security definer set search_path='' as $$
declare v record;n integer:=0;
begin
perform public.lock_parking_clock();
for v in select id from public.reservations where status='confirmed' and arrival_deadline<=public.parking_now(is_demo) order by id for update skip locked loop
if public.release_one_no_show(v.id) then n:=n+1;end if;
end loop;
insert into public.cleanup_runs(released_count) values(n);
return n;end $$;

create or replace function public.reserve(p_mall uuid,p_zone uuid,p_start timestamptz,p_end timestamptz,p_destination uuid,p_preference text,p_key uuid) returns public.reservations language plpgsql security definer set search_path='' as $$
declare result public.reservations;b public.bays;d boolean;
begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
if p_key is null then raise exception 'INVALID_KEY' using errcode='22023';end if;
perform public.lock_parking_clock();
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
select * into result from public.reservations where user_id=auth.uid() and idempotency_key=p_key;
if found then
if result.start_at is distinct from p_start or result.end_at is distinct from p_end or result.destination_id is distinct from p_destination or result.preference is distinct from p_preference or not exists(select 1 from public.bays x join public.zones z on z.id=x.zone_id where x.id=result.bay_id and z.id=p_zone and z.mall_id=p_mall) then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
perform public.release_one_no_show(result.id);select * into result from public.reservations where id=result.id;return result;end if;
d:=public.mall_uses_demo(p_mall);
perform public.validate_booking_interval(p_start,p_end,d);
if p_preference is null or p_preference not in ('none','shorter_walk','step_free') or (p_preference<>'none' and p_destination is null) then raise exception 'INVALID_PREFERENCE' using errcode='22023';end if;
if p_destination is not null and not exists(select 1 from public.destinations where id=p_destination and mall_id=p_mall) then raise exception 'INVALID_DESTINATION' using errcode='22023';end if;
perform public.release_due_no_shows();
perform 1 from public.zones z join public.malls m on m.id=z.mall_id where z.id=p_zone and m.id=p_mall and z.is_active and m.is_active for share of z,m;
if not found then raise exception 'ZONE_UNAVAILABLE' using errcode='P0002';end if;
if p_preference='step_free' and not exists(select 1 from public.zone_destination_routes where zone_id=p_zone and destination_id=p_destination and is_verified and is_step_free=true) then raise exception 'ROUTE_UNAVAILABLE' using errcode='P0002';end if;
for b in select * from public.bays where zone_id=p_zone and is_active and bay_type='standard' order by label for update loop
begin
insert into public.reservations(user_id,bay_id,destination_id,preference,start_at,end_at,idempotency_key) values(auth.uid(),b.id,p_destination,p_preference,p_start,p_end,p_key) returning * into result;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(result.id,auth.uid(),'confirmed',public.parking_now(result.is_demo),jsonb_build_object('simulated',result.is_demo));return result;
exception when exclusion_violation then continue;end;
end loop;
raise exception 'NO_AVAILABILITY' using errcode='23P01';end $$;

create or replace function public.availability(p_mall uuid,p_start timestamptz,p_end timestamptz,p_destination uuid default null)
returns table("zoneId" uuid,"zoneName" text,floor text,"availableBayCount" bigint,"walkingDistanceM" integer,"stepFree" boolean,verified boolean)
language plpgsql security definer set search_path='' as $$
begin
perform public.lock_parking_clock();perform public.validate_booking_interval(p_start,p_end,public.mall_uses_demo(p_mall));
perform public.release_due_no_shows();
return query select z.id,z.name,z.floor,count(b.id),r.walking_distance_m,r.is_step_free,coalesce(r.is_verified,false)
from public.zones z join public.malls m on m.id=z.mall_id
left join public.bays b on b.zone_id=z.id and b.is_active and b.bay_type='standard' and not exists(select 1 from public.reservations v where v.bay_id=b.id and v.status in ('confirmed','checked_in') and v.start_at<p_end and v.end_at>p_start)
left join public.zone_destination_routes r on r.zone_id=z.id and r.destination_id=p_destination
where m.id=p_mall and m.is_active and z.is_active group by z.id,r.walking_distance_m,r.is_step_free,r.is_verified order by z.name;
end $$;

create or replace function public.transition(p_id uuid,p_next text) returns public.reservations language plpgsql security definer set search_path='' as $$
declare r public.reservations;n timestamptz;
begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
perform public.lock_parking_clock();
select * into r from public.reservations where id=p_id and(user_id=auth.uid() or public.is_admin()) for update;
if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
n:=public.parking_now(r.is_demo);
-- Expected retries return current state without another event. No terminal state can revive.
if r.status=p_next and p_next in ('checked_in','completed','cancelled','no_show') then return r;end if;
if r.status='confirmed' and n>=r.arrival_deadline then
perform public.release_one_no_show(r.id);select * into r from public.reservations where id=p_id;return r;end if;
if p_next='checked_in' then
if r.status<>'confirmed' then return r;end if;
if n<r.start_at then raise exception 'ARRIVAL_TOO_EARLY' using errcode='P0001';end if;
elsif p_next='completed' then
if r.status<>'checked_in' then raise exception 'INVALID_TRANSITION' using errcode='23P01';end if;
elsif p_next='cancelled' then
if r.user_id<>auth.uid() or r.status<>'confirmed' or n>=r.start_at then raise exception 'INVALID_TRANSITION' using errcode='23P01';end if;
elsif p_next='no_show' then
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
raise exception 'ARRIVAL_NOT_DUE' using errcode='P0001';
else raise exception 'INVALID_TRANSITION' using errcode='23P01';end if;
update public.reservations set status=p_next,updated_at=n,
cancelled_at=case when p_next='cancelled' then n else cancelled_at end,
checked_in_at=case when p_next='checked_in' then n else checked_in_at end,
completed_at=case when p_next='completed' then n else completed_at end where id=r.id returning * into r;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),p_next,n,jsonb_build_object('simulated',true));return r;
end $$;

-- Token possession grants nothing. Both lookup forms require owner/admin identity.
create function public.booking_details(p_id uuid default null,p_token uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations;result jsonb;
begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
perform public.lock_parking_clock();
select * into r from public.reservations where (id=p_id or check_in_token=p_token) and(user_id=auth.uid() or public.is_admin()) for update;
if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
perform public.release_one_no_show(r.id);
select to_jsonb(v)||jsonb_build_object('server_now',public.parking_now(v.is_demo),
'bays',jsonb_build_object('label',b.label,'zones',jsonb_build_object('id',z.id,'name',z.name,'floor',z.floor,'malls',jsonb_build_object('name',m.name))),
'destinations',case when d.id is not null then jsonb_build_object('name',d.name) else null end,
'guidance',case when g.zone_id is not null then to_jsonb(g) else null end,
'route',case when rt.id is not null then jsonb_build_object('is_verified',rt.is_verified,'is_step_free',rt.is_step_free,'walking_distance_m',rt.walking_distance_m,'route_description',rt.route_description) else null end)
into result from public.reservations v join public.bays b on b.id=v.bay_id join public.zones z on z.id=b.zone_id join public.malls m on m.id=z.mall_id
left join public.destinations d on d.id=v.destination_id left join public.zone_guidance g on g.zone_id=z.id
left join public.zone_destination_routes rt on rt.zone_id=z.id and rt.destination_id=v.destination_id where v.id=r.id;
return result;end $$;

create function public.demo_metrics() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
'reservationsCreated',count(distinct r.id) filter(where e.event_type='confirmed'),
'checkIns',count(distinct r.id) filter(where e.event_type='checked_in'),
'completed',count(distinct r.id) filter(where e.event_type='completed'),
'noShows',count(distinct r.id) filter(where e.event_type='no_show_released'),
'scheduledMinutesReleased',coalesce(sum(greatest(0,extract(epoch from(r.end_at-r.released_at))/60)) filter(where e.event_type='no_show_released'),0))
from public.reservations r join public.booking_events e on e.reservation_id=r.id where r.is_demo
$$;
create function public.demo_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
return jsonb_build_object('clock',public.clock_context('10000000-0000-4000-8000-000000000001'),
'metrics',public.demo_metrics(),'lastCleanup',(select to_jsonb(c) from public.cleanup_runs c order by executed_at desc limit 1),
'bookings',coalesce((select jsonb_agg(public.booking_details(r.id)) from public.reservations r where r.demo_scenario is not null and r.user_id=auth.uid()),'[]'::jsonb));
end $$;
create function public.advance_demo_clock(p_minutes integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
if p_minutes is null or p_minutes<1 or p_minutes>10080 then raise exception 'INVALID_MINUTES' using errcode='22023';end if;
perform 1 from public.runtime_settings where singleton and demo_mode for update;
if not found then raise exception 'DEMO_DISABLED' using errcode='22023';end if;
update public.runtime_settings set demo_now=demo_now+make_interval(mins=>p_minutes) where singleton;
return public.clock_context('10000000-0000-4000-8000-000000000001');end $$;
create function public.admin_cleanup() returns integer language plpgsql security definer set search_path='' as $$
begin if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;return public.release_due_no_shows();end $$;

-- Reset touches only fixtures owned by the invoking admin. No auth or unrelated rows are deleted.
create function public.reset_demo(p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare base timestamptz:='2030-01-15 02:00:00+00';b uuid;z uuid;r public.reservations;scenario text;s timestamptz;
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
if p_confirmation is distinct from 'RESET' then raise exception 'CONFIRM_RESET' using errcode='22023';end if;
perform 1 from public.runtime_settings where singleton and demo_mode for update;
if not found then raise exception 'DEMO_DISABLED' using errcode='22023';end if;
delete from public.booking_events e using public.reservations v where e.reservation_id=v.id and v.is_demo and v.demo_scenario is not null and v.user_id=auth.uid();
delete from public.reservations where is_demo and demo_scenario is not null and user_id=auth.uid();
update public.runtime_settings set demo_now=base where singleton;
foreach scenario in array array['A','B'] loop
select x.id,x.zone_id into b,z from public.bays x join public.zones zz on zz.id=x.zone_id join public.malls m on m.id=zz.mall_id
where m.id='10000000-0000-4000-8000-000000000001' and m.is_demo and m.is_active and zz.is_active and x.is_active and x.bay_type='standard' and zz.name=case when scenario='A' then 'Zone B' else 'Zone A' end order by x.label limit 1 for update of x;
if b is null then raise exception 'DEMO_INVENTORY_MISSING' using errcode='22023';end if;
s:=base+case when scenario='A' then interval '5 minutes' else interval '-5 minutes' end;
insert into public.reservations(user_id,bay_id,destination_id,preference,start_at,end_at,idempotency_key,demo_scenario)
values(auth.uid(),b,'30000000-0000-4000-8000-000000000001',case when scenario='A' then 'step_free' else 'none' end,s,s+interval '2 hours',gen_random_uuid(),scenario) returning * into r;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),'confirmed',base,jsonb_build_object('simulated',true,'scenario',scenario));
end loop;
return public.demo_dashboard();end $$;

create or replace function public.set_bay(p_id uuid,p_active boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
if p_active is null then raise exception 'INVALID_INPUT' using errcode='22023';end if;
perform public.lock_parking_clock();update public.bays set is_active=p_active where id=p_id;
if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
select count(*) into n from public.reservations where bay_id=p_id and end_at>public.parking_now(is_demo) and status in ('confirmed','checked_in');
return jsonb_build_object('is_active',p_active,'affectedReservations',n,'warning',case when not p_active and n>0 then 'Existing reservations remain allocated. Review affected bookings.' else null end);end $$;

revoke execute on function public.lock_parking_clock(),public.parking_now(boolean),public.mall_uses_demo(uuid),public.clock_context(uuid),public.validate_booking_interval(timestamptz,timestamptz,boolean),public.reservation_arrival_defaults(),public.release_one_no_show(uuid),public.release_due_no_shows(),public.booking_details(uuid,uuid),public.demo_metrics(),public.demo_dashboard(),public.advance_demo_clock(integer),public.admin_cleanup(),public.reset_demo(text) from public,anon,authenticated;
grant execute on function public.clock_context(uuid),public.demo_metrics() to anon,authenticated;
grant execute on function public.booking_details(uuid,uuid),public.demo_dashboard(),public.advance_demo_clock(integer),public.admin_cleanup(),public.reset_demo(text) to authenticated;
grant execute on function public.release_due_no_shows() to service_role;
