-- Repeatable rebooking fixtures and an admin-editable, explicitly illustrative quote.
alter table public.reservations add column demo_rebooking_of uuid references public.reservations on delete set null;
create table public.demo_story(singleton boolean primary key default true check(singleton),quote text not null check(length(quote) between 20 and 600));
insert into public.demo_story(singleton,quote) values(true,'I want to know where I am parking before I arrive, especially when I am heading to a specific place.');
alter table public.demo_story enable row level security;
revoke all on public.demo_story from anon,authenticated;
grant select on public.demo_story to anon,authenticated;
create policy public_story on public.demo_story for select using(true);
create function public.update_demo_quote(p_quote text) returns void language plpgsql security definer set search_path='' as $$
begin if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
if p_quote is null or length(trim(p_quote)) not between 20 and 600 then raise exception 'INVALID_QUOTE' using errcode='22023';end if;
update public.demo_story set quote=trim(p_quote) where singleton;end $$;
create function public.rebook_demo(p_id uuid) returns public.reservations language plpgsql security definer set search_path='' as $$
declare old public.reservations;fresh public.reservations;m uuid;z uuid;n timestamptz;
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
perform public.lock_parking_clock();
if not (select demo_mode from public.runtime_settings where singleton) then raise exception 'DEMO_DISABLED' using errcode='22023';end if;
select * into old from public.reservations where id=p_id and user_id=auth.uid() and is_demo and demo_scenario='B' and demo_rebooking_of is null for update;
if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
if old.status<>'no_show' then raise exception 'INVALID_TRANSITION' using errcode='23P01';end if;
select zz.mall_id,zz.id into m,z from public.bays b join public.zones zz on zz.id=b.zone_id where b.id=old.bay_id;
-- Locking the source makes retries return the same explicitly stored subsequent booking.
select * into fresh from public.reservations where demo_rebooking_of=old.id and user_id=auth.uid();
if found then return fresh;end if;
n:=public.parking_now(true);
fresh:=public.reserve(m,z,n+interval '1 minute',old.end_at,old.destination_id,'none',old.id);
update public.reservations set demo_scenario='B',demo_rebooking_of=old.id where id=fresh.id returning * into fresh;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(fresh.id,auth.uid(),'demo_rebooked',n,jsonb_build_object('source_reservation',old.id));
return fresh;end $$;
revoke execute on function public.update_demo_quote(text),public.rebook_demo(uuid) from public,anon,authenticated;
grant execute on function public.update_demo_quote(text),public.rebook_demo(uuid) to authenticated;
