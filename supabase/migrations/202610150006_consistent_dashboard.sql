-- Refresh due rows before computing dashboard aggregates, so one response describes
-- the same persisted lifecycle state in metrics and scenario cards.
create or replace function public.demo_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
perform public.release_due_no_shows();
return jsonb_build_object('clock',public.clock_context('10000000-0000-4000-8000-000000000001'),
'metrics',public.demo_metrics(),'lastCleanup',(select to_jsonb(c) from public.cleanup_runs c order by executed_at desc limit 1),
'bookings',coalesce((select jsonb_agg(public.booking_details(r.id) order by r.demo_scenario,r.start_at) from public.reservations r where r.demo_scenario is not null and r.user_id=auth.uid()),'[]'::jsonb));
end $$;
