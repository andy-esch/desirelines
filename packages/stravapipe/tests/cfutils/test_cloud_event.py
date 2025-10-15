"""Tests for cloud_event module"""

import base64
import json
from unittest.mock import Mock

import pytest

from stravapipe.cfutils.cloud_event import (
    CloudEventValidationError,
    MessageDecodeError,
    safe_decode_message,
    validate_cloud_event,
)


class TestSafeDecodeMessage:
    """Tests for safe_decode_message function"""

    def test_valid_message(self):
        """Should decode valid base64 JSON message"""
        data = {"foo": "bar", "num": 123}
        encoded = base64.b64encode(json.dumps(data).encode()).decode()

        result = safe_decode_message(encoded)

        assert result == data

    def test_invalid_base64(self):
        """Should raise MessageDecodeError for invalid base64"""
        with pytest.raises(MessageDecodeError) as exc_info:
            safe_decode_message("not-valid-base64!!!")

        assert "Failed to decode message" in str(exc_info.value)

    def test_invalid_json(self):
        """Should raise MessageDecodeError for invalid JSON"""
        invalid_json = base64.b64encode(b"{not valid json}").decode()

        with pytest.raises(MessageDecodeError) as exc_info:
            safe_decode_message(invalid_json)

        assert "Failed to decode message" in str(exc_info.value)

    def test_invalid_utf8(self):
        """Should raise MessageDecodeError for invalid UTF-8"""
        # Create invalid UTF-8 sequence
        invalid_utf8 = base64.b64encode(b"\xff\xfe").decode()

        with pytest.raises(MessageDecodeError) as exc_info:
            safe_decode_message(invalid_utf8)

        assert "Failed to decode message" in str(exc_info.value)


class TestValidateCloudEvent:
    """Tests for validate_cloud_event function"""

    def test_valid_event(self):
        """Should pass validation for valid CloudEvent"""
        event = Mock()
        event.data = {
            "message": {
                "data": "base64-encoded-data",
                "messageId": "123",
            }
        }

        # Should not raise
        validate_cloud_event(event)

    def test_missing_data(self):
        """Should raise CloudEventValidationError when data is missing"""
        event = Mock()
        event.data = None

        with pytest.raises(CloudEventValidationError) as exc_info:
            validate_cloud_event(event)

        assert "data is missing" in str(exc_info.value)

    def test_data_not_dict(self):
        """Should raise CloudEventValidationError when data is not a dict"""
        event = Mock()
        event.data = "not a dict"

        with pytest.raises(CloudEventValidationError) as exc_info:
            validate_cloud_event(event)

        assert "must be a dictionary" in str(exc_info.value)

    def test_missing_message_field(self):
        """Should raise CloudEventValidationError when message field is missing"""
        event = Mock()
        event.data = {"other": "field"}

        with pytest.raises(CloudEventValidationError) as exc_info:
            validate_cloud_event(event)

        assert "missing 'message' field" in str(exc_info.value)

    def test_missing_data_field_in_message(self):
        """Should raise CloudEventValidationError when message.data is missing"""
        event = Mock()
        event.data = {"message": {"messageId": "123"}}

        with pytest.raises(CloudEventValidationError) as exc_info:
            validate_cloud_event(event)

        assert "message missing 'data' field" in str(exc_info.value)


