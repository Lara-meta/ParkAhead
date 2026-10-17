-- Floors and safe SVG geometry. Existing IDs, labels and reservations are preserved.
alter table public.malls add column description text not null default '',add column layout_key text;
create table public.parking_floors(id uuid primary key default gen_random_uuid(),mall_id uuid not null references public.malls,name text not null,sort_order integer not null default 0,map_width numeric not null default 1000 check(map_width>0 and map_width<=4000),map_height numeric not null default 700 check(map_height>0 and map_height<=4000),is_active boolean not null default true,unique(mall_id,name),unique(id,mall_id));
insert into public.parking_floors(mall_id,name) select distinct mall_id,floor from public.zones;
alter table public.zones add column floor_id uuid;
update public.zones z set floor_id=f.id from public.parking_floors f where f.mall_id=z.mall_id and f.name=z.floor;
alter table public.zones alter column floor_id set not null;
alter table public.zones add constraint zone_floor_mall foreign key(floor_id,mall_id) references public.parking_floors(id,mall_id);
alter table public.zones add constraint zone_mall_identity unique(id,mall_id);
create function public.assign_zone_floor() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.floor_id is null then insert into public.parking_floors(mall_id,name) values(new.mall_id,new.floor) on conflict(mall_id,name) do nothing;select id into new.floor_id from public.parking_floors where mall_id=new.mall_id and name=new.floor;end if;
select name into new.floor from public.parking_floors where id=new.floor_id and mall_id=new.mall_id;
if not found then raise exception 'CROSS_MALL_FLOOR' using errcode='22023';end if;return new;end $$;
create trigger assign_zone_floor before insert or update on public.zones for each row execute function public.assign_zone_floor();
alter table public.bays add column mall_id uuid,add column map_x numeric not null default 10 check(map_x>=0),add column map_y numeric not null default 10 check(map_y>=0),add column map_width numeric not null default 64 check(map_width>0 and map_width<=500),add column map_height numeric not null default 80 check(map_height>0 and map_height<=500),add column rotation numeric not null default 0 check(rotation between -180 and 180),add column width_mm integer check(width_mm>0),add column lift_distance_m integer check(lift_distance_m>=0),add column walkway_distance_m integer check(walkway_distance_m>=0),add column exit_driving_distance_m integer check(exit_driving_distance_m>=0),add column geometry_version integer not null default 0;
update public.bays b set mall_id=z.mall_id from public.zones z where z.id=b.zone_id;
alter table public.bays alter column mall_id set not null;
alter table public.bays add constraint bay_zone_mall foreign key(zone_id,mall_id) references public.zones(id,mall_id);
alter table public.bays add constraint bay_label_per_mall unique(mall_id,label);
create function public.validate_bay_geometry() returns trigger language plpgsql security definer set search_path='' as $$
declare m uuid;w numeric;h numeric;
begin
select z.mall_id,f.map_width,f.map_height into m,w,h from public.zones z join public.parking_floors f on f.id=z.floor_id where z.id=new.zone_id;
if new.mall_id is not null and new.mall_id<>m then raise exception 'CROSS_MALL_BAY' using errcode='22023';end if;
new.mall_id:=m;
if new.map_x+new.map_width>w or new.map_y+new.map_height>h then raise exception 'BAY_OUTSIDE_FLOOR' using errcode='22023';end if;return new;end $$;
create trigger validate_bay_geometry before insert or update on public.bays for each row execute function public.validate_bay_geometry();
create function public.valid_map_geometry(g jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare p jsonb;x numeric;y numeric;
begin
if jsonb_typeof(g)<>'object' or not(g->>'kind' in ('rect','point','polyline')) then return false;end if;
if g->>'kind'='polyline' then
if jsonb_typeof(g->'points')<>'array' or jsonb_array_length(g->'points') not between 2 and 60 then return false;end if;
for p in select * from jsonb_array_elements(g->'points') loop if jsonb_typeof(p)<>'array' or jsonb_array_length(p)<>2 then return false;end if;x:=(p->>0)::numeric;y:=(p->>1)::numeric;if x<0 or y<0 or x>4000 or y>4000 then return false;end if;end loop;
else x:=(g->>'x')::numeric;y:=(g->>'y')::numeric;if x is null or y is null or x<0 or y<0 or x>4000 or y>4000 then return false;end if;
if g->>'kind'='rect' and (not(g ? 'width' and g ? 'height') or (g->>'width')::numeric<=0 or(g->>'height')::numeric<=0) then return false;end if;
end if;return true;exception when others then return false;end $$;
create table public.parking_map_features(id uuid primary key default gen_random_uuid(),floor_id uuid not null references public.parking_floors,type text not null check(type in ('entrance','exit','lift','stairs','pedestrian_path','driving_lane','landmark','zone_label')),label text not null,geometry jsonb not null check(public.valid_map_geometry(geometry)),metadata jsonb not null default '{}');
create index map_features_floor on public.parking_map_features(floor_id);
create index zones_floor on public.zones(floor_id);
create table public.preference_definitions(id text primary key,label text not null,description text not null,category text not null,requires_destination boolean not null,supports_required boolean not null,evaluation_type text not null,threshold numeric,normalization_max numeric,config_version text not null default 'demo-prefs-v1');
insert into public.preference_definitions values
('shorter_walk','Shorter walk','Rank by a verified walking distance to your destination; match indicator at 150 m.','Walking route',true,false,'walking_distance',150,600,'demo-prefs-v1'),
('step_free','Verified step-free route','A verified fictional route; does not grant restricted-bay eligibility.','Walking route',true,true,'step_free',null,null,'demo-prefs-v1'),
('near_lift','Near a lift lobby','Mapped pedestrian distance of at most 40 m.','Walking route',false,true,'lift_distance',40,200,'demo-prefs-v1'),
('near_exit','Near a vehicle exit','Mapped driving distance of at most 120 m, not faster departure.','Driving convenience',false,true,'exit_driving_distance',120,600,'demo-prefs-v1'),
('wider_bay','Wider standard bay','Standard bay width of at least 2600 mm; not a restricted accessible bay.','Bay characteristics',false,true,'width',2600,null,'demo-prefs-v1'),
('near_walkway','Near a pedestrian walkway','Mapped pedestrian distance of at most 15 m.','Bay characteristics',false,true,'walkway_distance',15,75,'demo-prefs-v1');
alter table public.reservations add column selected_preferences text[] not null default '{}',add column required_preferences text[] not null default '{}',add column recommendation_snapshot jsonb not null default '{}',add column booking_mode text not null default 'automatic' check(booking_mode in ('automatic','exact'));
update public.reservations set selected_preferences=case preference when 'none' then '{}'::text[] else array[preference] end,required_preferences=case preference when 'step_free' then array['step_free'] else '{}'::text[] end,
recommendation_snapshot=jsonb_build_object('algorithmVersion','legacy-migration-v1','historical',true,'matched',array[]::text[],'unknown',case preference when 'none' then '{}'::text[] else array[preference] end,'unmet',array[]::text[],'note','Historical route/bay measurements were not recorded. Old none maps to empty, shorter_walk to preferred, step_free to required; no historical matches are invented.');
alter table public.reservations add constraint required_subset_selected check(required_preferences <@ selected_preferences);
do $$declare t text;begin foreach t in array array['parking_floors','parking_map_features','preference_definitions'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to anon,authenticated',t);execute format('create policy safe_inventory on public.%I for select using(true)',t);end loop;end $$;
revoke execute on function public.assign_zone_floor(),public.validate_bay_geometry(),public.valid_map_geometry(jsonb) from public,anon,authenticated;
