"""Executable compatibility contract for persisted activity fields.

The manifest records policy; these tests derive inventories from the actual
Pydantic models, PostgreSQL writer mapping, and generated BigQuery descriptor.
Adding a field to any of those surfaces without recording both live and
backfill behavior must fail normal CI.
"""

from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any, get_args

from pydantic import BaseModel

from stravapipe.adapters.gcp._bigquery_storage import (
    BigQueryStorageWriter,
    _populate_message,
)
from stravapipe.adapters.postgres._repository import (
    _ACTIVITY_COLUMN_ATTRIBUTES,
    _ACTIVITY_COLUMNS,
    _ACTIVITY_SYSTEM_COLUMNS,
    _activity_write_params,
)
from stravapipe.domain import (
    DetailedStravaActivity,
    StandardActivity,
    SummaryStravaActivity,
)
from stravapipe.types.generated import bq_activities_pb2

_AVAILABILITY = {"available", "unavailable"}
_POSTGRES_KINDS = {"column", "derived_column", "route", "not_persisted"}
_BIGQUERY_KINDS = {"column", "excluded", "not_persisted"}
_LIVE_ACTIONS = {
    "create_write",
    "create_write_and_enriched_pg_upsert",
    "create_write_and_enriched_pg_reconcile_existing_route",
    "create_write_enriched_pg_upsert_and_bare_metadata",
    "not_applicable",
}
_BACKFILL_ACTIONS = {
    "write",
    "derive",
    "leave_unavailable",
    "preserve",
    "alternate_source",
    "not_applicable",
}


def _repo_file(relative_path: str) -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / relative_path
        if candidate.exists():
            return candidate
    raise FileNotFoundError(relative_path)


def _load_json(relative_path: str) -> dict[str, Any]:
    return json.loads(_repo_file(relative_path).read_text(encoding="utf-8"))


def _contract() -> dict[str, Any]:
    return _load_json("schemas/activities/persisted_activity_contract.json")


def _fixture(name: str) -> dict[str, Any]:
    return _load_json(f"packages/stravapipe/tests/fixtures/{name}")


def _nested_model(annotation: Any) -> type[BaseModel] | None:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    for argument in get_args(annotation):
        nested = _nested_model(argument)
        if nested is not None:
            return nested
    return None


def _nested_paths(model: type[BaseModel], *, prefix: str) -> set[str]:
    paths: set[str] = set()
    for name, field in model.model_fields.items():
        path = f"{prefix}.{name}"
        paths.add(path)
        nested = _nested_model(field.annotation)
        if nested is not None:
            paths.update(_nested_paths(nested, prefix=path))
    return paths


def _source_nested_differences() -> set[str]:
    differences: set[str] = set()
    shared_fields = set(DetailedStravaActivity.model_fields) & set(
        SummaryStravaActivity.model_fields
    )
    for name in shared_fields:
        detailed_model = _nested_model(
            DetailedStravaActivity.model_fields[name].annotation
        )
        summary_model = _nested_model(
            SummaryStravaActivity.model_fields[name].annotation
        )
        if detailed_model is None and summary_model is None:
            continue
        detailed_paths = (
            _nested_paths(detailed_model, prefix=name)
            if detailed_model is not None
            else set()
        )
        summary_paths = (
            _nested_paths(summary_model, prefix=name)
            if summary_model is not None
            else set()
        )
        differences.update(detailed_paths ^ summary_paths)
    return differences


def _bq_message(
    activity: DetailedStravaActivity | SummaryStravaActivity,
) -> bq_activities_pb2.Activity:
    message = bq_activities_pb2.Activity()
    _populate_message(message, BigQueryStorageWriter._dump_for_bq(activity))
    return message


def test_manifest_shape_and_dispositions_are_valid():
    contract = _contract()
    assert contract["version"] == 1
    assert contract["fields"]
    assert contract["nested_differences"]
    assert set(contract["system_columns"]) == {"created_at", "updated_at"}

    for path, disposition in {
        **contract["fields"],
        **contract["nested_differences"],
    }.items():
        assert disposition["detailed"] in _AVAILABILITY, path
        assert disposition["summary"] in _AVAILABILITY, path
        postgres_mappings = disposition["postgres"]
        if isinstance(postgres_mappings, dict):
            postgres_mappings = [postgres_mappings]
        assert postgres_mappings, path
        for mapping in postgres_mappings:
            assert mapping["kind"] in _POSTGRES_KINDS, path
            if mapping["kind"] != "not_persisted":
                assert mapping.get("target"), path
                assert (
                    mapping.get("attribute") or path in contract["nested_differences"]
                ), path

        bigquery = disposition["bigquery"]
        assert bigquery["kind"] in _BIGQUERY_KINDS, path
        if bigquery["kind"] == "column":
            assert bigquery.get("target"), path

        assert disposition["live"] in _LIVE_ACTIONS, path
        assert disposition["backfill"] in _BACKFILL_ACTIONS, path

        needs_reason = (
            disposition["detailed"] == "unavailable"
            or disposition["summary"] == "unavailable"
            or any(mapping["kind"] != "column" for mapping in postgres_mappings)
            or bigquery["kind"] != "column"
            or disposition["live"]
            not in {"create_write", "create_write_and_enriched_pg_upsert"}
            or disposition["backfill"] != "write"
        )
        if needs_reason:
            assert disposition.get("reason"), path


def test_manifest_covers_every_source_and_destination_field():
    contract_fields = set(_contract()["fields"])
    detailed_fields = set(DetailedStravaActivity.model_fields)
    summary_fields = set(SummaryStravaActivity.model_fields)
    postgres_fields = set(StandardActivity.model_fields)
    bigquery_fields = {
        field.name for field in bq_activities_pb2.Activity.DESCRIPTOR.fields
    }
    expected = detailed_fields | summary_fields | postgres_fields | bigquery_fields

    assert contract_fields == expected, (
        "Persisted activity contract field inventory drifted.\n"
        f"Missing dispositions: {sorted(expected - contract_fields)}\n"
        f"Stale dispositions: {sorted(contract_fields - expected)}"
    )


def test_manifest_source_availability_matches_pydantic_models():
    fields = _contract()["fields"]
    detailed_fields = set(DetailedStravaActivity.model_fields)
    summary_fields = set(SummaryStravaActivity.model_fields)

    for name, disposition in fields.items():
        assert (disposition["detailed"] == "available") == (name in detailed_fields), (
            name
        )
        assert (disposition["summary"] == "available") == (name in summary_fields), name

    expected_nested = _source_nested_differences()
    actual_nested = set(_contract()["nested_differences"])
    assert actual_nested == expected_nested, (
        "Detailed/summary nested shape drifted.\n"
        f"Missing dispositions: {sorted(expected_nested - actual_nested)}\n"
        f"Stale dispositions: {sorted(actual_nested - expected_nested)}"
    )


def test_postgres_contract_matches_model_and_repository_mapping():
    contract = _contract()
    standard_fields = set(StandardActivity.model_fields)
    for name in standard_fields:
        kinds = {mapping["kind"] for mapping in contract["fields"][name]["postgres"]}
        assert kinds != {"not_persisted"}, name

    contract_column_attributes: dict[str, str] = {}
    for disposition in contract["fields"].values():
        for mapping in disposition["postgres"]:
            if mapping["kind"] not in {"column", "derived_column"}:
                continue
            column = mapping["target"].rsplit(".", maxsplit=1)[-1]
            contract_column_attributes[column] = mapping["attribute"]

    assert contract_column_attributes == _ACTIVITY_COLUMN_ATTRIBUTES
    assert tuple(contract["system_columns"]) == _ACTIVITY_SYSTEM_COLUMNS
    assert (
        *_ACTIVITY_COLUMN_ATTRIBUTES,
        *_ACTIVITY_SYSTEM_COLUMNS,
    ) == _ACTIVITY_COLUMNS

    summary = SummaryStravaActivity.model_validate(_fixture("activity_1.json"))
    standard = StandardActivity.model_validate(summary, from_attributes=True)
    now = datetime(2026, 7, 24, tzinfo=UTC)
    params = _activity_write_params(standard, now)
    assert tuple(params) == _ACTIVITY_COLUMNS
    assert params["created_at"] is now
    assert params["updated_at"] is now


def test_bigquery_contract_matches_descriptor_and_summary_exclusions():
    contract_fields = _contract()["fields"]
    descriptor_fields = {
        field.name for field in bq_activities_pb2.Activity.DESCRIPTOR.fields
    }

    for name in descriptor_fields:
        bigquery = contract_fields[name]["bigquery"]
        assert bigquery == {"kind": "column", "target": name}, name

    exclusions = {
        name
        for name, disposition in contract_fields.items()
        if disposition["bigquery"]["kind"] == "excluded"
    }
    assert exclusions == SummaryStravaActivity._BQ_EXCLUDE_FIELDS

    summary = SummaryStravaActivity.model_validate(_fixture("activity_1.json"))
    assert set(BigQueryStorageWriter._dump_for_bq(summary)) <= descriptor_fields


def test_detailed_and_summary_projections_land_shared_fields_equivalently():
    # One canonical raw Strava fixture feeds both source projections. The
    # summary model intentionally ignores detailed-only keys, matching a real
    # list response without maintaining a second copy of every shared value.
    raw_activity = _fixture("activity_1.json")
    detailed = DetailedStravaActivity.model_validate(raw_activity)
    summary = SummaryStravaActivity.model_validate(raw_activity)
    detailed_standard = StandardActivity.model_validate(detailed, from_attributes=True)
    summary_standard = StandardActivity.model_validate(summary, from_attributes=True)
    now = datetime(2026, 7, 24, tzinfo=UTC)

    detailed_params = _activity_write_params(detailed_standard, now)
    summary_params = _activity_write_params(summary_standard, now)
    assert detailed_params == summary_params
    assert detailed_params["trainer"] is False
    assert detailed_params["manual"] is False

    detailed_bq = _bq_message(detailed)
    summary_bq = _bq_message(summary)
    for field in (
        "id",
        "name",
        "type",
        "sport_type",
        "distance",
        "moving_time",
        "elapsed_time",
        "trainer",
        "manual",
    ):
        assert getattr(detailed_bq, field) == getattr(summary_bq, field), field


def test_detail_only_field_is_explicitly_unavailable_to_summary_backfill():
    disposition = _contract()["fields"]["hide_from_home"]
    assert disposition["detailed"] == "available"
    assert disposition["summary"] == "unavailable"
    assert disposition["live"] == "create_write"
    assert disposition["backfill"] == "leave_unavailable"

    raw_activity = _fixture("activity_1.json")
    detailed = DetailedStravaActivity.model_validate(raw_activity)
    summary = SummaryStravaActivity.model_validate(raw_activity)
    detailed_bq = _bq_message(detailed)
    summary_bq = _bq_message(summary)

    assert detailed_bq.HasField("hide_from_home")
    assert not summary_bq.HasField("hide_from_home")
