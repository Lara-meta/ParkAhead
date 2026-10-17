-- Keep old event rows intact; future manual departures use their own event name.
do $$declare d text;begin
select pg_get_functiondef('public.transition(uuid,text)'::regprocedure) into d;
d:=replace(d,$q$public.access_audit('gate_exit',s.id,r.id,null,n,r.is_demo,'MANUAL_DEPARTURE')$q$,$q$public.access_audit('manual_departure',s.id,r.id,null,n,r.is_demo,'MANUAL_DEPARTURE')$q$);execute d;
end $$;
-- Direction labels follow floor-scoped zone names without claiming surveyed routes.
update public.zone_guidance g set driving_instructions=array[
'Enter using the '||g.vehicle_entrance||'.',
'Follow vehicle signs to Level '||f.name||'.',
'Follow the vehicle aisle toward '||f.name||' · '||z.name||'.']
from public.zones z join public.parking_floors f on f.id=z.floor_id join public.malls m on m.id=z.mall_id
where g.zone_id=z.id and m.layout_key like 'fictional-layout-%';
