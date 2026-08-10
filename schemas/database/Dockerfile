# Pinned, and matched to the image the deploy repo runs against dev/prod
# (.github/actions/flyway-migrate). Keep this tag, the CI migration step in
# .github/workflows/ci.yml, and the deploy repo's action on the same version —
# a migration that passes locally must be run by the same Flyway that runs it
# in production.
FROM flyway/flyway:13.2.0-alpine

# Copy migrations, callbacks, and configuration
COPY migrations /flyway/sql
COPY callbacks /flyway/callbacks
COPY flyway.conf /flyway/conf/

# Note: No USER directive needed
# The Unix user running Flyway in the container is independent from the PostgreSQL role
# PostgreSQL role is specified via DB_USER environment variable in docker-compose.yml

# Default command: run migrations
CMD ["migrate"]
