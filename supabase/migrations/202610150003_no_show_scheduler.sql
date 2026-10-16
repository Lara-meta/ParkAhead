-- Installing this job does not execute cleanup in the migration transaction.
-- Once activated, the first tick intentionally releases any backfilled confirmed
-- reservation already past its deadline. Review those records before activation.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('parkahead-no-shows','* * * * *','select public.release_due_no_shows();');
