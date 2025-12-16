-- Grant role group memberships for local development
-- Run AFTER Flyway migrations (which create the role groups in V0001)
--
-- This grants the login roles membership in the appropriate role groups:
-- - writer -> desirelines_dml_grp (read/write)
-- - apigateway -> desirelines_ro_grp (read-only)
-- - flyway -> desirelines_ddl_grp (DDL)
-- - admin -> desirelines_ddl_grp (DDL)

-- Grant memberships (idempotent - won't error if already granted)
GRANT desirelines_dml_grp TO writer;
GRANT desirelines_ro_grp TO apigateway;
GRANT desirelines_ddl_grp TO flyway;
GRANT desirelines_ddl_grp TO admin;

-- Set search paths for login roles
ALTER ROLE writer SET search_path = desirelines, extensions, public;
ALTER ROLE apigateway SET search_path = desirelines, extensions, public;
ALTER ROLE flyway SET search_path = desirelines, extensions, public;
ALTER ROLE admin SET search_path = desirelines, extensions, public;
