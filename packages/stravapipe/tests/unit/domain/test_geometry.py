"""Unit tests for geometry decode helper."""

import json

from stravapipe.domain.geometry import decode_polyline_to_geojson


class TestDecodePolylineToGeojson:
    def test_valid_polyline_returns_geojson_linestring(self):
        # "_p~iF~ps|U_ulLnnqC_mqNvxq`@" encodes 3 points:
        # (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
        encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
        result = decode_polyline_to_geojson(encoded)

        assert result is not None
        parsed = json.loads(result)
        assert parsed["type"] == "LineString"
        assert len(parsed["coordinates"]) == 3
        # GeoJSON order is (lng, lat)
        assert parsed["coordinates"][0][0] == -120.2  # lng
        assert parsed["coordinates"][0][1] == 38.5  # lat

    def test_single_point_polyline_returns_none(self):
        # A polyline encoding a single point is not a valid linestring
        # Encode (0,0) only -> "??"
        result = decode_polyline_to_geojson("??")
        assert result is None

    def test_empty_polyline_returns_none(self):
        result = decode_polyline_to_geojson("")
        assert result is None

    def test_two_point_polyline_is_valid(self):
        # "_p~iF~ps|U_ulLnnqC" encodes 2 points
        encoded = "_p~iF~ps|U_ulLnnqC"
        result = decode_polyline_to_geojson(encoded)

        assert result is not None
        parsed = json.loads(result)
        assert parsed["type"] == "LineString"
        assert len(parsed["coordinates"]) == 2
