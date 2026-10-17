-- Authorized booking projection includes the physical session's original entry.
do $$declare d text;begin
select pg_get_functiondef('public.booking_details(uuid,uuid)'::regprocedure) into d;
d:=replace(d,'''server_now'',public.parking_now(v.is_demo),','''server_now'',public.parking_now(v.is_demo),''parking_session'',(select jsonb_build_object(''id'',s.id,''status'',s.status,''entered_at'',s.entered_at,''exited_at'',s.exited_at,''association_type'',s.association_type,''closure_reason'',s.closure_reason) from public.parking_sessions s where s.reservation_id=v.id order by s.entered_at desc limit 1),');
execute d;
end $$;
create or replace function public.admin_cleanup() returns integer language plpgsql security definer set search_path='' as $$declare c integer;begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
perform public.lock_parking_clock();c:=public.release_due_no_shows();perform public.session_maintenance();return c;end $$;
-- Safe public bounds only, no private runtime settings.
create function public.plate_configuration() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('min',plate_min_length,'max',plate_max_length) from public.runtime_settings where singleton$$;
revoke all on function public.plate_configuration() from public;
grant execute on function public.plate_configuration() to anon,authenticated;
