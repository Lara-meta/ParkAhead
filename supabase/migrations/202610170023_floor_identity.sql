-- Preserve identity and capture old readable locations before changing labels.
alter table public.reservations add column location_snapshot jsonb;
update public.reservations r set location_snapshot=jsonb_build_object('mallId',m.id,'mallName',m.name,'floorId',f.id,'floor',f.name,'zoneId',z.id,'zoneName',z.name,'bayId',b.id,'bayLabel',b.label)
from public.bays b join public.zones z on z.id=b.zone_id join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id where b.id=r.bay_id;
alter table public.zones drop constraint zones_mall_id_name_key;
alter table public.zones add column code text;
with ranked as(select id,chr(64+row_number() over(partition by floor_id order by name)::integer) as code from public.zones)
update public.zones z set code=r.code from ranked r where z.id=r.id;
alter table public.zones alter column code set not null;
alter table public.zones add constraint zone_code_per_floor unique(floor_id,code),add constraint zone_name_per_floor unique(floor_id,name);
-- Optional code for existing callers that only provide a zone name.
create function public.zone_code_default() returns trigger language plpgsql set search_path='' as $$begin new.code:=coalesce(new.code,new.name);return new;end $$;
create trigger aa_zone_code_default before insert on public.zones for each row execute function public.zone_code_default();
alter table public.bays add column code text;
update public.bays set code=substring(label from '([0-9]+)$');
alter table public.bays alter column code set not null;
alter table public.bays add constraint bay_code_per_zone unique(zone_id,code);
create function public.bay_code_default() returns trigger language plpgsql set search_path='' as $$begin new.code:=coalesce(new.code,new.label);return new;end $$;
create trigger aa_bay_code_default before insert on public.bays for each row execute function public.bay_code_default();
-- Apply readable labels only to known fictional catalog; never move bay IDs.
update public.zones z set name='Zone '||z.code from public.malls m where m.id=z.mall_id and m.layout_key like 'fictional-layout-%';
-- Avoid transient unique collisions while relabeling.
update public.bays b set label='migration-'||b.id from public.malls m where m.id=b.mall_id and m.layout_key like 'fictional-layout-%';
update public.bays b set label=f.name||'-'||z.code||b.code
from public.zones z join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id
where b.zone_id=z.id and m.layout_key like 'fictional-layout-%';
update public.parking_map_features p set label=z.name from public.zones z where p.type='zone_label' and p.metadata->>'zoneId'=z.id::text;
create table public.mall_layout_templates(id uuid primary key,mall_id uuid not null references public.malls,version integer not null,structural_features jsonb not null,description text not null,unique(id,mall_id));
alter table public.parking_floors add column layout_template_id uuid;
alter table public.parking_floors add constraint floor_template_mall foreign key(layout_template_id,mall_id) references public.mall_layout_templates(id,mall_id);
insert into public.mall_layout_templates(id,mall_id,version,structural_features,description)
select md5('structure-v2:'||m.id)::uuid,m.id,1,
coalesce((select jsonb_agg(jsonb_build_object('type',p.type,'label',p.label,'geometry',p.geometry) order by p.type,p.label) from public.parking_map_features p join public.parking_floors f on f.id=p.floor_id where f.mall_id=m.id and f.name='B1' and p.type not in('zone_label','entrance','exit')),'[]'),
'Immutable fictional structural configuration; floor inventory, routes and operational states remain independent.'
from public.malls m where m.layout_key like 'fictional-layout-%';
update public.parking_floors f set layout_template_id=t.id from public.mall_layout_templates t where f.mall_id=t.mall_id;
-- Materialise the shared structure onto B2; floor-specific entrances/exits stay.
update public.parking_map_features p set geometry=src.geometry
from public.parking_floors f join public.parking_floors f1 on f1.mall_id=f.mall_id and f1.name='B1'
join public.parking_map_features src on src.floor_id=f1.id
where p.floor_id=f.id and f.name='B2' and f.layout_template_id is not null and p.type=src.type and p.label=src.label and p.type not in('entrance','exit','zone_label');
-- Materialise common zone/bay positions. Counts, IDs, category and routes stay independent.
update public.bays b set map_x=src.map_x,map_y=src.map_y
from public.zones z join public.parking_floors f on f.id=z.floor_id
join public.parking_floors f1 on f1.mall_id=f.mall_id and f1.name='B1'
join public.zones z1 on z1.floor_id=f1.id and z1.code=z.code
join public.bays src on src.zone_id=z1.id
where b.zone_id=z.id and b.code=src.code and f.name='B2' and f.layout_template_id is not null;
update public.parking_map_features p set geometry=src.geometry
from public.zones z join public.parking_floors f on f.id=z.floor_id
join public.parking_floors f1 on f1.mall_id=f.mall_id and f1.name='B1'
join public.zones z1 on z1.floor_id=f1.id and z1.code=z.code
join public.parking_map_features src on src.metadata->>'zoneId'=z1.id::text and src.type='zone_label'
where p.metadata->>'zoneId'=z.id::text and p.type='zone_label' and f.name='B2' and f.layout_template_id is not null;
alter table public.mall_layout_templates enable row level security;
revoke all on public.mall_layout_templates from anon,authenticated;
grant select on public.mall_layout_templates to anon,authenticated;
create policy public_layout_templates on public.mall_layout_templates for select using(true);
create function public.snapshot_booking_location() returns trigger language plpgsql security definer set search_path='' as $$begin
select jsonb_build_object('mallId',m.id,'mallName',m.name,'floorId',f.id,'floor',f.name,'zoneId',z.id,'zoneName',z.name,'bayId',b.id,'bayLabel',b.label)
into new.location_snapshot from public.bays b join public.zones z on z.id=b.zone_id join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id where b.id=new.bay_id;return new;end $$;
create trigger snapshot_booking_location before insert on public.reservations for each row execute function public.snapshot_booking_location();
-- Former seeder is retained for historical migration dependency only.
alter function public.seed_map_catalog() rename to seed_map_catalog_legacy;
create function public.seed_map_catalog() returns void language plpgsql security definer set search_path='' as $$begin
if (select count(*) from public.malls where layout_key like 'fictional-layout-%')<>4 then raise exception 'CATALOG_INCOMPLETE: restore missing catalog through a reviewed additive migration, never reseed across preserved bay identities';end if;
end $$;
revoke all on function public.zone_code_default(),public.bay_code_default(),public.snapshot_booking_location(),public.seed_map_catalog(),public.seed_map_catalog_legacy() from public,anon,authenticated;
