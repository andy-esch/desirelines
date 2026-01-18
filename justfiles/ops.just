# Start backend services
start-backend:
    @echo "🚀 Starting backend (Local Mode)..."
    docker compose --env-file .env.local --profile backend up --build --detach

# Start frontend stack
start-frontend:
    @echo "🎨 Starting frontend stack..."
    docker compose --env-file .env.local --profile frontend up --build --detach

# Stop all services (database resets automatically with anonymous volumes)
stop:
    @echo "🛑 Stopping all services..."
    docker compose --profile backend --profile debug --profile frontend down

# Restart frontend stack (stop + start, clean database state)
restart-frontend:
    @echo "🔄 Restarting frontend stack..."
    docker compose --profile frontend down
    docker compose --profile frontend up --build --detach

# Restart backend stack (stop + start, clean database state)
restart-backend:
    @echo "🔄 Restarting backend stack..."
    docker compose --profile backend down
    docker compose --profile backend up --build --detach

# View logs (service: dispatcher, bq-inserter, etc. Default: all)
logs service='':
    docker compose --profile backend logs -f {{ service }}

# Clean Docker resources (removes images, volumes, orphans)
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
