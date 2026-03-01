"""Geospatial helpers for decoding Strava polylines."""

import json

import polyline as polyline_codec


def decode_polyline_to_geojson(encoded: str) -> str | None:
    """Decode a Google encoded polyline to a GeoJSON LineString string.

    Returns None if the polyline decodes to fewer than 2 points
    (not a valid linestring).

    Uses geojson=True to get (lng, lat) coordinate order directly.
    The returned string is ready for PostGIS ST_GeomFromGeoJSON().
    """
    coords = polyline_codec.decode(encoded, geojson=True)
    if len(coords) < 2:
        return None
    return json.dumps({"type": "LineString", "coordinates": coords})
