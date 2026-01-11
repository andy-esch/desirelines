# Connect to PostgreSQL database (env: local, dev, prod; role: admin, apigateway, writer)
db-connect env role='admin':
    #!/usr/bin/env bash
    if [[ "{{env}}" == "local" ]]; then
        just db-connect-local
    else
        ./scripts/database/connect.sh {{env}} --{{role}}
    fi

# Run Flyway migrations (env: local, dev, prod; action: migrate, info, clean)
db-migrate env action='migrate':
    #!/usr/bin/env bash
    if [[ "{{env}}" == "local" ]]; then
        if [[ "{{action}}" == "clean" ]]; then
            just db-clean-local
        else
            just db-migrate-local
        fi
    else
        if [[ "{{action}}" == "info" ]]; then
            ./scripts/database/migrate.sh {{env}} --dry-run
        elif [[ "{{action}}" == "clean" ]]; then
            ./scripts/database/migrate.sh {{env}} clean
        else
            ./scripts/database/migrate.sh {{env}}
        fi
    fi

# Clean database (Drop all objects) - Dangerous!
db-clean env:
    just db-migrate {{env}} clean

# Connect to local database via Docker
db-connect-local:
    @echo "🔌 Connecting to local PostgreSQL database..."
    docker compose --profile backend exec postgres psql -U desirelines -d desirelines_local

# Run local migrations via Docker
db-migrate-local:
    @echo "🚀 Running database migrations..."
    docker compose build flyway
    docker compose --profile backend run --rm flyway migrate

# Clean local database via Docker
db-clean-local:
    @echo "🧹 Cleaning local PostgreSQL database..."
    @echo "⚠️  This will drop all objects in the desirelines schema!"
    @read -p "Are you sure? (y/N): " confirm; \
    if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
        docker compose --profile backend run --rm flyway clean; \
    else \
        echo "❌ Database clean cancelled"; \
    fi
