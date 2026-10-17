-- Exit closes an unassociated session first, without implicitly checking in.
-- Cleanup winning the lock first may link it; exit then completes that booking.
-- Exit winning first leaves a closed session which cannot rescue a no-show.
do $$declare d text;begin
select pg_get_functiondef('public.simulate_gate(text,uuid,text)'::regprocedure) into d;
d:=replace(d,$q$perform public.release_one_no_show(id) from public.reservations where normalized_plate=v and status='confirmed' and arrival_deadline<=n order by id;$q$,
$q$if p_direction='entry' then perform public.release_one_no_show(id) from public.reservations where normalized_plate=v and status='confirmed' and arrival_deadline<=n order by id;end if;$q$);
execute d;
end $$;
