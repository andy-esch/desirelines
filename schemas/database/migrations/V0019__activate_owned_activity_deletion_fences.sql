-- Deploy protocol-1 Python images in both environments and publish the reviewed
-- activity-writer floor/receipts before this migration. Hosted preflight and
-- apply rechecks enforce that floor; SQL cannot attest the deployed fleet.
SET ROLE desirelines_ddl_grp;
SET LOCAL lock_timeout = '5s';

GRANT INSERT, UPDATE, DELETE ON TABLE desirelines.activity_deletion_fences
    TO desirelines_dml_grp;

COMMENT ON TABLE desirelines.activity_deletion_fences IS
    'Owner-scoped deletion fences. Protocol-1 writers also consult historical '
    'deleted_activities; full-account cleanup purges fences by app UID. '
    'Retain the activity-writer compatibility floor and receipts after activation.';

RESET ROLE;
