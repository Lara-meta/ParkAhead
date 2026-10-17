create function public.my_eligibility(p_mall uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
return jsonb_build_object('mallId',p_mall,'approved',public.oku_approved(p_mall,auth.uid()),'request',(select to_jsonb(e) from public.parking_eligibility e where e.user_id=auth.uid() and e.mall_id=p_mall),'policy',(select to_jsonb(p) from public.parking_policies p where p.mall_id=p_mall),'serverTime',public.parking_now(public.mall_uses_demo(p_mall)));
end $$;
create function public.eligibility_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
return coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('mallName',m.name,'userLabel','Customer '||left(e.user_id::text,8)) order by e.created_at desc) from public.parking_eligibility e join public.malls m on m.id=e.mall_id),'[]');
end $$;
revoke all on function public.my_eligibility(uuid),public.eligibility_dashboard() from public,anon,authenticated;
grant execute on function public.my_eligibility(uuid),public.eligibility_dashboard() to authenticated;
-- The compatibility allocator offers standard bays only; its zone counts agree.
do $$declare d text;begin
select pg_get_functiondef('public.availability(uuid,timestamptz,timestamptz,uuid)'::regprocedure) into d;
d:=replace(d,$q$where x->>'zoneId'=z.id::text$q$,$q$where x->>'zoneId'=z.id::text and x->>'bayType'='standard'$q$);execute d;
end $$;
