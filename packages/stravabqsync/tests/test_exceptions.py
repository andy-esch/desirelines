from stravabqsync.exceptions import (
    ActivityNotFoundError,
    BigQueryError,
    ConfigurationError,
    DataValidationError,
    StravaApiError,
    StravaBqSyncError,
    StravaRateLimitError,
    StravaTokenError,
)


class TestBigQueryError:
    def test_bigquery_error_without_errors(self):
        error = BigQueryError("Test message")
        assert str(error) == "Test message"
        assert error.errors == []

    def test_bigquery_error_with_errors(self):
        # This test covers the missing line 59: list(errors) if errors
        test_errors = [{"error": "field_error"}, {"error": "type_error"}]
        error = BigQueryError("Test message", errors=test_errors)
        assert str(error) == "Test message"
        assert error.errors == test_errors
        assert error.errors is not test_errors  # Should be a copy

    def test_bigquery_error_with_empty_errors(self):
        error = BigQueryError("Test message", errors=[])
        assert str(error) == "Test message"
        assert error.errors == []


class TestStravaApiError:
    def test_strava_api_error_basic(self):
        error = StravaApiError("API failed")
        assert str(error) == "API failed"
        assert error.status_code is None
        assert error.activity_id is None

    def test_strava_api_error_with_details(self):
        error = StravaApiError("API failed", status_code=500, activity_id=123)
        assert str(error) == "API failed"
        assert error.status_code == 500
        assert error.activity_id == 123


class TestStravaTokenError:
    def test_strava_token_error_inherits_from_api_error(self):
        error = StravaTokenError("Token failed", status_code=401)
        assert isinstance(error, StravaApiError)
        assert str(error) == "Token failed"
        assert error.status_code == 401


class TestStravaRateLimitError:
    def test_strava_rate_limit_error_without_retry_after(self):
        error = StravaRateLimitError("Rate limited")
        assert str(error) == "Rate limited"
        assert error.retry_after is None

    def test_strava_rate_limit_error_with_retry_after(self):
        error = StravaRateLimitError("Rate limited", retry_after=300)
        assert str(error) == "Rate limited"
        assert error.retry_after == 300


class TestActivityNotFoundError:
    def test_activity_not_found_error(self):
        error = ActivityNotFoundError(12345)
        assert str(error) == "Activity 12345 not found"
        assert error.activity_id == 12345


class TestOtherExceptions:
    def test_configuration_error(self):
        error = ConfigurationError("Config missing")
        assert isinstance(error, StravaBqSyncError)
        assert str(error) == "Config missing"

    def test_data_validation_error(self):
        error = DataValidationError("Invalid data")
        assert isinstance(error, StravaBqSyncError)
        assert str(error) == "Invalid data"

    def test_base_exception(self):
        error = StravaBqSyncError("Base error")
        assert isinstance(error, Exception)
        assert str(error) == "Base error"
