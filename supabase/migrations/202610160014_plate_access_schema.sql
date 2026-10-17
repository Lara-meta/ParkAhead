-- Plate access is additive: historical deadlines and nullable legacy plates remain.
alter table public.runtime_settings add column plate_min_length integer not null default 2 check(plate_min_length>=1), add column plate_max_length integer not null default 16 check(plate_max_length between 2 and 32),add column session_timeout_hours integer not null default 24 check(session_timeout_hours>=1),add column walk_in_retention_days integer not null default 7 check(walk_in_retention_days>=1);
update public.runtime_settings set grace_minutes=30 where singleton;
alter table public.reservations add column normalized_plate text;
create function public.normalize_plate(p text) returns text language plpgsql stable security definer set search_path='' as $$
declare v text; lo integer;hi integer;
begin select plate_min_length,plate_max_length into lo,hi from public.runtime_settings where singleton;
v:=upper(regexp_replace(coalesce(p,''),'[[:space:]-]','','g'));
if length(v) not between lo and hi or v !~ '^[A-Z0-9]+$' then raise exception 'INVALID_PLATE' using errcode='22023';end if;return v;end $$;
-- Nullable legacy values are deliberately not fabricated.
do $$begin if exists(select 1 from public.reservations a join public.reservations b on a.id<b.id and a.normalized_plate=b.normalized_plate and a.status in('confirmed','checked_in') and b.status in('confirmed','checked_in') and tstzrange(a.start_at,a.end_at,'[)')&&tstzrange(b.start_at,b.end_at,'[)')) then raise exception 'Resolve overlapping active plate reservations before applying plate exclusion; no records were changed.';end if;end $$;
alter table public.reservations add constraint reservation_plate_overlap exclude using gist(normalized_plate with =,tstzrange(start_at,end_at,'[)') with &&) where(normalized_plate is not null and status in('confirmed','checked_in'));
alter table public.bays add column inventory_class text not null default 'bookable' check(inventory_class in('bookable','walk_in_only'));
create table public.gates(id uuid primary key default gen_random_uuid(),mall_id uuid not null references public.malls,name text not null,direction text not null check(direction in('entry','exit')),is_active boolean not null default true,is_demo boolean not null default true,unique(id,mall_id));
create table public.parking_sessions(id uuid primary key default gen_random_uuid(),mall_id uuid not null references public.malls,normalized_plate text,entry_gate_id uuid,exit_gate_id uuid,entered_at timestamptz not null,exited_at timestamptz,status text not null default 'open' check(status in('open','closed','auto_closed')),entry_classification text not null check(entry_classification in('booking','walk_in')),reservation_id uuid references public.reservations,association_type text check(association_type in('direct_booking','early_arrival','manual_fallback')),closure_reason text,created_by uuid references auth.users,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),is_demo boolean not null,check((status='open' and exited_at is null) or(status<>'open' and exited_at is not null)),check(status<>'open' or normalized_plate is not null or reservation_id is not null),foreign key(entry_gate_id,mall_id) references public.gates(id,mall_id),foreign key(exit_gate_id,mall_id) references public.gates(id,mall_id));
create unique index one_open_plate_session on public.parking_sessions(normalized_plate) where status='open' and normalized_plate is not null;
create unique index one_open_booking_session on public.parking_sessions(reservation_id) where status='open' and reservation_id is not null;
create table public.access_events(id uuid primary key default gen_random_uuid(),session_id uuid references public.parking_sessions,reservation_id uuid references public.reservations,gate_id uuid references public.gates,event_type text not null,reason_code text,actor_user_id uuid references auth.users,created_at timestamptz not null,is_demo boolean not null);
-- No plate copies in audit JSON, exceptions or logs.
alter table public.gates enable row level security;alter table public.parking_sessions enable row level security;alter table public.access_events enable row level security;
revoke all on public.gates,public.parking_sessions,public.access_events from anon,authenticated;
grant select on public.gates,public.parking_sessions,public.access_events to authenticated;
create policy gates_admin on public.gates for select to authenticated using(public.is_admin());
create policy sessions_admin on public.parking_sessions for select to authenticated using(public.is_admin());
create policy access_admin on public.access_events for select to authenticated using(public.is_admin());
-- Serialize prototype mutations before clock/plate/session/booking locks. This
-- conservative global lock avoids cross-plate and cleanup lock-order inversion.
create or replace function public.lock_parking_clock() returns void language plpgsql security definer set search_path='' as $$begin perform pg_advisory_xact_lock(734221,1);perform 1 from public.runtime_settings where singleton for share;end $$;
create function public.lock_plate(p text) returns void language plpgsql security definer set search_path='' as $$begin perform public.lock_parking_clock();if p is not null then perform pg_advisory_xact_lock(hashtextextended('plate:'||p,0));end if;end $$;
create or replace function public.validate_booking_interval(s timestamptz,e timestamptz,p_demo boolean) returns void language plpgsql security definer set search_path='' as $$declare n timestamptz:=public.parking_now(p_demo);g integer;begin select grace_minutes into g from public.runtime_settings where singleton;if s is null or e is null or not isfinite(s) or not isfinite(e) or s<=n or s>n+interval '30 days' or e-s<interval '60 minutes' or e-s>interval '8 hours' or e-s<=make_interval(mins=>g) then raise exception 'INVALID_INTERVAL_MINIMUM_ONE_HOUR' using errcode='22023';end if;end $$;
create function public.reservation_plate_guard() returns trigger language plpgsql security definer set search_path='' as $$declare n timestamptz;begin
if TG_OP='INSERT' then
new.normalized_plate:=coalesce(new.normalized_plate,nullif(current_setting('parkahead.booking_plate',true),''));
if new.normalized_plate is null and new.demo_scenario is not null and public.is_admin() then new.normalized_plate:='DEMO'||upper(substr(replace(new.id::text,'-',''),1,12));end if;
new.normalized_plate:=public.normalize_plate(new.normalized_plate);
else
if new.normalized_plate is not distinct from old.normalized_plate then return new;end if;
new.normalized_plate:=public.normalize_plate(new.normalized_plate);
end if;
perform public.lock_plate(new.normalized_plate);n:=public.parking_now(new.is_demo);
if exists(select 1 from public.parking_sessions where normalized_plate=new.normalized_plate and status='open') and new.start_at<=n then raise exception 'PLATE_ALREADY_INSIDE' using errcode='23P01';end if;
return new;end $$;
create trigger zz_reservation_plate_guard before insert or update of normalized_plate on public.reservations for each row execute function public.reservation_plate_guard();
-- Retained allocators remain internal. Public signatures now require a plate.
alter function public.reserve(uuid,uuid,timestamptz,timestamptz,uuid,text,uuid) rename to reserve_internal;
alter function public.reserve_bay(uuid,uuid,timestamptz,timestamptz,uuid,text[],text[],uuid) rename to reserve_bay_internal;
revoke all on function public.reserve_internal(uuid,uuid,timestamptz,timestamptz,uuid,text,uuid),public.reserve_bay_internal(uuid,uuid,timestamptz,timestamptz,uuid,text[],text[],uuid) from public,anon,authenticated;
create function public.reserve(p_mall uuid,p_zone uuid,p_start timestamptz,p_end timestamptz,p_destination uuid,p_preference text,p_key uuid,p_plate text) returns public.reservations language plpgsql security definer set search_path='' as $$declare v text;r public.reservations;begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
perform public.lock_parking_clock();v:=public.normalize_plate(p_plate);perform public.lock_plate(v);
select * into r from public.reservations where user_id=auth.uid() and idempotency_key=p_key;if found and r.normalized_plate is distinct from v then raise exception 'IDEMPOTENCY_PLATE_CONFLICT' using errcode='23505';end if;
perform set_config('parkahead.booking_plate',v,true);r:=public.reserve_internal(p_mall,p_zone,p_start,p_end,p_destination,p_preference,p_key);perform set_config('parkahead.booking_plate','',true);return r;end $$;
create function public.reserve_bay(p_mall uuid,p_bay uuid,p_start timestamptz,p_end timestamptz,p_destination uuid,p_selected text[],p_required text[],p_key uuid,p_plate text) returns public.reservations language plpgsql security definer set search_path='' as $$declare v text;r public.reservations;begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
perform public.lock_parking_clock();v:=public.normalize_plate(p_plate);perform public.lock_plate(v);
select * into r from public.reservations where user_id=auth.uid() and idempotency_key=p_key;if found and r.normalized_plate is distinct from v then raise exception 'IDEMPOTENCY_PLATE_CONFLICT' using errcode='23505';end if;
perform set_config('parkahead.booking_plate',v,true);r:=public.reserve_bay_internal(p_mall,p_bay,p_start,p_end,p_destination,p_selected,p_required,p_key);perform set_config('parkahead.booking_plate','',true);return r;end $$;
create function public.update_booking_plate(p_id uuid,p_plate text) returns public.reservations language plpgsql security definer set search_path='' as $$declare r public.reservations;v text;n timestamptz;begin
perform public.lock_parking_clock();v:=public.normalize_plate(p_plate);perform public.lock_plate(v);
select * into r from public.reservations where id=p_id and user_id=auth.uid() for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
perform public.lock_plate(r.normalized_plate);n:=public.parking_now(r.is_demo);
if r.status<>'confirmed' or n>=r.arrival_deadline then raise exception 'PLATE_EDIT_CLOSED' using errcode='23P01';end if;
update public.reservations set normalized_plate=v,updated_at=n where id=r.id returning * into r;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at) values(r.id,auth.uid(),'plate_updated',n);return r;end $$;
-- Apply inventory exclusion in existing trusted SQL without rewriting migrations.
do $$declare d text;begin
select pg_get_functiondef('public.reservation_inventory_guard()'::regprocedure) into d;d:=replace(d,$q$b.bay_type='standard'$q$,$q$b.bay_type='standard' and b.inventory_class='bookable'$q$);execute d;
select pg_get_functiondef('public.reserve_internal(uuid,uuid,timestamptz,timestamptz,uuid,text,uuid)'::regprocedure) into d;d:=replace(d,$q$bay_type='standard' order by$q$,$q$bay_type='standard' and inventory_class='bookable' order by$q$);execute d;
select pg_get_functiondef('public.bay_availability(uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure) into d;d:=replace(d,$q$or b.bay_type<>'standard' then 'unavailable'$q$,$q$or b.bay_type<>'standard' or b.inventory_class='walk_in_only' then 'unavailable'$q$);d:=replace(d,$q$when b.bay_type<>'standard' then 'restricted_type'$q$,$q$when b.inventory_class='walk_in_only' then 'walk_in_only' when b.bay_type<>'standard' then 'restricted_type'$q$);execute d;
select pg_get_functiondef('public.floor_map(uuid,uuid)'::regprocedure) into d;d:=replace(d,$q$'bayType',b.bay_type,$q$,$q$'inventoryClass',b.inventory_class,'bayType',b.bay_type,$q$);execute d;
end $$;

