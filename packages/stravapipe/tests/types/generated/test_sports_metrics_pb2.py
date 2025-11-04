"""Tests for sports_metrics protobuf schema and serialization.

These tests verify that the generated protobuf code works correctly
for multi-sport support, including optional field behavior and JSON serialization.
"""

import json

from google.protobuf import json_format

from stravapipe.types.generated import activities_pb2, sports_metrics_pb2


class TestSportMetricsProtobuf:
    """Test SportMetrics protobuf message."""

    def test_cycling_with_distance_and_elevation(self):
        """Test creating a cycling metrics object with distance and elevation."""
        # Create metrics for cycling (has distance and elevation)
        metrics = sports_metrics_pb2.SportMetrics()
        metrics.metadata.sport = "cycling"
        metrics.metadata.year = 2024
        metrics.metadata.available_metrics.extend(
            ["distance_meters", "time_minutes", "elevation_meters"]
        )
        metrics.metadata.primary_metric = "distance_meters"

        # Add daily activity
        daily = metrics.daily["2024-01-15"]
        daily.distance_meters = 42195.0  # Marathon distance in meters
        daily.time_minutes = 120.5
        daily.elevation_meters = 450.0
        daily.activities = 2
        daily.activity_ids.extend([123456, 123457])

        # Convert to JSON
        json_str = json_format.MessageToJson(metrics, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Verify structure
        assert data["metadata"]["sport"] == "cycling"
        assert data["metadata"]["year"] == 2024
        assert data["daily"]["2024-01-15"]["distance_meters"] == 42195.0
        assert data["daily"]["2024-01-15"]["elevation_meters"] == 450.0
        assert data["daily"]["2024-01-15"]["activities"] == 2
        assert len(data["daily"]["2024-01-15"]["activity_ids"]) == 2

    def test_yoga_without_distance_optional_fields(self):
        """Test yoga metrics - optional fields (distance, elevation) should be omitted."""
        metrics = sports_metrics_pb2.SportMetrics()
        metrics.metadata.sport = "yoga"
        metrics.metadata.year = 2024
        metrics.metadata.available_metrics.extend(["time_minutes"])
        metrics.metadata.primary_metric = "time_minutes"

        # Add daily activity - only time, no distance or elevation
        daily = metrics.daily["2024-01-15"]
        daily.time_minutes = 60.0
        daily.activities = 1
        daily.activity_ids.append(123458)

        # Convert to JSON
        json_str = json_format.MessageToJson(metrics, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Verify optional fields are omitted when not set
        daily_data = data["daily"]["2024-01-15"]
        assert "distance_meters" not in daily_data
        assert "elevation_meters" not in daily_data
        assert daily_data["time_minutes"] == 60.0
        assert daily_data["activities"] == 1

    def test_timeseries_data(self):
        """Test creating timeseries arrays for chart data."""
        metrics = sports_metrics_pb2.SportMetrics()

        # Add distance timeseries entries
        entry1 = metrics.timeseries.distance_meters.add()
        entry1.date = "2024-01-15"
        entry1.value = 10000.0

        entry2 = metrics.timeseries.distance_meters.add()
        entry2.date = "2024-01-16"
        entry2.value = 15000.0

        # Convert to JSON
        json_str = json_format.MessageToJson(metrics, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Verify timeseries structure
        assert len(data["timeseries"]["distance_meters"]) == 2
        assert data["timeseries"]["distance_meters"][0]["date"] == "2024-01-15"
        assert data["timeseries"]["distance_meters"][0]["value"] == 10000.0
        assert data["timeseries"]["distance_meters"][1]["date"] == "2024-01-16"
        assert data["timeseries"]["distance_meters"][1]["value"] == 15000.0

    def test_deserialization_from_json(self):
        """Test parsing JSON back into protobuf message."""
        json_data = {
            "metadata": {
                "sport": "running",
                "year": 2024,
                "available_metrics": ["distance_meters", "time_minutes"],
                "primary_metric": "distance_meters",
            },
            "daily": {
                "2024-01-15": {
                    "distance_meters": 5000.0,
                    "time_minutes": 30.0,
                    "activities": 1,
                    "activity_ids": ["999999"],
                }
            },
        }

        # Parse JSON into protobuf
        metrics = json_format.ParseDict(json_data, sports_metrics_pb2.SportMetrics())

        # Verify fields
        assert metrics.metadata.sport == "running"
        assert metrics.metadata.year == 2024
        assert metrics.daily["2024-01-15"].distance_meters == 5000.0
        assert metrics.daily["2024-01-15"].time_minutes == 30.0
        assert metrics.daily["2024-01-15"].activities == 1


class TestYearMetadataProtobuf:
    """Test YearMetadata protobuf message."""

    def test_year_metadata_with_multiple_sports(self):
        """Test year metadata with totals for multiple sports."""
        metadata = sports_metrics_pb2.YearMetadata()
        metadata.year = 2024
        metadata.sports.extend(["cycling", "running", "yoga"])
        metadata.last_updated = "2024-11-01T12:00:00Z"
        metadata.aggregation_version = "1.0"

        # Add totals for cycling
        cycling_totals = metadata.totals["cycling"]
        cycling_totals.distance_meters = 500000.0
        cycling_totals.time_minutes = 2000.0
        cycling_totals.elevation_meters = 15000.0
        cycling_totals.activities = 50

        # Add totals for yoga (no distance/elevation)
        yoga_totals = metadata.totals["yoga"]
        yoga_totals.time_minutes = 1200.0
        yoga_totals.activities = 30

        # Convert to JSON
        json_str = json_format.MessageToJson(metadata, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Verify structure
        assert data["year"] == 2024
        assert len(data["sports"]) == 3
        assert data["totals"]["cycling"]["distance_meters"] == 500000.0
        assert data["totals"]["cycling"]["activities"] == 50
        # Yoga should omit distance/elevation
        assert "distance_meters" not in data["totals"]["yoga"]
        assert data["totals"]["yoga"]["time_minutes"] == 1200.0


class TestDailyActivityProtobuf:
    """Test DailyActivity protobuf message edge cases."""

    def test_empty_daily_activity(self):
        """Test that completely empty daily activity is valid."""
        daily = sports_metrics_pb2.DailyActivity()
        daily.activities = 0

        json_str = json_format.MessageToJson(daily, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Protobuf omits default values (0) from JSON, so empty object is expected
        # No optional fields should be present
        assert "distance_meters" not in data
        assert "time_minutes" not in data
        assert "elevation_meters" not in data
        # activities=0 is the default, so it's also omitted
        assert data == {}

    def test_partial_metrics(self):
        """Test activity with some but not all optional metrics."""
        daily = sports_metrics_pb2.DailyActivity()
        daily.distance_meters = 1000.0
        # No time_minutes or elevation_meters
        daily.activities = 1

        json_str = json_format.MessageToJson(daily, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Only set fields should appear
        assert data["distance_meters"] == 1000.0
        assert "time_minutes" not in data
        assert "elevation_meters" not in data
        assert data["activities"] == 1


class TestActivitiesProtobuf:
    """Test activities.proto generated code."""

    def test_timeseries_entry(self):
        """Test TimeseriesEntry from activities.proto."""
        entry = activities_pb2.TimeseriesEntry()
        entry.date = "2024-01-15"
        entry.value = 42.5

        # Convert to JSON
        json_str = json_format.MessageToJson(entry, preserving_proto_field_name=True)
        data = json.loads(json_str)

        assert data["date"] == "2024-01-15"
        assert data["value"] == 42.5

    def test_distances_payload(self):
        """Test DistancesPayload from activities.proto."""
        payload = activities_pb2.DistancesPayload()

        # Add distance traveled entries
        entry1 = payload.distance_traveled.add()
        entry1.date = "2024-01-15"
        entry1.value = 10.5

        entry2 = payload.distance_traveled.add()
        entry2.date = "2024-01-16"
        entry2.value = 25.3

        json_str = json_format.MessageToJson(payload, preserving_proto_field_name=True)
        data = json.loads(json_str)

        assert len(data["distance_traveled"]) == 2
        assert data["distance_traveled"][0]["date"] == "2024-01-15"
        assert data["distance_traveled"][0]["value"] == 10.5
        assert data["distance_traveled"][1]["date"] == "2024-01-16"
        assert data["distance_traveled"][1]["value"] == 25.3

    def test_year_summary(self):
        """Test YearSummary from activities.proto."""
        year_summary = activities_pb2.YearSummary()

        # Add daily summaries
        day1 = year_summary.daily_summaries["2024-01-15"]
        day1.distance_miles = 15.0
        day1.activity_ids.extend(["111", "222"])

        day2 = year_summary.daily_summaries["2024-01-16"]
        day2.distance_miles = 20.0
        day2.activity_ids.append("333")

        json_str = json_format.MessageToJson(
            year_summary, preserving_proto_field_name=True
        )
        data = json.loads(json_str)

        assert len(data["daily_summaries"]) == 2
        assert data["daily_summaries"]["2024-01-15"]["distance_miles"] == 15.0
        assert len(data["daily_summaries"]["2024-01-16"]["activity_ids"]) == 1


class TestMetricTimeseriesEntry:
    """Test MetricTimeseriesEntry (renamed from TimeseriesEntry)."""

    def test_metric_timeseries_entry_creation(self):
        """Test creating MetricTimeseriesEntry."""
        entry = sports_metrics_pb2.MetricTimeseriesEntry()
        entry.date = "2024-11-01"
        entry.value = 5000.0

        assert entry.date == "2024-11-01"
        assert entry.value == 5000.0

    def test_metric_timeseries_entry_in_list(self):
        """Test MetricTimeseriesEntry in repeated field."""
        metrics = sports_metrics_pb2.SportMetrics()

        entry1 = metrics.timeseries.distance_meters.add()
        entry1.date = "2024-01-01"
        entry1.value = 1000.0

        entry2 = metrics.timeseries.distance_meters.add()
        entry2.date = "2024-01-02"
        entry2.value = 2000.0

        assert len(metrics.timeseries.distance_meters) == 2
        assert metrics.timeseries.distance_meters[0].date == "2024-01-01"
        assert metrics.timeseries.distance_meters[1].value == 2000.0
