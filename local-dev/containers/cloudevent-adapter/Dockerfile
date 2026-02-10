# CloudEvent Adapter for local development
# Bridges PubSub emulator (raw push) to Cloud Run services (CloudEvent format)

FROM python:3.14-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir fastapi uvicorn httpx

# Copy the adapter script
COPY cloudevent_adapter.py .

# Run with uvicorn
CMD ["uvicorn", "cloudevent_adapter:app", "--host", "0.0.0.0", "--port", "8080"]
