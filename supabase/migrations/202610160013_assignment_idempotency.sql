-- Retain the existing automatic allocator while preventing idempotency keys from
-- silently crossing between automatic and exact-bay request semantics.
create or replace function public.reserve(p_mall uuid,p_zone uuid,p_start timestamptz,p_end timestamptz,p_destination uuid,p_preference text,p_key uuid) returns public.reservations language plpgsql security definer set search_path='' as $$
declare result public.reservations;b public.bays;d boolean;
begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
if p_key is null then raise exception 'INVALID_KEY' using errcode='22023';end if;
perform public.lock_parking_clock();perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
select * into result from public.reservations where user_id=auth.uid() and idempotency_key=p_key;
if found then
if result.booking_mode<>'automatic' or result.start_at is distinct from p_start or result.end_at is distinct from p_end or result.destination_id is distinct from p_destination or result.preference is distinct from p_preference or not exists(select 1 from public.bays x join public.zones z on z.id=x.zone_id where x.id=result.bay_id and z.id=p_zone and z.mall_id=p_mall) then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
perform public.release_one_no_show(result.id);select * into result from public.reservations where id=result.id;return result;end if;
d:=public.mall_uses_demo(p_mall);perform public.validate_booking_interval(p_start,p_end,d);
if p_preference is null or p_preference not in ('none','shorter_walk','step_free') or(p_preference<>'none' and p_destination is null) then raise exception 'INVALID_PREFERENCE' using errcode='22023';end if;
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
end loop;raise exception 'NO_AVAILABILITY' using errcode='23P01';end $$;
