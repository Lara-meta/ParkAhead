-- Use a distinct SQL alias from the PL/pgSQL loop record when sorting JSON results.
create or replace function public.recommend_bays(p_mall uuid,p_start timestamptz,p_end timestamptz,p_destination uuid default null,p_selected text[] default '{}',p_required text[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare data jsonb;v jsonb;e jsonb;items jsonb:='[]';sorted jsonb;
begin
perform public.validate_preferences(p_destination,p_selected,p_required);
data:=public.bay_availability(p_mall,p_start,p_end,null,p_destination);
for v in select * from jsonb_array_elements(data->'bays') loop
e:=public.evaluate_bay((v->>'id')::uuid,p_destination,public.canonical_preferences(p_selected),public.canonical_preferences(p_required));
items:=items||jsonb_build_array(v||jsonb_build_object('evaluation',e,'eligible',v->>'status'='available' and(e->>'requirementsMet')::boolean));end loop;
select coalesce(jsonb_agg(item order by (item->>'eligible')::boolean desc,(item->'evaluation'->>'score')::numeric desc,item->>'label'),'[]') into sorted from jsonb_array_elements(items) item;
return data||jsonb_build_object('bays',sorted,'algorithmVersion','demo-prefs-v1');end $$;
