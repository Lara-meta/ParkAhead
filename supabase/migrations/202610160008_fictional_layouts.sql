-- Idempotent fictional catalog. Stable IDs; existing labels/active flags are retained.
create function public.seed_map_catalog() returns void language plpgsql security definer set search_path='' as $$
declare m integer;f integer;j integer;n integer;cnt integer;zi integer;mall uuid;fl uuid;zone uuid;dest uuid;baylabel text;zonename text;names text[]:=array['Demo Central Mall','Riverside Shopping Centre','Skyline Galleria','Garden Square Mall'];descriptions text[]:=array['A connected central concourse with three original zones and an upper parking deck.','An L-shaped riverside-inspired fictional deck with a long connecting aisle.','Two vertical parking wings beside a fictional skybridge lobby.','Courtyard parking arranged around a fictional indoor garden.'];dnames text[]:=array['Cinema','Supermarket','Food Court'];x numeric;y numeric;bx numeric;bay_y numeric;bw numeric;bh numeric;entrance text;lane jsonb;zid uuid;
begin
for m in 1..4 loop
mall:=('10000000-0000-4000-8000-'||lpad(m::text,12,'0'))::uuid;
insert into public.malls(id,name,timezone,is_demo,description,layout_key) values(mall,names[m],'Asia/Kuala_Lumpur',true,descriptions[m],'fictional-layout-'||m) on conflict(id) do update set description=excluded.description,layout_key=excluded.layout_key,is_demo=true;
for f in 1..2 loop
insert into public.parking_floors(id,mall_id,name,sort_order,map_width,map_height) values(md5('parkahead:floor:'||mall||':'||f)::uuid,mall,'B'||f,f,1000,750) on conflict(mall_id,name) do nothing;
select id into fl from public.parking_floors where mall_id=mall and name='B'||f;
for j in 1..case when m=1 and f=1 then 3 else 2 end loop
zi:=case when m=1 then case when f=1 then j else j+3 end else j+(f-1)*2 end;zonename:='Zone '||chr(64+zi);
zone:=case when m=1 and f=1 then ('20000000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid else md5('parkahead:zone:'||mall||':'||zi)::uuid end;
insert into public.zones(id,mall_id,name,floor,floor_id,description,map_region_key) values(zone,mall,zonename,'B'||f,fl,'Fictional mapped zone',chr(64+zi)) on conflict(id) do nothing;
if m=1 then x:=case when j=2 then 550 else 50 end;y:=case when j=3 then 410 when f=2 and j=2 then 410 else 100 end;
elsif m=2 then x:=case when j=1 then 60 else 550 end;y:=case when (j=1 and f=1) or(j=2 and f=2) then 120 else 400 end;
elsif m=3 then x:=case when j=1 then 60 else 550 end;y:=100+(f-1)*80;
else x:=case when j=1 then 60 else 550 end;y:=case when j=1 then 100 else 420 end;end if;
cnt:=case when m=1 and f=1 then 10 else 8 end;bw:=case when m=3 then 52 else 64 end;bh:=case when m=3 then 100 else 80 end;
for n in 1..cnt loop
baylabel:=case when m=1 and f=1 then chr(64+zi)||'-'||lpad(n::text,2,'0') else 'B'||f||'-'||chr(64+zi)||lpad(n::text,2,'0') end;
bx:=x+((n-1)%5)*72;bay_y:=y+((n-1)/5)*case when m=3 then 140 else 96 end;
insert into public.bays(id,zone_id,label,is_active,bay_type,map_x,map_y,map_width,map_height,width_mm,lift_distance_m,walkway_distance_m,exit_driving_distance_m,geometry_version)
values(md5('parkahead:bay:'||mall||':'||baylabel)::uuid,zone,baylabel,not(n=cnt and j=2),case when f=2 and j=2 and n=cnt-1 then 'accessible' else 'standard' end,bx,bay_y,bw,bh,case when n=cnt then null when n<=cnt/2 then 2700 else 2400 end,case when n=cnt then null when n<=cnt/2 then 10+n*4 else 75+n*3 end,case when n%2=1 then 5+n else 24+n end,case when n=cnt-1 then null when n<=cnt/2 then 300-n*8 else 50+n*4 end,1) on conflict(mall_id,label) do nothing;
update public.bays set map_x=bx,map_y=bay_y,map_width=bw,map_height=bh,width_mm=case when n=cnt then null when n<=cnt/2 then 2700 else 2400 end,lift_distance_m=case when n=cnt then null when n<=cnt/2 then 10+n*4 else 75+n*3 end,walkway_distance_m=case when n%2=1 then 5+n else 24+n end,exit_driving_distance_m=case when n=cnt-1 then null when n<=cnt/2 then 300-n*8 else 50+n*4 end,geometry_version=1 where mall_id=mall and label=baylabel and geometry_version=0;
end loop;
insert into public.parking_map_features(id,floor_id,type,label,geometry,metadata) values(md5('zone-label:'||zone)::uuid,fl,'zone_label',zonename,jsonb_build_object('kind','point','x',x,'y',y-20),jsonb_build_object('zoneId',zone)) on conflict(id) do nothing;
entrance:=case m when 1 then 'East Entrance' when 2 then 'River Entrance' when 3 then 'Skybridge Entrance' else 'Garden Entrance' end;
insert into public.zone_guidance(zone_id,vehicle_entrance,lift_lobby,driving_instructions) values(zone,entrance,'Lift Lobby '||j,array['Enter using the '||entrance||'.','Follow vehicle signs to Level B'||f||'.','Follow the vehicle aisle toward '||zonename||'.']) on conflict(zone_id) do nothing;
end loop;
lane:=case m when 1 then '[[950,340],[480,340],[480,680]]'::jsonb when 2 then '[[950,60],[470,60],[470,660],[40,660]]'::jsonb when 3 then '[[470,680],[470,75]]'::jsonb else '[[430,55],[950,55],[950,680],[430,680],[430,55]]'::jsonb end;
insert into public.parking_map_features(id,floor_id,type,label,geometry,metadata) values
(md5('lane:'||fl)::uuid,fl,'driving_lane','Vehicle aisle',jsonb_build_object('kind','polyline','points',lane),'{}'),
(md5('entry:'||fl)::uuid,fl,'entrance',entrance,jsonb_build_object('kind','point','x',case when m=3 then 470 else 930 end,'y',case when m=2 or m=4 then 55 when m=3 then 680 else 340 end),'{}'),
(md5('exit:'||fl)::uuid,fl,'exit','Vehicle Exit',jsonb_build_object('kind','point','x',920,'y',680),'{}'),
(md5('lift1:'||fl)::uuid,fl,'lift','Lift Lobby 1',jsonb_build_object('kind','point','x',430,'y',80),'{}'),
(md5('lift2:'||fl)::uuid,fl,'lift','Lift Lobby 2',jsonb_build_object('kind','point','x',480,'y',610),'{}'),
(md5('stairs:'||fl)::uuid,fl,'stairs','Stairs',jsonb_build_object('kind','point','x',925,'y',100),'{}'),
(md5('walk:'||fl)::uuid,fl,'pedestrian_path','Walking connection',jsonb_build_object('kind','polyline','points','[[430,95],[430,600]]'::jsonb),'{}'),
(md5('landmark:'||fl)::uuid,fl,'landmark',case m when 1 then 'Central Concourse' when 2 then 'River Atrium' when 3 then 'Skybridge Lobby' else 'Garden Courtyard' end,jsonb_build_object('kind','rect','x',case when m=4 then 540 else 550 end,'y',case when m=3 then 530 when m=4 then 150 else 615 end,'width',310,'height',70),'{}')
on conflict(id) do nothing;
end loop;
for n in 1..3 loop
dest:=case when m=1 then ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid else md5('parkahead:destination:'||mall||':'||n)::uuid end;
insert into public.destinations(id,mall_id,name,category) values(dest,mall,dnames[n],case n when 1 then 'Entertainment' when 2 then 'Shopping' else 'Dining' end) on conflict(id) do nothing;
for zid in select id from public.zones where mall_id=mall loop
select ascii(right(name,1))-64 into zi from public.zones where id=zid;
insert into public.zone_destination_routes(zone_id,destination_id,walking_distance_m,is_step_free,is_verified,route_description) values(zid,dest,case when zi=n then 80+m*5 else 120+zi*35+n*20+m*10 end,case when zi%3=0 then null else zi%2=0 end,zi%3<>0,'Fictional pedestrian connection via the lift lobby to '||dnames[n]||'; not surveyed at a real mall.') on conflict(zone_id,destination_id) do nothing;
end loop;
end loop;
end loop;
end $$;
revoke execute on function public.seed_map_catalog() from public,anon,authenticated;
select public.seed_map_catalog();

