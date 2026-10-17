alter table public.runtime_settings add constraint plate_bounds_order check(plate_max_length>=plate_min_length);
create function public.seed_access_catalog() returns void language plpgsql security definer set search_path='' as $$begin
insert into public.gates(id,mall_id,name,direction) select md5('parkahead:gate:'||m.id||':'||d)::uuid,m.id,case when d='entry' then 'Demo entry gate' else 'Demo exit gate' end,d from public.malls m cross join unnest(array['entry','exit']) d where m.layout_key like 'fictional-layout-%' on conflict(id) do nothing;
update public.bays b set inventory_class='walk_in_only' where b.id in(select x.id from public.bays x join public.zones z on z.id=x.zone_id join public.parking_floors f on f.id=z.floor_id where f.name='B2' and x.bay_type='standard' and right(x.label,2) in('07','08')) and not exists(select 1 from public.reservations r where r.bay_id=b.id and r.status in('confirmed','checked_in'));
end $$;
revoke all on function public.seed_access_catalog() from public,anon,authenticated;
-- Only fictional scenario records receive fictional fixture plates.
update public.reservations set normalized_plate='DEMO'||upper(substr(replace(id::text,'-',''),1,12)) where normalized_plate is null and is_demo and demo_scenario is not null;
create or replace function public.demo_metrics() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('reservationsCreated',count(distinct r.id) filter(where e.event_type='confirmed'),'checkIns',count(distinct r.id) filter(where e.event_type in('checked_in','early_arrival_reconciled')),'completed',count(distinct r.id) filter(where e.event_type='completed'),'noShows',count(distinct r.id) filter(where e.event_type='no_show_released'),'scheduledMinutesReleased',coalesce(sum(greatest(0,extract(epoch from(r.end_at-r.released_at))/60)) filter(where e.event_type='no_show_released'),0))
from public.reservations r join public.booking_events e on e.reservation_id=r.id where r.is_demo
$$;
