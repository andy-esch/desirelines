"""Select release builds from Git inputs and validate the pushed OCI digest.

Only stdlib is needed on the hosted runner. The catalog deliberately compares
whole service trees, including committed generated files and Docker ignore
rules. Git diff observes deletions, file modes and symlinks, not just contents.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from typing import Any

CATALOG = Path(__file__).with_name("image-build-inputs.json")
FULL_SHA = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
ZERO_SHA = "0" * 40


@dataclass(frozen=True)
class ImageBuild:
    name: str
    context: str
    dockerfile: str
    inputs: list[str]

    def matrix_entry(self) -> dict[str, str]:
        return {
            "image": self.name,
            "context_suffix": "" if self.context == "." else f":{self.context}",
            "dockerfile": self.dockerfile,
        }


def checked_path(value: Any) -> str:
    """Accept literal repository-relative paths, never Git pathspec magic."""
    if (
        not isinstance(value, str)
        or not value
        or value.startswith("/")
        or any(part in {".", ".."} for part in value.split("/"))
        or any(char in value for char in ":*?[]\\\n\r")
    ):
        raise ValueError(f"Invalid build input path: {value!r}")
    return value


def checked_paths(value: Any) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError("Build inputs must be a nonempty list of literal paths")
    return [checked_path(item) for item in value]


def load_catalog(path: Path = CATALOG) -> list[ImageBuild]:
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ValueError("Unsupported image build input schema")
    common = checked_paths(data["common_inputs"])
    if not isinstance(data["images"], dict) or not data["images"]:
        raise ValueError("Build input catalog must contain images")
    images = []
    for name, spec in data["images"].items():
        if not re.fullmatch(r"[a-z][a-z0-9-]*", name):
            raise ValueError(f"Invalid image name: {name!r}")
        context = spec["context"]
        if context != ".":
            context = checked_path(context)
        dockerfile = checked_path(spec["dockerfile"])
        inputs = checked_paths(spec["inputs"])
        dockerfile_path = str(PurePosixPath(context) / dockerfile)
        if not any(
            dockerfile_path == item or dockerfile_path.startswith(f"{item}/")
            for item in inputs
        ):
            raise ValueError(f"{name}: inputs must cover its Dockerfile")
        images.append(ImageBuild(name, context, dockerfile, common + inputs))
    return images


def executable(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise FileNotFoundError(f"Required release tool not found: {name}")
    return path


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    # Commands are fixed by callers; full SHAs and literal input paths are validated.
    return subprocess.run(  # noqa: S603
        [executable("git"), "-C", str(repo), *args],
        text=True,
        capture_output=True,
        check=check,
    )


def checked_commit(repo: Path, value: str) -> str:
    if not FULL_SHA.fullmatch(value) or value == ZERO_SHA:
        raise ValueError("Release source must be a full 40-character commit SHA")
    resolved = git(repo, "rev-parse", "--verify", f"{value}^{{commit}}").stdout.strip()
    if resolved != value:
        raise ValueError("Release source does not resolve to the requested commit")
    return resolved


def last_successful_release(repository: str) -> str:
    """Keep changes from failed/replaced runs in the next build selection.

    This is a producer checkpoint, not an attestation or a deployed-version proof.
    A whole-workflow success includes every selected build and its dispatch.
    """
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Expected a GitHub owner/repository")
    # Fixed read-only API endpoint; repository is validated, no shell is invoked.
    result = subprocess.run(  # noqa: S603
        [
            executable("gh"),
            "api",
            "--method",
            "GET",
            f"repos/{repository}/actions/workflows/deploy.yml/runs",
            "-f",
            "branch=main",
            "-f",
            "event=push",
            "-f",
            "status=success",
            "-f",
            "per_page=1",
        ],
        text=True,
        capture_output=True,
        check=True,
    )
    data = json.loads(result.stdout)
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise TypeError("Invalid release workflow history")
    runs = data["workflow_runs"]
    if not runs:
        if data.get("total_count") != 0:
            raise ValueError("Incomplete release workflow history")
        # First release: build all services instead of trusting a push delta.
        return ZERO_SHA
    run = runs[0]
    head_sha = run.get("head_sha") if isinstance(run, dict) else None
    if (
        not isinstance(run, dict)
        or run.get("head_branch") != "main"
        or run.get("event") != "push"
        or run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or not isinstance(head_sha, str)
        or not FULL_SHA.fullmatch(head_sha)
        or head_sha == ZERO_SHA
    ):
        raise ValueError("Invalid successful release checkpoint")
    return head_sha


def changed_images(
    repo: Path, before: str, after: str, images: list[ImageBuild]
) -> list[dict[str, str]]:
    checked_commit(repo, after)
    if before == ZERO_SHA:
        return [image.matrix_entry() for image in images]
    checked_commit(repo, before)
    changed = []
    for image in images:
        result = git(
            repo,
            "diff",
            "--quiet",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--ignore-submodules=none",
            before,
            after,
            "--",
            *image.inputs,
            check=False,
        )
        if result.returncode == 1:
            changed.append(image.matrix_entry())
        elif result.returncode != 0:
            raise subprocess.CalledProcessError(
                result.returncode, result.args, result.stdout, result.stderr
            )
    return changed


def validate_pushed_digest(image: str, commit: str, digest: str) -> None:
    if not FULL_SHA.fullmatch(commit) or commit == ZERO_SHA:
        raise ValueError("Image tag must be a full commit SHA")
    if not DIGEST.fullmatch(digest):
        raise ValueError("Build output must contain a full sha256 OCI digest")
    if not re.fullmatch(
        r"[a-z][a-z0-9-]*-docker\.pkg\.dev/[a-z0-9-]+/[a-z0-9._-]+/[a-z][a-z0-9-]*",
        image,
    ):
        raise ValueError("Expected a fully qualified Artifact Registry image name")
    # The image, tag and digest are validated above; no shell is invoked.
    result = subprocess.run(  # noqa: S603
        [
            executable("gcloud"),
            "artifacts",
            "docker",
            "images",
            "describe",
            f"{image}:{commit}",
            "--format=value(image_summary.digest)",
        ],
        text=True,
        capture_output=True,
        check=True,
    )
    registry_digest = result.stdout.strip()
    if not DIGEST.fullmatch(registry_digest) or registry_digest != digest:
        raise ValueError("Registry commit tag does not match the pushed build digest")


def release_matrix(
    repo: Path, before: str, after: str
) -> dict[str, list[dict[str, str]]]:
    checked_commit(repo, after)
    if git(repo, "rev-parse", "HEAD").stdout.strip() != after:
        raise ValueError("Checkout must match the release source commit")
    images = load_catalog()
    include = changed_images(repo, before, after, images)
    return {"include": include}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    matrix = commands.add_parser("matrix")
    baseline = matrix.add_mutually_exclusive_group(required=True)
    baseline.add_argument("--before", help="Explicit baseline for local comparisons")
    baseline.add_argument(
        "--repository", help="GitHub repository for the hosted release checkpoint"
    )
    matrix.add_argument("--after", required=True)
    matrix.add_argument("--github-output", type=Path)
    digest = commands.add_parser("validate-digest")
    digest.add_argument("--image", required=True)
    digest.add_argument("--commit", required=True)
    digest.add_argument("--digest", required=True)
    args = parser.parse_args()
    try:
        if args.command == "validate-digest":
            validate_pushed_digest(args.image, args.commit, args.digest)
            print(f"Verified {args.image}@{args.digest}")
        else:
            before = (
                args.before
                if args.before is not None
                else last_successful_release(args.repository)
            )
            matrix_result = release_matrix(Path.cwd(), before, args.after)
            matrix_json = json.dumps(matrix_result, separators=(",", ":"))
            any_images = bool(matrix_result["include"])
            if args.github_output:
                # Publish outputs only after every comparison succeeded.
                with args.github_output.open("a") as output:
                    output.write(
                        f"git_sha={args.after}\nmatrix={matrix_json}\n"
                        f"any={str(any_images).lower()}\n"
                    )
            print(matrix_json)
    except (
        ValueError,
        KeyError,
        TypeError,
        OSError,
        subprocess.CalledProcessError,
    ) as exc:
        print(f"Release image validation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
