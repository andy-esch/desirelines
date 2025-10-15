# cfutils

Shared utilities for Google Cloud Functions in the Desirelines project.

## Overview

This package provides common utilities for Cloud Functions v2, including:
- CloudEvent validation and message decoding
- Standardized response helpers
- Logging setup

## Usage

```python
from cfutils.cloud_event import (
    CloudEventValidationError,
    MessageDecodeError,
    safe_decode_message,
    setup_cloud_function_logging,
    validate_cloud_event,
)
from cfutils.responses import success_response, skipped_response, error_response

# Set up logging
logger = setup_cloud_function_logging(__name__)

# Validate and decode CloudEvent
@functions_framework.cloud_event
def my_function(event: CloudEvent) -> dict:
    correlation_id = str(uuid.uuid4())

    try:
        validate_cloud_event(event)
        event_data = safe_decode_message(event.data["message"]["data"])

        # Process event...

        return success_response(
            action="processed",
            activity_id=123,
            correlation_id=correlation_id,
        )
    except MessageDecodeError as e:
        logger.error("Message decode failed: %s", e)
        return error_response("decode_error", str(e), correlation_id)
```

## Modules

- `cloud_event` - CloudEvent processing utilities
- `responses` - Standardized response helpers

## Development

Install in development mode:
```bash
cd packages/cfutils
uv pip install -e .
```

Run tests:
```bash
uv run pytest
```
