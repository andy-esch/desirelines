"""Exercise the real table declaration with synthetic state and cached providers.

No credentials, API refreshes or applies: Terraform only plans against a fake
project. Run via `just tf-test`, which initializes the module's provider cache.
"""

from collections.abc import Callable
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any
import uuid

TABLE = "google_bigquery_table.activities_live"
PROJECT = "desirelines-test"


def declaration(
    source: str, resource_type: str, name: str, *, required: bool = True
) -> str:
    # terraform fmt keeps the outer closing brace at column zero. Copy the
    # actual declaration, including lifecycle, rather than a test-only replica.
    matches = re.findall(
        rf'(?ms)^resource "{re.escape(resource_type)}" "{re.escape(name)}" \{{\n.*?^\}}',
        source,
    )
    if len(matches) > 1 or (required and not matches):
        raise AssertionError(f"Expected one formatted declaration for {name}")
    return matches[0] if matches else ""


def synthetic_state(document: dict[str, Any]) -> dict[str, Any]:
    """Use provider-planned attributes, never live state or an apply."""
    versions = {
        r["address"]: r["schema_version"]
        for r in document["planned_values"]["root_module"]["resources"]
    }
    resources = []
    for resource in document["resource_changes"]:
        attributes = resource["change"]["after"]
        if resource["type"] == "terraform_data":
            value = attributes["input"]
            attributes = {
                "id": str(uuid.uuid4()),
                "input": {"type": "string", "value": value},
                "output": {"type": "string", "value": value},
                "triggers_replace": None,
            }
            provider = 'provider["terraform.io/builtin/terraform"]'
        else:
            attributes["id"] = f"projects/{PROJECT}/datasets/desirelines" + (
                "/tables/activities_live" if resource["address"] == TABLE else ""
            )
            if "effective_labels" in attributes:
                attributes["effective_labels"] = (
                    attributes.get("terraform_labels") or attributes["labels"]
                )
            provider = 'provider["registry.terraform.io/hashicorp/google"]'
        resources.append(
            {
                "mode": "managed",
                "type": resource["type"],
                "name": resource["name"],
                "provider": provider,
                "instances": [
                    {
                        "schema_version": versions[resource["address"]],
                        "attributes": attributes,
                    }
                ],
            }
        )
    return {
        "version": 4,
        "serial": 1,
        "lineage": str(uuid.uuid4()),
        "outputs": {},
        "resources": resources,
    }


def assert_table_change(document: dict[str, Any], action: str) -> None:
    changes = document["resource_changes"]
    table_change = next(r["change"] for r in changes if r["address"] == TABLE)
    if table_change["actions"] != [action]:
        raise AssertionError(f"Expected {action}, got {table_change['actions']}")
    changed = {r["address"] for r in changes if r["change"]["actions"] != ["no-op"]}
    if changed != ({TABLE} if action == "update" else set()):
        raise AssertionError(f"Unexpected changed resources: {changed}")
    for attribute in (
        "id",
        "project",
        "dataset_id",
        "table_id",
        "table_constraints",
        "clustering",
        "deletion_protection",
    ):
        if table_change["before"][attribute] != table_change["after"][attribute]:
            raise AssertionError(f"Table {attribute} changed")


def module_inputs(module: Path) -> tuple[str, str, str]:
    """Copy the table configuration and its locked Google provider constraint."""
    source = (module / "bigquery_subscription.tf").read_text()
    table = declaration(source, "google_bigquery_table", "activities_live")
    # If a replacement trigger is reintroduced, include its real declaration so
    # a description edit exercises that dependency rather than ignoring it.
    marker = declaration(
        source, "terraform_data", "activities_live_schema", required=False
    )
    locks = re.findall(
        r'(?ms)^provider "registry[.]terraform[.]io/hashicorp/google" \{\n.*?^\}',
        (module / ".terraform.lock.hcl").read_text(),
    )
    if len(locks) != 1:
        raise AssertionError("Expected one Google provider lock entry")
    lock = locks[0]
    constraint_match = re.search(r'constraints\s*=\s*"([^"]+)"', lock)
    if constraint_match is None:
        raise AssertionError("Expected a Google provider version constraint")
    return marker + "\n" + table, lock, constraint_match.group(1)


def exercise_plans(
    plan: Callable[..., Any], schema: Path, original: dict[str, Any]
) -> None:
    assert_table_change(plan(), "no-op")
    top = copy.deepcopy(original)
    next(f for f in top["schema"] if f["name"] == "name")["description"] = (
        "Description-only lifecycle test"
    )
    schema.write_text(json.dumps(top))
    assert_table_change(plan(), "update")
    nested = copy.deepcopy(original)
    next(f for f in nested["schema"] if f.get("fields"))["fields"][0]["description"] = (
        "Nested description-only lifecycle test"
    )
    schema.write_text(json.dumps(nested))
    assert_table_change(plan(), "update")
    retyped = copy.deepcopy(original)
    next(f for f in retyped["schema"] if f["name"] == "distance")["type"] = "STRING"
    schema.write_text(json.dumps(retyped))
    plan(blocked=True)
    schema.write_text(json.dumps(original))
    plan(f"-replace={TABLE}", blocked=True)
    plan("-destroy", blocked=True)


def check_lifecycle(repository: Path) -> None:
    terraform = shutil.which("terraform")
    if terraform is None:
        raise RuntimeError("Install Terraform first")
    module = repository / "terraform/modules/desirelines"
    plugins = module / ".terraform/providers"
    if not plugins.is_dir():
        raise RuntimeError("Initialize terraform/modules/desirelines first")
    table, lock, constraint = module_inputs(module)
    original = json.loads(
        (repository / "schemas/bigquery/activities_live.json").read_text()
    )

    with tempfile.TemporaryDirectory(prefix="activity-table-lifecycle-") as temporary:
        base = Path(temporary)
        root = base / "terraform/modules/desirelines"
        root.mkdir(parents=True)
        schema = base / "schemas/bigquery/activities_live.json"
        schema.parent.mkdir(parents=True)
        schema.write_text(json.dumps(original))
        (root / ".terraform.lock.hcl").write_text(lock + "\n")
        (root / "main.tf").write_text(
            """terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
      version = "__GOOGLE_CONSTRAINT__"
    }
  }
}
provider "google" {
  project = "desirelines-test"
  access_token = "offline-plan-only"
}
variable "environment" { default = "dev" }
locals { common_labels = { environment = var.environment } }
resource "google_bigquery_dataset" "activities_dataset" {
  dataset_id = "desirelines"
  location = "US"
}
""".replace("__GOOGLE_CONSTRAINT__", constraint)
            + table
        )
        environment = dict(
            os.environ,
            TF_DATA_DIR=str(root / ".terraform"),
            TF_WORKSPACE="default",
            CHECKPOINT_DISABLE="1",
        )

        def run(*arguments: str, blocked: bool = False) -> str:
            result = subprocess.run(  # noqa: S603 — executable and flags are controlled here
                [terraform, *arguments],
                cwd=root,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
                timeout=60,
            )
            output = result.stdout + result.stderr
            if blocked:
                if (
                    not result.returncode
                    or "prevent_destroy" not in output
                    or TABLE not in output
                ):
                    raise AssertionError(
                        f"Expected table destruction to be blocked:\n{output}"
                    )
            elif result.returncode:
                raise AssertionError(output)
            return result.stdout

        run(
            "init",
            "-input=false",
            "-backend=false",
            "-lockfile=readonly",
            f"-plugin-dir={plugins}",
        )

        for name in ("dev", "prod"):
            schema.write_text(json.dumps(original))
            state_file = root / "terraform.tfstate"
            state_file.unlink(missing_ok=True)

            def plan(
                *flags: str, blocked: bool = False, environment_name: str = name
            ) -> Any:
                run(
                    "plan",
                    "-no-color",
                    "-input=false",
                    "-refresh=false",
                    f"-var=environment={environment_name}",
                    "-out=case.plan",
                    *flags,
                    blocked=blocked,
                )
                return (
                    None if blocked else json.loads(run("show", "-json", "case.plan"))
                )

            state_file.write_text(json.dumps(synthetic_state(plan())))
            exercise_plans(plan, schema, original)
            print(
                f"{name}: no-op, description/nested updates, retype/replacement/destroy protection passed",
                flush=True,
            )


if __name__ == "__main__":
    check_lifecycle(Path(__file__).resolve().parents[2])
