-- Catalog is materialized by versioned migrations; preserve inventory IDs and bay types.
select public.seed_map_catalog();
select public.seed_access_catalog();
