"""Release selection, fail-closed digest validation and hosted workflow contracts."""

from __future__ import annotations

from collections.abc import Iterator
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch

from ci import image_release as release
import pytest
import yaml  # type: ignore[import-untyped]


class TestRelease:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path: Path) -> None:
        self.repo = tmp_path
        release.git(self.repo, "init", "--quiet")
        release.git(self.repo, "config", "user.email", "test@example.invalid")
        release.git(self.repo, "config", "user.name", "Release tests")
        release.git(self.repo, "config", "core.filemode", "true")
        release.git(self.repo, "config", "commit.gpgsign", "false")
        self.images = release.load_catalog()
        self.all_images = {image.name for image in self.images}
        for image in self.images:
            dockerfile = self.repo / image.context / image.dockerfile
            dockerfile.parent.mkdir(parents=True, exist_ok=True)
            dockerfile.write_text("FROM scratch\n")
        shared = self.repo / "packages/shared/shared.go"
        shared.parent.mkdir(parents=True, exist_ok=True)
        shared.write_text("package shared\n")
        self.before = self.commit()

    def commit(self) -> str:
        release.git(self.repo, "add", ".")
        release.git(self.repo, "commit", "--quiet", "--allow-empty", "-m", "fixture")
        return release.git(self.repo, "rev-parse", "HEAD").stdout.strip()

    def changed(self, after: str) -> set[str]:
        return {
            entry["image"]
            for entry in release.changed_images(
                self.repo, self.before, after, self.images
            )
        }

    def write(self, path: str, contents: str = "new input\n") -> None:
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(contents)

    def test_service_inputs_and_shared_fanout(self) -> None:
        for path, expected in [
            ("packages/dispatcher/go.mod", {"dispatcher"}),
            ("packages/apigateway/types/generated/config.pb.go", {"apigateway"}),
            ("packages/shared/shared.go", {"dispatcher", "apigateway"}),
            ("packages/stravapipe/README.md", {"stravapipe"}),
            ("packages/stravapipe/.dockerignore", {"stravapipe"}),
            ("packages/stravapipe/uv.lock", {"stravapipe"}),
            ("packages/stravapipe/src/generated_pb2.py", {"stravapipe"}),
            ("packages/web/src/App.tsx", set()),
            ("docs/guides/deployment.md", set()),
            ("schemas/proto/example.proto", set()),
            ("terraform/modules/desirelines/variables.tf", set()),
        ]:
            self.before = self.commit()
            self.write(path)
            assert self.changed(self.commit()) == expected

    def test_common_inputs_seed_all_images(self) -> None:
        for path in [
            ".github/workflows/deploy.yml",
            "scripts/ci",
            ".dockerignore",
            ".gitattributes",
            ".gitmodules",
        ]:
            self.before = self.commit()
            self.write(f"{path}/policy.json" if path == "scripts/ci" else path)
            assert self.changed(self.commit()) == self.all_images

    def test_absent_optional_input_deletion_modes_and_symlinks(self) -> None:
        # An absent root ignore file is still tracked by policy when introduced.
        self.write(".dockerignore")
        assert self.changed(self.commit()) == self.all_images
        self.before = self.commit()
        (self.repo / ".dockerignore").unlink()
        assert self.changed(self.commit()) == self.all_images
        self.before = self.commit()
        dockerfile = self.repo / "packages/dispatcher/Dockerfile"
        dockerfile.chmod(0o755)
        assert self.changed(self.commit()) == {"dispatcher"}
        self.before = self.commit()
        dockerfile.unlink()
        dockerfile.symlink_to("other.Dockerfile")
        assert self.changed(self.commit()) == {"dispatcher"}
        self.before = self.commit()
        dockerfile.unlink()
        dockerfile.symlink_to("changed.Dockerfile")
        assert self.changed(self.commit()) == {"dispatcher"}

    def test_rename_across_services_and_multi_commit_push(self) -> None:
        self.write("packages/dispatcher/new.go")
        self.commit()
        shutil.move(
            self.repo / "packages/dispatcher/new.go",
            self.repo / "packages/apigateway/new.go",
        )
        assert self.changed(self.commit()) == {"apigateway"}
        self.before = self.commit()
        shutil.move(
            self.repo / "packages/apigateway/new.go",
            self.repo / "packages/dispatcher/new.go",
        )
        assert self.changed(self.commit()) == {"dispatcher", "apigateway"}

    def test_first_push_builds_every_image_and_invalid_refs_fail(self) -> None:
        entries = release.changed_images(
            self.repo, release.ZERO_SHA, self.before, self.images
        )
        assert {entry["image"] for entry in entries} == self.all_images
        for before, after in [
            (self.before[:7], self.before),
            ("f" * 40, self.before),
            (self.before, self.before[:7]),
            (self.before, release.ZERO_SHA),
        ]:
            with pytest.raises((ValueError, subprocess.CalledProcessError)):
                release.changed_images(self.repo, before, after, self.images)

    def test_cli_outputs_full_identity_and_no_partial_outputs_on_error(self) -> None:
        output = self.repo / "outputs"
        script = Path(release.__file__).resolve()
        result = subprocess.run(
            [
                sys.executable,
                str(script),
                "matrix",
                "--before",
                release.ZERO_SHA,
                "--after",
                self.before,
                "--github-output",
                str(output),
            ],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert f"git_sha={self.before}\n" in output.read_text()
        assert "any=true\n" in output.read_text()
        output.unlink()
        for before, after in [("f" * 40, self.before), (self.before, self.before[:7])]:
            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "matrix",
                    "--before",
                    before,
                    "--after",
                    after,
                    "--github-output",
                    str(output),
                ],
                cwd=self.repo,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode != 0
            assert not output.exists()

    def test_catalog_rejects_pathspec_magic_and_uncovered_dockerfile(self) -> None:
        for path in ["../other", ":(exclude)packages", "/etc", "packages/*", "a\nb"]:
            with pytest.raises(ValueError, match="Invalid build input path"):
                release.checked_path(path)
        data = json.loads(release.CATALOG.read_text())
        data["images"]["dispatcher"]["inputs"] = ["packages/shared"]
        catalog = self.repo / "invalid.json"
        catalog.write_text(json.dumps(data))
        with pytest.raises(ValueError, match="inputs must cover its Dockerfile"):
            release.load_catalog(catalog)

    def test_empty_selection_and_checkout_mismatch(self) -> None:
        assert release.release_matrix(self.repo, self.before, self.before) == {
            "include": []
        }
        self.commit()
        with pytest.raises(ValueError, match="Checkout must match"):
            release.release_matrix(self.repo, self.before, self.before)

    def test_git_diff_errors_are_not_an_empty_selection(self) -> None:
        real_git = release.git

        def broken_diff(
            repo: Path, *args: str, check: bool = True
        ) -> subprocess.CompletedProcess[str]:
            if args[0] == "diff":
                return subprocess.CompletedProcess(args, 2, "", "unreadable object")
            return real_git(repo, *args, check=check)

        with (
            patch("ci.image_release.git", side_effect=broken_diff),
            pytest.raises(subprocess.CalledProcessError),
        ):
            release.release_matrix(self.repo, self.before, self.before)

    def test_catalog_requires_path_lists_and_supported_schema(self) -> None:
        with pytest.raises(ValueError, match="nonempty list"):
            release.checked_paths("packages/shared")
        catalog = self.repo / "invalid.json"
        catalog.write_text('{"schema_version": 2}')
        with pytest.raises(ValueError, match="Unsupported"):
            release.load_catalog(catalog)


class TestDigest:
    @pytest.fixture(autouse=True)
    def tools(self) -> Iterator[None]:
        with patch("ci.image_release.executable", return_value="/runner/gcloud"):
            yield

    image = "us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services/stravapipe"
    commit = "a" * 40
    digest = "sha256:" + "b" * 64

    def test_exact_registry_tag_and_index_digest(self) -> None:
        with patch("ci.image_release.subprocess.run") as run:
            run.return_value.stdout = self.digest + "\n"
            release.validate_pushed_digest(self.image, self.commit, self.digest)
            assert run.call_args.args[0] == [
                "/runner/gcloud",
                "artifacts",
                "docker",
                "images",
                "describe",
                f"{self.image}:{self.commit}",
                "--format=value(image_summary.digest)",
            ]
            assert run.call_args.kwargs["check"]

    def test_empty_malformed_or_platform_digest_is_rejected(self) -> None:
        for output in ["", "sha256:short", "sha256:" + "c" * 64]:
            with patch("ci.image_release.subprocess.run") as run:
                run.return_value.stdout = output
                with pytest.raises(ValueError, match="Registry commit tag"):
                    release.validate_pushed_digest(self.image, self.commit, self.digest)
        for build in ["", "sha256:short", "sha256:" + "B" * 64]:
            with patch("ci.image_release.subprocess.run") as run:
                with pytest.raises(ValueError, match="Build output"):
                    release.validate_pushed_digest(self.image, self.commit, build)
                run.assert_not_called()

    def test_registry_errors_never_fall_back(self) -> None:
        for status in [1, 2, 127]:
            with patch("ci.image_release.subprocess.run") as run:
                run.side_effect = subprocess.CalledProcessError(status, "gcloud")
                with pytest.raises(subprocess.CalledProcessError):
                    release.validate_pushed_digest(self.image, self.commit, self.digest)

    def test_short_commit_and_tagged_subject_are_rejected_before_lookup(self) -> None:
        for image, commit, message in [
            (self.image, self.commit[:7], "full commit SHA"),
            (self.image, release.ZERO_SHA, "full commit SHA"),
            (f"{self.image}:latest", self.commit, "fully qualified"),
            (f"{self.image}@{self.digest}", self.commit, "fully qualified"),
        ]:
            with (
                patch("ci.image_release.subprocess.run") as run,
                pytest.raises(ValueError, match=message),
            ):
                release.validate_pushed_digest(image, commit, self.digest)
            run.assert_not_called()

    def test_cli_propagates_registry_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stub = Path(directory) / "gcloud"
            stub.write_text("#!/bin/sh\nexit 23\n")
            stub.chmod(0o755)
            result = subprocess.run(
                [
                    sys.executable,
                    release.__file__,
                    "validate-digest",
                    "--image",
                    self.image,
                    "--commit",
                    self.commit,
                    "--digest",
                    self.digest,
                ],
                env={**os.environ, "PATH": f"{directory}:{os.environ.get('PATH', '')}"},
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode != 0
            assert "Verified" not in result.stdout


class TestWorkflow:
    @pytest.fixture(autouse=True)
    def setup(self) -> None:
        self.workflow = yaml.safe_load(Path(".github/workflows/deploy.yml").read_text())
        self.jobs = self.workflow["jobs"]

    def test_build_attests_validated_digest_from_exact_source(self) -> None:
        build = self.jobs["build-images"]
        steps = build["steps"]
        push = next(step for step in steps if step.get("id") == "build")
        validation = next(
            step for step in steps if step["name"] == "Validate pushed image digest"
        )
        attest = next(step for step in steps if step["name"] == "Attest release image")
        assert steps.index(push) < steps.index(validation)
        assert steps.index(validation) < steps.index(attest)
        for step in [push, validation, attest]:
            assert "continue-on-error" not in step
            assert "if" not in step
        assert (
            push["with"]["context"]
            == "${{ github.server_url }}/${{ github.repository }}.git#"
            "${{ needs.changes.outputs.git_sha }}${{ matrix.context_suffix }}"
        )
        assert push["with"]["push"]
        assert push["with"]["platforms"] == "linux/amd64"
        assert validation["env"]["BUILD_DIGEST"] == "${{ steps.build.outputs.digest }}"
        assert '--digest "$BUILD_DIGEST"' in validation["run"]
        assert attest["uses"] == "actions/attest@v4"
        assert attest["with"]["subject-digest"] == "${{ steps.build.outputs.digest }}"
        assert attest["with"]["subject-name"] == validation["env"]["IMAGE"]
        assert build["permissions"] == {
            "contents": "read",
            "id-token": "write",
            "attestations": "write",
        }

    def test_dispatch_requires_all_builds_or_explicitly_empty_selection(self) -> None:
        condition = " ".join(self.jobs["trigger-deploy"]["if"].split())
        assert (
            condition == "!cancelled() && needs.changes.result == 'success' && "
            "(needs.build-images.result == 'success' || "
            "(needs.build-images.result == 'skipped' && needs.changes.outputs.any == 'false'))"
        )
        dispatch = self.jobs["trigger-deploy"]["steps"][1]["run"]
        assert (
            "client_payload[image_tag]=${{ needs.changes.outputs.git_sha }}" in dispatch
        )

    def test_readme_pushes_are_not_globally_excluded(self) -> None:
        # PyYAML's YAML 1.1 loader represents the key `on` as True.
        push = self.workflow[True]["push"]
        assert "paths-ignore" not in push
        assert push["branches"] == ["main"]
        images = release.load_catalog()
        assert {image.name for image in images} == {
            "dispatcher",
            "apigateway",
            "stravapipe",
        }
        python = next(image for image in images if image.name == "stravapipe")
        assert python.matrix_entry()["context_suffix"] == ":packages/stravapipe"
        assert python.dockerfile == "Dockerfile"
