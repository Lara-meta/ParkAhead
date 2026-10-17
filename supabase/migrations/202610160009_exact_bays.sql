create function public.canonical_preferences(keys text[]) returns text[] language sql immutable set search_path='' as $$select coalesce(array_agg(distinct k order by k),'{}') from unnest(coalesce(keys,'{}')) k$$;
create function public.validate_preferences(p_destination uuid,p_selected text[],p_required text[]) returns void language plpgsql security definer set search_path='' as $$
begin
if array_position(p_selected,null) is not null or array_position(p_required,null) is not null or not(coalesce(p_required,'{}')<@coalesce(p_selected,'{}')) or exists(select 1 from unnest(coalesce(p_selected,'{}')) k where not exists(select 1 from public.preference_definitions d where d.id=k)) or exists(select 1 from public.preference_definitions d where d.id=any(coalesce(p_required,'{}')) and not d.supports_required) or(p_destination is null and exists(select 1 from public.preference_definitions d where d.id=any(coalesce(p_selected,'{}')) and d.requires_destination)) then raise exception 'INVALID_PREFERENCES' using errcode='22023';end if;end $$;
create function public.evaluate_bay(p_bay uuid,p_destination uuid,p_selected text[],p_required text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.bays;r public.zone_destination_routes;d public.preference_definitions;val numeric;known boolean;matched boolean;points numeric;score numeric:=0;soft_count integer:=0;matches text[]:='{}';unmet text[]:='{}';unknowns text[]:='{}';config jsonb:='{}';values_json jsonb;
begin
perform public.validate_preferences(p_destination,p_selected,p_required);
select * into b from public.bays where id=p_bay;
if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
select * into r from public.zone_destination_routes where zone_id=b.zone_id and destination_id=p_destination;
values_json:=jsonb_build_object('widthMm',b.width_mm,'liftDistanceM',b.lift_distance_m,'walkwayDistanceM',b.walkway_distance_m,'exitDrivingDistanceM',b.exit_driving_distance_m,'walkingDistanceM',case when r.is_verified then r.walking_distance_m else null end,'stepFree',case when r.is_verified then r.is_step_free else null end,'routeVerified',coalesce(r.is_verified,false));
for d in select * from public.preference_definitions where id=any(coalesce(p_selected,'{}')) order by id loop
val:=null;known:=true;matched:=false;points:=0;
case d.id
when 'shorter_walk' then if r.is_verified then val:=r.walking_distance_m;end if;
when 'step_free' then known:=coalesce(r.is_verified,false) and r.is_step_free is not null;matched:=known and r.is_step_free;points:=case when matched then 1 else 0 end;
when 'near_lift' then val:=b.lift_distance_m;
when 'near_exit' then val:=b.exit_driving_distance_m;
when 'near_walkway' then val:=b.walkway_distance_m;
when 'wider_bay' then val:=b.width_mm;
end case;
if d.id<>'step_free' then known:=val is not null;
matched:=known and case when d.id='wider_bay' then val>=d.threshold else val<=d.threshold end;
points:=case when not known then 0 when d.id='wider_bay' then case when matched then 1 else 0 end else greatest(0,least(1,1-val/d.normalization_max)) end;end if;
if not known then unknowns:=array_append(unknowns,d.id);elsif matched then matches:=array_append(matches,d.id);else unmet:=array_append(unmet,d.id);end if;
if not(d.id=any(coalesce(p_required,'{}'))) then score:=score+points;soft_count:=soft_count+1;end if;
config:=config||jsonb_build_object(d.id,jsonb_build_object('threshold',d.threshold,'normalizationMax',d.normalization_max,'weight',1));
end loop;
return jsonb_build_object('algorithmVersion','demo-prefs-v1','selected',public.canonical_preferences(p_selected),'required',public.canonical_preferences(p_required),'matched',matches,'unmet',unmet,'unknown',unknowns,'requirementsMet',coalesce(p_required,'{}')<@matches,'score',case when soft_count=0 then 0 else round(score/soft_count,4) end,'knownCount',cardinality(coalesce(p_selected,'{}'))-cardinality(unknowns),'totalCount',cardinality(coalesce(p_selected,'{}')),'values',values_json,'configuration',config);
end $$;
create function public.snapshot_booking_preferences() returns trigger language plpgsql security definer set search_path='' as $$
declare location jsonb;
begin
if cardinality(new.selected_preferences)=0 and new.preference<>'none' then new.selected_preferences:=array[new.preference];if new.preference='step_free' then new.required_preferences:=array['step_free'];end if;end if;
new.selected_preferences:=public.canonical_preferences(new.selected_preferences);new.required_preferences:=public.canonical_preferences(new.required_preferences);
new.recommendation_snapshot:=public.evaluate_bay(new.bay_id,new.destination_id,new.selected_preferences,new.required_preferences);
if not(new.recommendation_snapshot->>'requirementsMet')::boolean then raise exception 'REQUIRED_PREFERENCES_UNMET' using errcode='P0003';end if;
select jsonb_build_object('mallId',m.id,'mallName',m.name,'timezone',m.timezone,'floorId',f.id,'floor',f.name,'zoneName',z.name,'bayLabel',b.label) into location from public.bays b join public.zones z on z.id=b.zone_id join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id where b.id=new.bay_id;
new.recommendation_snapshot:=new.recommendation_snapshot||jsonb_build_object('location',location);return new;end $$;
create trigger snapshot_booking_preferences before insert on public.reservations for each row execute function public.snapshot_booking_preferences();

create function public.floor_map(p_mall uuid,p_floor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
if not exists(select 1 from public.parking_floors where id=p_floor and mall_id=p_mall) then raise exception 'CROSS_MALL_FLOOR' using errcode='22023';end if;
select jsonb_build_object('floor',to_jsonb(f),'mall',jsonb_build_object('id',m.id,'name',m.name,'timezone',m.timezone,'description',m.description),'zones',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'is_active',z.is_active) order by z.name) from public.zones z where z.floor_id=f.id),'[]'),
'bays',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'zoneId',z.id,'zoneName',z.name,'floorId',f.id,'floorName',f.name,'isActive',b.is_active and z.is_active and f.is_active and m.is_active,'bayType',b.bay_type,'x',b.map_x,'y',b.map_y,'width',b.map_width,'height',b.map_height,'rotation',b.rotation,'widthMm',b.width_mm,'liftDistanceM',b.lift_distance_m,'walkwayDistanceM',b.walkway_distance_m,'exitDrivingDistanceM',b.exit_driving_distance_m) order by b.label) from public.bays b join public.zones z on z.id=b.zone_id where z.floor_id=f.id),'[]'),
'features',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'type',v.type,'label',v.label,'geometry',v.geometry) order by v.type,v.label) from public.parking_map_features v where v.floor_id=f.id),'[]')) into result from public.parking_floors f join public.malls m on m.id=f.mall_id where f.id=p_floor;
return result;end $$;
create function public.bay_availability(p_mall uuid,p_start timestamptz,p_end timestamptz,p_floor uuid default null,p_destination uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
perform public.lock_parking_clock();
if not exists(select 1 from public.malls where id=p_mall) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
if p_floor is not null and not exists(select 1 from public.parking_floors where id=p_floor and mall_id=p_mall) then raise exception 'CROSS_MALL_FLOOR' using errcode='22023';end if;
if p_destination is not null and not exists(select 1 from public.destinations where id=p_destination and mall_id=p_mall) then raise exception 'CROSS_MALL_DESTINATION' using errcode='22023';end if;
perform public.validate_booking_interval(p_start,p_end,public.mall_uses_demo(p_mall));perform public.release_due_no_shows();
select jsonb_build_object('serverNow',public.parking_now(public.mall_uses_demo(p_mall)),'startAt',p_start,'endAt',p_end,'mallId',p_mall,'bays',coalesce(jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'zoneId',z.id,'zoneName',z.name,'floorId',f.id,'floorName',f.name,
'status',case when not(m.is_active and f.is_active and z.is_active and b.is_active) or b.bay_type<>'standard' then 'unavailable' when exists(select 1 from public.reservations v where v.bay_id=b.id and v.status in ('confirmed','checked_in') and v.start_at<p_end and v.end_at>p_start) then 'reserved' else 'available' end,
'reason',case when not m.is_active then 'inactive_mall' when not f.is_active then 'inactive_floor' when not z.is_active then 'inactive_zone' when not b.is_active then 'inactive_bay' when b.bay_type<>'standard' then 'restricted_type' when exists(select 1 from public.reservations v where v.bay_id=b.id and v.status in ('confirmed','checked_in') and v.start_at<p_end and v.end_at>p_start) then 'reservation_conflict' else 'available' end) order by b.label),'[]')) into result
from public.bays b join public.zones z on z.id=b.zone_id join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id where m.id=p_mall and(p_floor is null or f.id=p_floor);
return coalesce(result,jsonb_build_object('serverNow',public.parking_now(public.mall_uses_demo(p_mall)),'mallId',p_mall,'bays','[]'::jsonb));end $$;
create function public.recommend_bays(p_mall uuid,p_start timestamptz,p_end timestamptz,p_destination uuid default null,p_selected text[] default '{}',p_required text[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare data jsonb;v jsonb;e jsonb;items jsonb:='[]';sorted jsonb;
begin
perform public.validate_preferences(p_destination,p_selected,p_required);
data:=public.bay_availability(p_mall,p_start,p_end,null,p_destination);
for v in select * from jsonb_array_elements(data->'bays') loop
e:=public.evaluate_bay((v->>'id')::uuid,p_destination,public.canonical_preferences(p_selected),public.canonical_preferences(p_required));
items:=items||jsonb_build_array(v||jsonb_build_object('evaluation',e,'eligible',v->>'status'='available' and(e->>'requirementsMet')::boolean));end loop;
select coalesce(jsonb_agg(v order by (v->>'eligible')::boolean desc,(v->'evaluation'->>'score')::numeric desc,v->>'label'),'[]') into sorted from jsonb_array_elements(items) v;
return data||jsonb_build_object('bays',sorted,'algorithmVersion','demo-prefs-v1');end $$;

create function public.reserve_bay(p_mall uuid,p_bay uuid,p_start timestamptz,p_end timestamptz,p_destination uuid,p_selected text[],p_required text[],p_key uuid) returns public.reservations language plpgsql security definer set search_path='' as $$
declare r public.reservations;b public.bays;z public.zones;f public.parking_floors;e jsonb;selected text[]:=public.canonical_preferences(p_selected);required text[]:=public.canonical_preferences(p_required);
begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
if p_key is null then raise exception 'INVALID_KEY' using errcode='22023';end if;
perform public.lock_parking_clock();perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
select * into r from public.reservations where user_id=auth.uid() and idempotency_key=p_key;
if found then
if r.booking_mode<>'exact' or r.bay_id is distinct from p_bay or r.start_at is distinct from p_start or r.end_at is distinct from p_end or r.destination_id is distinct from p_destination or r.selected_preferences<>selected or r.required_preferences<>required or not exists(select 1 from public.bays where id=r.bay_id and mall_id=p_mall) then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
perform public.release_one_no_show(r.id);select * into r from public.reservations where id=r.id;return r;end if;
perform public.validate_preferences(p_destination,p_selected,p_required);
perform public.validate_booking_interval(p_start,p_end,public.mall_uses_demo(p_mall));
if p_destination is not null and not exists(select 1 from public.destinations where id=p_destination and mall_id=p_mall) then raise exception 'CROSS_MALL_DESTINATION' using errcode='22023';end if;
perform public.release_due_no_shows();
select zz.* into z from public.zones zz join public.bays bb on bb.zone_id=zz.id join public.malls m on m.id=zz.mall_id join public.parking_floors ff on ff.id=zz.floor_id where bb.id=p_bay and m.id=p_mall and m.is_active and zz.is_active and ff.is_active for share of zz,m,ff;
if not found then raise exception 'BAY_NOT_IN_ACTIVE_MALL' using errcode='P0002';end if;
select * into b from public.bays where id=p_bay for update;
if not b.is_active or b.bay_type<>'standard' then raise exception 'SELECTED_BAY_UNAVAILABLE' using errcode='23P01';end if;
perform 1 from public.zone_destination_routes where zone_id=z.id and destination_id=p_destination for share;
perform 1 from public.preference_definitions where id=any(selected) for share;
e:=public.evaluate_bay(b.id,p_destination,selected,required);
if not(e->>'requirementsMet')::boolean then raise exception 'REQUIRED_PREFERENCES_CHANGED' using errcode='P0003';end if;
begin
insert into public.reservations(user_id,bay_id,destination_id,preference,selected_preferences,required_preferences,booking_mode,start_at,end_at,idempotency_key) values(auth.uid(),b.id,p_destination,'none',selected,required,'exact',p_start,p_end,p_key) returning * into r;
exception when exclusion_violation then raise exception 'SELECTED_BAY_CONFLICT' using errcode='23P01';end;
insert into public.booking_events(reservation_id,actor_user_id,event_type,created_at,details) values(r.id,auth.uid(),'confirmed',public.parking_now(r.is_demo),jsonb_build_object('booking_mode','exact','algorithm_version','demo-prefs-v1','simulated',r.is_demo));return r;end $$;

-- Add current floor identity for the shared booking/map renderer; historical
-- preference explanations remain the immutable reservation snapshot.
create or replace function public.booking_details(p_id uuid default null,p_token uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations;result jsonb;
begin
if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
perform public.lock_parking_clock();
select * into r from public.reservations where(id=p_id or check_in_token=p_token) and(user_id=auth.uid() or public.is_admin()) for update;
if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
perform public.release_one_no_show(r.id);
select to_jsonb(v)||jsonb_build_object('server_now',public.parking_now(v.is_demo),
'bays',jsonb_build_object('label',b.label,'zones',jsonb_build_object('id',z.id,'name',z.name,'floor',f.name,'floor_id',f.id,'malls',jsonb_build_object('id',m.id,'name',m.name,'timezone',m.timezone))),
'destinations',case when d.id is not null then jsonb_build_object('name',d.name) else null end,
'guidance',case when g.zone_id is not null then to_jsonb(g) else null end,
'route',case when rt.id is not null then jsonb_build_object('is_verified',rt.is_verified,'is_step_free',rt.is_step_free,'walking_distance_m',rt.walking_distance_m,'route_description',rt.route_description) else null end)
into result from public.reservations v join public.bays b on b.id=v.bay_id join public.zones z on z.id=b.zone_id join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id
left join public.destinations d on d.id=v.destination_id left join public.zone_guidance g on g.zone_id=z.id left join public.zone_destination_routes rt on rt.zone_id=z.id and rt.destination_id=v.destination_id where v.id=r.id;return result;end $$;
revoke execute on function public.canonical_preferences(text[]),public.validate_preferences(uuid,text[],text[]),public.evaluate_bay(uuid,uuid,text[],text[]),public.snapshot_booking_preferences(),public.floor_map(uuid,uuid),public.bay_availability(uuid,timestamptz,timestamptz,uuid,uuid),public.recommend_bays(uuid,timestamptz,timestamptz,uuid,text[],text[]),public.reserve_bay(uuid,uuid,timestamptz,timestamptz,uuid,text[],text[],uuid) from public,anon,authenticated;
grant execute on function public.floor_map(uuid,uuid),public.bay_availability(uuid,timestamptz,timestamptz,uuid,uuid),public.recommend_bays(uuid,timestamptz,timestamptz,uuid,text[],text[]) to anon,authenticated;
grant execute on function public.reserve_bay(uuid,uuid,timestamptz,timestamptz,uuid,text[],text[],uuid) to authenticated;
