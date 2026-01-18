FROM flyway/flyway:latest

# Copy migrations, callbacks, and configuration
COPY migrations /flyway/sql
COPY callbacks /flyway/callbacks
COPY flyway.conf /flyway/conf/

# Note: No USER directive needed
# The Unix user running Flyway in the container is independent from the PostgreSQL role
# PostgreSQL role is specified via DB_USER environment variable in docker-compose.yml

# Default command: run migrations
CMD ["migrate"]
