"""Geospatial helpers for decoding Strava polylines."""

import json
import logging

import polyline as polyline_codec

logger = logging.getLogger(__name__)

# GeoJSON LineString must have at least two coordinates.
MIN_LINESTRING_POINTS = 2


def decode_polyline_to_geojson(encoded: str) -> str | None:
    """Decode a Google encoded polyline to a GeoJSON LineString string.

    Returns None if the polyline decodes to fewer than 2 points
    (not a valid linestring) or if the polyline is invalid.

    Uses geojson=True to get (lng, lat) coordinate order directly.
    The returned string is ready for PostGIS ST_GeomFromGeoJSON().
    """
    if not encoded:
        return None

    try:
        coords = polyline_codec.decode(encoded, geojson=True)
    except (ValueError, IndexError):
        logger.warning("Failed to decode invalid polyline", exc_info=True)
        return None

    if len(coords) < MIN_LINESTRING_POINTS:
        return None
    return json.dumps({"type": "LineString", "coordinates": coords})
