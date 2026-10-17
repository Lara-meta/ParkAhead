update public.bays set bay_type='oku' where bay_type='accessible';
-- Explicit fictional OKU placements; never reclassify an active booked bay.
update public.bays b set bay_type='oku',inventory_class='bookable' from public.zones z join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id
where b.zone_id=z.id and m.layout_key like 'fictional-layout-%' and ((f.name='B1' and z.code='B' and b.code='03') or(f.name='B2' and z.code='A' and b.code='03'))
and not exists(select 1 from public.reservations r where r.bay_id=b.id and r.status in('confirmed','checked_in'));
create table public.parking_policies(mall_id uuid primary key references public.malls,oku_enabled boolean not null default true,review_notice text not null default 'Demo eligibility review. This does not implement a real-world verification process.');
insert into public.parking_policies(mall_id) select id from public.malls;
create table public.parking_eligibility(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,mall_id uuid not null references public.malls,eligibility_type text not null default 'oku' check(eligibility_type='oku'),status text not null default 'not_declared' check(status in('not_declared','pending','approved','rejected')),reviewed_by uuid references auth.users,reviewed_at timestamptz,expires_at timestamptz,created_at timestamptz not null,updated_at timestamptz not null,unique(user_id,mall_id,eligibility_type));
create table public.eligibility_events(id uuid primary key default gen_random_uuid(),eligibility_id uuid not null references public.parking_eligibility,actor_user_id uuid references auth.users,event_type text not null,status text not null,created_at timestamptz not null);
alter table public.parking_policies enable row level security;alter table public.parking_eligibility enable row level security;alter table public.eligibility_events enable row level security;
revoke all on public.parking_policies,public.parking_eligibility,public.eligibility_events from anon,authenticated;
grant select on public.parking_policies to anon,authenticated;grant select on public.parking_eligibility,public.eligibility_events to authenticated;
create policy public_parking_policy on public.parking_policies for select using(true);
create policy private_eligibility on public.parking_eligibility for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy private_eligibility_events on public.eligibility_events for select to authenticated using(public.is_admin() or exists(select 1 from public.parking_eligibility e where e.id=eligibility_id and e.user_id=auth.uid()));
create function public.oku_approved(p_mall uuid,p_user uuid) returns boolean language sql volatile security definer set search_path='' as $$
select exists(select 1 from public.parking_eligibility e join public.parking_policies p on p.mall_id=e.mall_id where e.mall_id=p_mall and e.user_id=p_user and e.status='approved' and p.oku_enabled and (e.expires_at is null or e.expires_at>public.parking_now(public.mall_uses_demo(p_mall))))$$;
create function public.request_eligibility(p_mall uuid) returns public.parking_eligibility language plpgsql security definer set search_path='' as $$declare r public.parking_eligibility;n timestamptz;begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;perform public.lock_parking_clock();
if not exists(select 1 from public.malls m join public.parking_policies p on p.mall_id=m.id where m.id=p_mall and m.is_active and p.oku_enabled) then raise exception 'POLICY_UNAVAILABLE' using errcode='P0002';end if;
n:=public.parking_now(public.mall_uses_demo(p_mall));
select * into r from public.parking_eligibility where user_id=auth.uid() and mall_id=p_mall for update;
if found and(r.status='pending' or public.oku_approved(p_mall,auth.uid())) then return r;end if;
insert into public.parking_eligibility(user_id,mall_id,status,created_at,updated_at) values(auth.uid(),p_mall,'pending',n,n)
on conflict(user_id,mall_id,eligibility_type) do update set status='pending',reviewed_by=null,reviewed_at=null,expires_at=null,updated_at=n returning * into r;
insert into public.eligibility_events(eligibility_id,actor_user_id,event_type,status,created_at) values(r.id,auth.uid(),'requested','pending',n);return r;end $$;
create function public.review_eligibility(p_id uuid,p_status text,p_expires timestamptz default null) returns public.parking_eligibility language plpgsql security definer set search_path='' as $$declare r public.parking_eligibility;n timestamptz;begin
if not public.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;perform public.lock_parking_clock();
if p_status not in('approved','rejected') then raise exception 'INVALID_STATUS' using errcode='22023';end if;
select * into r from public.parking_eligibility where id=p_id for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;n:=public.parking_now(public.mall_uses_demo(r.mall_id));
if p_expires is not null and(not isfinite(p_expires) or p_expires<=n) then raise exception 'INVALID_EXPIRY' using errcode='22023';end if;
if r.status=p_status and r.expires_at is not distinct from p_expires then return r;end if;
update public.parking_eligibility set status=p_status,expires_at=p_expires,reviewed_by=auth.uid(),reviewed_at=n,updated_at=n where id=r.id returning * into r;
insert into public.eligibility_events(eligibility_id,actor_user_id,event_type,status,created_at) values(r.id,auth.uid(),'reviewed',p_status,n);return r;end $$;
alter table public.reservations add column eligibility_snapshot jsonb;
create or replace function public.reservation_inventory_guard() returns trigger language plpgsql security definer set search_path='' as $$declare b public.bays;e public.parking_eligibility;begin
select bb.* into b from public.bays bb join public.zones z on z.id=bb.zone_id join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id where bb.id=new.bay_id and bb.is_active and z.is_active and f.is_active and m.is_active and bb.inventory_class='bookable';
if not found or b.bay_type not in('standard','oku') then raise exception 'INVENTORY_UNAVAILABLE' using errcode='23P01';end if;
if b.bay_type='oku' then
if not public.oku_approved(b.mall_id,new.user_id) then raise exception 'OKU_ELIGIBILITY_REQUIRED' using errcode='P0004';end if;
select * into e from public.parking_eligibility where mall_id=b.mall_id and user_id=new.user_id;
new.eligibility_snapshot:=jsonb_build_object('eligibilityId',e.id,'mallId',e.mall_id,'status',e.status,'reviewedAt',e.reviewed_at,'expiresAt',e.expires_at,'checkedAt',public.parking_now(public.mall_uses_demo(b.mall_id)),'policy','simulated-mall-review-v1');
else new.eligibility_snapshot:=jsonb_build_object('bayType','standard','eligibilityRequired',false);end if;
return new;end $$;
-- Keep automatic assignment explicitly standard. Exact selection may use OKU.
do $$declare d text;begin
select pg_get_functiondef('public.reserve_bay_internal(uuid,uuid,timestamptz,timestamptz,uuid,text[],text[],uuid)'::regprocedure) into d;
d:=replace(d,$q$if not b.is_active or b.bay_type<>'standard' then$q$,$q$if b.bay_type='oku' and not public.oku_approved(p_mall,auth.uid()) then raise exception 'OKU_ELIGIBILITY_REQUIRED' using errcode='P0004';end if; if not b.is_active or b.bay_type not in('standard','oku') then$q$);execute d;
select pg_get_functiondef('public.bay_availability(uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure) into d;
d:=replace(d,$q$b.bay_type<>'standard'$q$,$q$b.bay_type not in('standard','oku')$q$);
d:=replace(d,$q$'id',b.id,'label',b.label,$q$,$q$'id',b.id,'bayId',b.id,'mallId',m.id,'bayLabel',b.label,'bayType',b.bay_type,'label',b.label,$q$);execute d;
end $$;
create or replace function public.recommend_bays(p_mall uuid,p_start timestamptz,p_end timestamptz,p_destination uuid default null,p_selected text[] default '{}',p_required text[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare data jsonb;v jsonb;e jsonb;items jsonb:='[]';sorted jsonb;permitted boolean;begin
perform public.validate_preferences(p_destination,p_selected,p_required);data:=public.bay_availability(p_mall,p_start,p_end,null,p_destination);
for v in select * from jsonb_array_elements(data->'bays') loop
e:=public.evaluate_bay((v->>'id')::uuid,p_destination,public.canonical_preferences(p_selected),public.canonical_preferences(p_required));
permitted:=(v->>'bayType'<>'oku' or public.oku_approved(p_mall,auth.uid()));
items:=items||jsonb_build_array(v||jsonb_build_object('eligibilityOutcome',case when v->>'bayType'<>'oku' then 'not_required' when permitted then 'approved' else 'approval_required' end,'evaluation',e,'eligible',permitted and v->>'status'='available' and(e->>'requirementsMet')::boolean));end loop;
select coalesce(jsonb_agg(item order by (item->>'eligible')::boolean desc,(item->'evaluation'->>'score')::numeric desc,item->>'label'),'[]') into sorted from jsonb_array_elements(items) item;
return data||jsonb_build_object('bays',sorted,'algorithmVersion','demo-prefs-v1');end $$;
-- Personalised recommendations must never share a public/CDN cache.
revoke all on function public.oku_approved(uuid,uuid),public.request_eligibility(uuid),public.review_eligibility(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.request_eligibility(uuid),public.review_eligibility(uuid,text,timestamptz) to authenticated;
