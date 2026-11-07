-- Additive preparation only. Current writers keep using deleted_activities.
-- A separate, gated activation migration grants application DML after compatible
-- writers are deployed and old requests/jobs/workflows have been drained.
SET ROLE desirelines_ddl_grp;
SET LOCAL lock_timeout = '5s';

-- No activity/mapping FK: a fence must survive hard deletion of those rows.
-- Never infer ownership for historical, unattributed deleted_activities rows.
CREATE TABLE desirelines.activity_deletion_fences (
    source                    TEXT NOT NULL CHECK (source <> ''),
    external_id               TEXT NOT NULL CHECK (external_id <> ''),
    user_id                   TEXT NOT NULL CHECK (char_length(user_id) BETWEEN 1 AND 128),
    external_owner_id          TEXT NOT NULL CHECK (external_owner_id <> ''),
    deletion_event_time       BIGINT NOT NULL,
    deleted_at                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deletion_correlation_id   VARCHAR(255),
    PRIMARY KEY (source, external_id, user_id, external_owner_id)
);

CREATE INDEX idx_activity_deletion_fences_user
    ON desirelines.activity_deletion_fences (user_id);

COMMENT ON TABLE desirelines.activity_deletion_fences IS
    'Prepared owner-scoped deletion fences. Readers must also consult historical '
    'deleted_activities. Application DML remains disabled until the writer '
    'compatibility floor and activation migration are in place.';
COMMENT ON COLUMN desirelines.activity_deletion_fences.user_id IS
    'Resolved app UID, independent of external_owner_id (the provider subject).';

-- V0001 default privileges grant DML to new tables. Revoke them transactionally
-- so deploying a compatible reader cannot accidentally activate fence writes.
REVOKE ALL ON TABLE desirelines.activity_deletion_fences FROM PUBLIC, desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.activity_deletion_fences
    TO desirelines_dml_grp, desirelines_ro_grp;

RESET ROLE;
