# Start backend services (mode: local, debug)
start mode='local':
    #!/usr/bin/env bash
    if [[ "{{mode}}" == "local" ]]; then
        echo "🚀 Starting backend (Local Mode)..."
        docker compose --profile backend up --build --detach
    elif [[ "{{mode}}" == "debug" ]]; then
        echo "🐛 Starting backend (Debug Mode)..."
        docker compose --profile backend --profile debug up --build --detach
    else
        echo "❌ Unknown mode: {{mode}}"
        exit 1
    fi

# Start frontend stack
start-frontend:
    @echo "🎨 Starting frontend stack..."
    docker compose --profile frontend up --build --detach

# Stop all services
stop:
    @echo "🛑 Stopping all services..."
    docker compose --profile backend --profile debug --profile frontend down

# View logs (service: dispatcher, bq-inserter, etc. Default: all)
logs service='':
    docker compose --profile backend logs -f {{service}}

# Clean Docker resources
clean:
    @echo "🧹 Cleaning Docker resources..."
    docker compose down --rmi all --volumes --remove-orphans
    docker system prune -f

# Run end-to-end webhook flow test
test-flow:
    @echo "🧪 Testing full Strava webhook flow..."
    @curl -s -X POST http://localhost:8081/webhook \
        -H "Content-Type: application/json" \
        -d '{"aspect_type":"create","event_time":1734200000,"object_id":12345678,"object_type":"activity","owner_id":98765,"subscription_id":123456}' \
        | head -c 200
    @echo ""
