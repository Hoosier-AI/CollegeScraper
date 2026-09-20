-- WMT Digital athletics sites (Notre Dame, Virginia, Penn St., Clemson, Old Dominion and ~80 other programs) are a
-- third site platform: their roster pages embed the same Nuxt payload format the newer Sidearm template uses.
ALTER TABLE public.college_schools DROP CONSTRAINT IF EXISTS college_schools_site_platform_check;
ALTER TABLE public.college_schools ADD CONSTRAINT college_schools_site_platform_check
  CHECK (site_platform IN ('sidearm','presto','wmt','other','unknown'));
