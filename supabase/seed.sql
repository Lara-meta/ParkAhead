insert into public.malls(id,name,timezone) values('10000000-0000-4000-8000-000000000001','Demo Central Mall','Asia/Kuala_Lumpur') on conflict(id) do nothing;
insert into public.zones(id,mall_id,name,floor,description,map_region_key)
select ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','Zone '||chr(64+i),'B1','Fictional demo zone',chr(64+i) from generate_series(1,3) i on conflict(id) do nothing;
insert into public.bays(zone_id,label,is_active) select z.id,replace(z.name,'Zone ','')||'-'||lpad(n::text,2,'0'),not(z.name='Zone C' and n=10) from public.zones z cross join generate_series(1,10) n where z.mall_id='10000000-0000-4000-8000-000000000001' on conflict(zone_id,label) do nothing;
insert into public.destinations(id,mall_id,name,category) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Cinema','Entertainment'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Supermarket','Shopping'),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Food Court','Dining') on conflict(id) do nothing;
insert into public.zone_destination_routes(zone_id,destination_id,walking_distance_m,is_step_free,is_verified,route_description)
select z.id,d.id,case when right(z.id::text,1)=right(d.id::text,1) then 80 else 220+right(z.id::text,1)::int*35 end,case when z.name='Zone C' then null else z.name='Zone B' end,z.name<>'Zone C','Fictional demo route via the mall lobby; not surveyed at a real mall.' from public.zones z join public.destinations d on z.mall_id=d.mall_id where z.mall_id='10000000-0000-4000-8000-000000000001' on conflict(zone_id,destination_id) do nothing;
