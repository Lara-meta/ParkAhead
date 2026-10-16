-- Authenticated list refresh, without exposing private rows or release counts.
create function public.refresh_booking_states() returns void language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;perform public.release_due_no_shows();end $$;
revoke execute on function public.refresh_booking_states() from public,anon,authenticated;
grant execute on function public.refresh_booking_states() to authenticated;
create or replace function public.clock_context(p_mall uuid default null) returns jsonb language sql volatile security definer set search_path='' as $$
select jsonb_build_object('demoMode',s.demo_mode,'mallDemo',public.mall_uses_demo(p_mall),
'now',public.parking_now(public.mall_uses_demo(p_mall)),'realNow',clock_timestamp(),'graceMinutes',s.grace_minutes) from public.runtime_settings s where singleton
$$;
