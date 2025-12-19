"""Tests for sports_metrics protobuf schema and serialization.

These tests verify that the generated protobuf code works correctly
for multi-sport support, including optional field behavior and JSON serialization.
"""

import json

from google.protobuf import json_format

from stravapipe.types.generated import sports_metrics_pb2


class TestSportMetricsProtobuf:
    """Test SportMetrics protobuf message."""

    def test_cycling_with_distance_and_elevation(self):
        """Test creating a cycling metrics object with cumulative metrics."""
        # Create metrics for cycling (has distance and elevation)
        metrics = sports_metrics_pb2.SportMetrics()

        # Add cumulative metrics entries
        entry1 = metrics.timeseries.add()
        entry1.date = "2024-01-15"
        entry1.distance = 10000.0  # 10km cumulative
        entry1.elevation = 200.0
        entry1.time = 60.0  # 1 hour
        entry1.activities = 1

        entry2 = metrics.timeseries.add()
        entry2.date = "2024-01-16"
        entry2.distance = 25000.0  # 25km cumulative (15km added)
        entry2.elevation = 450.0  # 450m cumulative (250m added)
        entry2.time = 180.5  # 180.5 minutes cumulative
        entry2.activities = 2

        # Convert to JSON
        json_str = json_format.MessageToJson(metrics, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Verify structure
        assert len(data["timeseries"]) == 2
        assert data["timeseries"][0]["date"] == "2024-01-15"
        assert data["timeseries"][0]["distance"] == 10000.0
        assert data["timeseries"][0]["elevation"] == 200.0
        assert data["timeseries"][0]["time"] == 60.0
        assert data["timeseries"][0]["activities"] == 1
        assert data["timeseries"][1]["date"] == "2024-01-16"
        assert data["timeseries"][1]["distance"] == 25000.0

    def test_yoga_without_distance_optional_fields(self):
        """Test yoga metrics - optional fields (distance, elevation) should be omitted."""
        metrics = sports_metrics_pb2.SportMetrics()

        # Add cumulative metrics entry - only time, no distance or elevation
        entry = metrics.timeseries.add()
        entry.date = "2024-01-15"
        entry.time = 60.0
        entry.activities = 1

        # Convert to JSON
        json_str = json_format.MessageToJson(metrics, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Verify optional fields are omitted when not set
        entry_data = data["timeseries"][0]
        assert "distance" not in entry_data
        assert "elevation" not in entry_data
        assert entry_data["time"] == 60.0
        assert entry_data["activities"] == 1

    def test_timeseries_data(self):
        """Test creating cumulative metrics timeseries for chart data."""
        metrics = sports_metrics_pb2.SportMetrics()

        # Add cumulative metrics entries
        entry1 = metrics.timeseries.add()
        entry1.date = "2024-01-15"
        entry1.distance = 10000.0
        entry1.time = 60.0
        entry1.activities = 1

        entry2 = metrics.timeseries.add()
        entry2.date = "2024-01-16"
        entry2.distance = 15000.0
        entry2.time = 90.0
        entry2.activities = 2

        # Convert to JSON
        json_str = json_format.MessageToJson(metrics, preserving_proto_field_name=True)
        data = json.loads(json_str)

        # Verify timeseries structure
        assert len(data["timeseries"]) == 2
        assert data["timeseries"][0]["date"] == "2024-01-15"
        assert data["timeseries"][0]["distance"] == 10000.0
        assert data["timeseries"][1]["date"] == "2024-01-16"
        assert data["timeseries"][1]["distance"] == 15000.0

    def test_deserialization_from_json(self):
        """Test parsing JSON back into protobuf message."""
        json_data = {
            "timeseries": [
                {
                    "date": "2024-01-15",
                    "distance": 5000.0,
                    "time": 30.0,
                    "activities": 1,
                },
                {
                    "date": "2024-01-16",
                    "distance": 10000.0,
                    "time": 60.0,
                    "elevation": 200.0,
                    "activities": 2,
                },
            ]
        }

        # Parse JSON into protobuf
        metrics = json_format.ParseDict(json_data, sports_metrics_pb2.SportMetrics())

        # Verify fields
        assert len(metrics.timeseries) == 2
        assert metrics.timeseries[0].date == "2024-01-15"
        assert metrics.timeseries[0].distance == 5000.0
        assert metrics.timeseries[0].time == 30.0
        assert metrics.timeseries[0].activities == 1
        assert metrics.timeseries[1].date == "2024-01-16"
        assert metrics.timeseries[1].distance == 10000.0
        assert metrics.timeseries[1].elevation == 200.0


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
        """Test CumulativeMetricsEntry in repeated field."""
        metrics = sports_metrics_pb2.SportMetrics()

        entry1 = metrics.timeseries.add()
        entry1.date = "2024-01-01"
        entry1.distance = 1000.0
        entry1.time = 60.0
        entry1.activities = 1

        entry2 = metrics.timeseries.add()
        entry2.date = "2024-01-02"
        entry2.distance = 2000.0
        entry2.time = 120.0
        entry2.activities = 2

        assert len(metrics.timeseries) == 2
        assert metrics.timeseries[0].date == "2024-01-01"
        assert metrics.timeseries[0].distance == 1000.0
        assert metrics.timeseries[1].date == "2024-01-02"
        assert metrics.timeseries[1].distance == 2000.0
