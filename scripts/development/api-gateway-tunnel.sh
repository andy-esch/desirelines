#!/bin/bash

# API Gateway VPC Tunnel Access Script
# Usage: ./scripts/api-gateway-tunnel.sh [start|stop|test]

set -euo pipefail

GCP_PROJECT="desirelines-dev"
COMPUTE_ZONE="us-central1-a"
TUNNEL_INSTANCE="api-gateway-tunnel"
LOCAL_PORT="8080"
API_GATEWAY_URL="https://us-central1-desirelines-dev.cloudfunctions.net/desirelines_api_gateway"

create_tunnel_instance() {
    echo "🔧 Creating minimal tunnel instance..."
    gcloud compute instances create "$TUNNEL_INSTANCE" \
        --project="$GCP_PROJECT" \
        --zone="$COMPUTE_ZONE" \
        --machine-type="e2-micro" \
        --network-interface=network-tier=PREMIUM,stack-type=IPV4_ONLY,subnet=default \
        --no-restart-on-failure \
        --maintenance-policy=TERMINATE \
        --provisioning-model=SPOT \
        --service-account="$(gcloud config get-value account)" \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --create-disk=auto-delete=yes,boot=yes,device-name="$TUNNEL_INSTANCE",image=projects/debian-cloud/global/images/family/debian-12,mode=rw,size=10,type=projects/"$GCP_PROJECT"/zones/"$COMPUTE_ZONE"/diskTypes/pd-standard \
        --no-shielded-secure-boot \
        --shielded-vtpm \
        --shielded-integrity-monitoring \
        --labels=purpose=tunnel \
        --reservation-affinity=any
}

case "${1:-start}" in
    "start")
        echo "🔗 Starting API Gateway tunnel on localhost:$LOCAL_PORT"

        # Check if instance exists
        if ! gcloud compute instances describe "$TUNNEL_INSTANCE" --zone="$COMPUTE_ZONE" --project="$GCP_PROJECT" >/dev/null 2>&1; then
            create_tunnel_instance
            echo "⏳ Waiting for instance to be ready..."
            sleep 30
        fi

        echo "🌉 Opening SSH tunnel..."
        echo "📍 Local API Gateway: http://localhost:$LOCAL_PORT"
        echo "🛑 Press Ctrl+C to stop tunnel"
        echo ""

        gcloud compute ssh "$TUNNEL_INSTANCE" \
            --zone="$COMPUTE_ZONE" \
            --project="$GCP_PROJECT" \
            --ssh-flag="-L $LOCAL_PORT:us-central1-desirelines-dev.cloudfunctions.net:443" \
            --ssh-flag="-N" \
            --ssh-flag="-o ServerAliveInterval=30" \
            --ssh-flag="-o ServerAliveCountMax=3"
        ;;

    "stop")
        echo "🛑 Stopping tunnel and cleaning up..."
        if gcloud compute instances describe "$TUNNEL_INSTANCE" --zone="$COMPUTE_ZONE" --project="$GCP_PROJECT" >/dev/null 2>&1; then
            gcloud compute instances delete "$TUNNEL_INSTANCE" \
                --zone="$COMPUTE_ZONE" \
                --project="$GCP_PROJECT" \
                --quiet
            echo "✅ Tunnel instance deleted"
        else
            echo "ℹ️  No tunnel instance found"
        fi
        ;;

    "test")
        echo "🧪 Testing API Gateway access via tunnel..."
        curl -s "http://localhost:$LOCAL_PORT/health" | jq '.' || echo "❌ Tunnel not active or API Gateway unreachable"
        ;;

    *)
        echo "Usage: $0 [start|stop|test]"
        echo ""
        echo "Commands:"
        echo "  start - Create tunnel instance and open SSH tunnel to API Gateway"
        echo "  stop  - Delete tunnel instance and cleanup"
        echo "  test  - Test access via local tunnel"
        echo ""
        echo "Access API Gateway at: http://localhost:$LOCAL_PORT"
        exit 1
        ;;
esac