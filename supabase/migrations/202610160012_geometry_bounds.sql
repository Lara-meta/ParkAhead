-- Inventory geometry stays inside its own floor, including rotated bay bounds.
create or replace function public.validate_bay_geometry() returns trigger language plpgsql security definer set search_path='' as $$
declare m uuid;w numeric;h numeric;ex double precision;ey double precision;cx double precision;cy double precision;a double precision;
begin
select z.mall_id,f.map_width,f.map_height into m,w,h from public.zones z join public.parking_floors f on f.id=z.floor_id where z.id=new.zone_id;
if new.mall_id is not null and new.mall_id<>m then raise exception 'CROSS_MALL_BAY' using errcode='22023';end if;new.mall_id:=m;
a:=radians(new.rotation::double precision);ex:=(abs(cos(a)*new.map_width)+abs(sin(a)*new.map_height))/2;ey:=(abs(sin(a)*new.map_width)+abs(cos(a)*new.map_height))/2;cx:=new.map_x+new.map_width/2;cy:=new.map_y+new.map_height/2;
if cx-ex<0 or cy-ey<0 or cx+ex>w or cy+ey>h then raise exception 'BAY_OUTSIDE_FLOOR' using errcode='22023';end if;return new;end $$;
create function public.validate_floor_feature() returns trigger language plpgsql security definer set search_path='' as $$
declare w numeric;h numeric;g jsonb:=new.geometry;p jsonb;
begin
select map_width,map_height into w,h from public.parking_floors where id=new.floor_id;
if not public.valid_map_geometry(g) then raise exception 'INVALID_GEOMETRY' using errcode='22023';end if;
if g->>'kind'='polyline' then
for p in select * from jsonb_array_elements(g->'points') loop if(p->>0)::numeric>w or(p->>1)::numeric>h then raise exception 'FEATURE_OUTSIDE_FLOOR' using errcode='22023';end if;end loop;
else if(g->>'x')::numeric+coalesce((g->>'width')::numeric,0)>w or(g->>'y')::numeric+coalesce((g->>'height')::numeric,0)>h then raise exception 'FEATURE_OUTSIDE_FLOOR' using errcode='22023';end if;end if;return new;end $$;
create trigger validate_floor_feature before insert or update on public.parking_map_features for each row execute function public.validate_floor_feature();
revoke execute on function public.validate_floor_feature() from public,anon,authenticated;
-- Explicitly preserve migrated selections/requirements without inventing old measurements.
update public.reservations set recommendation_snapshot=recommendation_snapshot||jsonb_build_object('selected',selected_preferences,'required',required_preferences) where recommendation_snapshot->>'historical'='true';
