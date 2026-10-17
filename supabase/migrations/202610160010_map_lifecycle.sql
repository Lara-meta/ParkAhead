-- Apply active-floor eligibility even to retained automatic assignment.
create function public.reservation_inventory_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
if not exists(select 1 from public.bays b join public.zones z on z.id=b.zone_id join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id where b.id=new.bay_id and b.is_active and b.bay_type='standard' and z.is_active and f.is_active and m.is_active) then raise exception 'INVENTORY_UNAVAILABLE' using errcode='23P01';end if;return new;end $$;
create trigger reservation_inventory_guard before insert on public.reservations for each row execute function public.reservation_inventory_guard();
revoke execute on function public.reservation_inventory_guard() from public,anon,authenticated;
alter table public.preference_definitions add constraint valid_threshold check(threshold is null or threshold>=0),add constraint valid_normalization check(normalization_max is null or normalization_max>0);
create or replace function public.availability(p_mall uuid,p_start timestamptz,p_end timestamptz,p_destination uuid default null)
returns table("zoneId" uuid,"zoneName" text,floor text,"availableBayCount" bigint,"walkingDistanceM" integer,"stepFree" boolean,verified boolean) language plpgsql security definer set search_path='' as $$
declare data jsonb;
begin
data:=public.bay_availability(p_mall,p_start,p_end,null,p_destination);
return query select z.id,z.name,f.name,count(v) filter(where v->>'status'='available'),r.walking_distance_m,r.is_step_free,coalesce(r.is_verified,false)
from public.zones z join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id
left join lateral(select x as v from jsonb_array_elements(data->'bays') x where x->>'zoneId'=z.id::text) q on true
left join public.zone_destination_routes r on r.zone_id=z.id and r.destination_id=p_destination
where m.id=p_mall and m.is_active and f.is_active and z.is_active group by z.id,f.name,r.walking_distance_m,r.is_step_free,r.is_verified order by z.name;end $$;

-- Reset relative to the current authoritative demo day, not a calendar date.
-- Only this admin's fictional scenario rows/events are replaced, across all seeded malls.
create or replace function public.reset_demo(p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare base timestamptz;b uuid;r public.reservations;scenario text;s timestamptz;m record;destination uuid;
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
if p_confirmation is distinct from 'RESET' then raise exception 'CONFIRM_RESET' using errcode='22023';end if;
perform 1 from public.runtime_settings where singleton and demo_mode for update;
if not found then raise exception 'DEMO_DISABLED' using errcode='22023';end if;
select (date_trunc('day',demo_now at time zone 'Asia/Kuala_Lumpur')+interval '10 hours') at time zone 'Asia/Kuala_Lumpur' into base from public.runtime_settings where singleton;
delete from public.booking_events e using public.reservations v where e.reservation_id=v.id and v.is_demo and v.demo_scenario is not null and v.user_id=auth.uid();
delete from public.reservations where is_demo and demo_scenario is not null and user_id=auth.uid();
update public.runtime_settings set demo_now=base where singleton;
for m in select id from public.malls where is_demo and is_active and layout_key like 'fictional-layout-%' order by id loop
select id into destination from public.destinations where mall_id=m.id and name='Cinema';
foreach scenario in array array['A','B'] loop
select x.id into b from public.bays x join public.zones z on z.id=x.zone_id join public.parking_floors f on f.id=z.floor_id
where x.mall_id=m.id and f.name='B1' and f.is_active and z.is_active and x.is_active and x.bay_type='standard' and z.name=case when scenario='A' then 'Zone B' else 'Zone A' end order by x.label limit 1 for update of x;
if b is null or destination is null then raise exception 'DEMO_INVENTORY_MISSING' using errcode='22023';end if;
s:=base+case when scenario='A' then interval '5 minutes' else interval '-5 minutes' end;
insert into public.reservations(user_id,bay_id,destination_id,preference,start_at,end_at,idempotency_key,demo_scenario) values(auth.uid(),b,destination,case when scenario='A' then 'step_free' else 'none' end,s,s+interval '2 hours',gen_random_uuid(),scenario) returning * into r;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),'confirmed',base,jsonb_build_object('simulated',true,'scenario',scenario));
end loop;end loop;return public.demo_dashboard();end $$;
create or replace function public.demo_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
perform public.release_due_no_shows();
return jsonb_build_object('clock',public.clock_context('10000000-0000-4000-8000-000000000001'),'metrics',public.demo_metrics(),'lastCleanup',(select to_jsonb(c) from public.cleanup_runs c order by executed_at desc limit 1),
'bookings',coalesce((select jsonb_agg(public.booking_details(r.id) order by r.demo_scenario,b.mall_id,r.start_at) from public.reservations r join public.bays b on b.id=r.bay_id where r.demo_scenario is not null and r.user_id=auth.uid()),'[]'::jsonb));end $$;
