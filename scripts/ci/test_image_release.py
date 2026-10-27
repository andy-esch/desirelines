"""Release selection, fail-closed digest validation and hosted workflow contracts."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
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


def successful_history(commit: str) -> dict[str, object]:
    return {
        "total_count": 1,
        "workflow_runs": [
            {
                "head_sha": commit,
                "head_branch": "main",
                "event": "push",
                "status": "completed",
                "conclusion": "success",
            }
        ],
    }


class TestIdentityRequirements:
    @pytest.fixture
    def declaration(self, tmp_path: Path) -> Path:
        file = tmp_path / "identity-rollout.json"
        file.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "requires_bootstrap": {
                        "dispatcher": False,
                        "apigateway": True,
                        "stravapipe": False,
                    },
                }
            )
        )
        return file

    def test_per_image_requirement_and_catalog_coverage(
        self, declaration: Path
    ) -> None:
        images = release.load_catalog()
        assert release.identity_requirements(images, declaration) == {
            "dispatcher": False,
            "apigateway": True,
            "stravapipe": False,
        }
        for image in images:
            assert any(
                item == "scripts/ci/identity-rollout.json"
                or "scripts/ci/identity-rollout.json".startswith(f"{item}/")
                for item in image.inputs
            )

    @pytest.mark.parametrize(
        "data",
        [
            None,
            {},
            {"schema_version": True, "requires_bootstrap": {}},
            {"schema_version": 2, "requires_bootstrap": {}},
            {"schema_version": 1, "requires_bootstrap": []},
            {"schema_version": 1, "requires_bootstrap": {"apigateway": True}},
            {
                "schema_version": 1,
                "requires_bootstrap": {
                    "dispatcher": False,
                    "apigateway": 1,
                    "stravapipe": False,
                },
            },
            {"schema_version": 1, "requires_bootstrap": {}, "future": True},
        ],
    )
    def test_rejects_ambiguous_declarations(
        self, declaration: Path, data: object
    ) -> None:
        declaration.write_text(json.dumps(data))
        with pytest.raises(ValueError, match="Unsupported identity rollout"):
            release.identity_requirements(release.load_catalog(), declaration)

    @pytest.mark.parametrize("kind", ["missing", "symlink", "oversized", "invalid"])
    def test_requires_regular_json(self, declaration: Path, kind: str) -> None:
        if kind == "missing":
            declaration.unlink()
        elif kind == "symlink":
            target = declaration.with_name("target.json")
            declaration.rename(target)
            declaration.symlink_to(target)
        elif kind == "oversized":
            declaration.write_text(" " * 4097)
        else:
            declaration.write_text("not JSON")
        with pytest.raises(ValueError, match=r"small regular file|Expecting value"):
            release.identity_requirements(release.load_catalog(), declaration)


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

    def hosted_matrix(
        self, target: str, history: object, *, api_status: int = 0
    ) -> subprocess.CompletedProcess[str]:
        tools = self.repo / "tools"
        tools.mkdir(exist_ok=True)
        response = tools / "history.json"
        response.write_text(
            history if isinstance(history, str) else json.dumps(history)
        )
        stub = tools / "gh"
        stub.write_text(
            f"#!/bin/sh\nexit {api_status}\n"
            if api_status
            else '#!/bin/sh\ncat "$RELEASE_TEST_HISTORY"\n'
        )
        stub.chmod(0o755)
        return subprocess.run(
            [
                sys.executable,
                release.__file__,
                "matrix",
                "--repository",
                "owner/repository",
                "--after",
                target,
                "--github-output",
                str(self.repo / "outputs"),
            ],
            cwd=self.repo,
            env={
                **os.environ,
                "PATH": f"{tools}:{os.environ.get('PATH', '')}",
                "RELEASE_TEST_HISTORY": str(response),
            },
            capture_output=True,
            text=True,
            check=False,
        )

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
            "scripts/ci/identity-rollout.json",
            ".dockerignore",
            ".gitattributes",
            ".gitmodules",
        ]:
            self.before = self.commit()
            self.write(f"{path}/policy.json" if path == "scripts/ci" else path)
            assert self.changed(self.commit()) == self.all_images

    def test_identity_input_cannot_be_omitted_by_catalog(self) -> None:
        data = json.loads(release.CATALOG.read_text())
        data["common_inputs"].remove("scripts/ci")
        catalog = self.repo / "catalog.json"
        catalog.write_text(json.dumps(data))
        self.images = release.load_catalog(catalog)
        self.before = self.commit()
        self.write("scripts/ci/identity-rollout.json")
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
        self.write("packages/dispatcher/other.Dockerfile", "FROM scratch\n")
        dockerfile.symlink_to("other.Dockerfile")
        assert self.changed(self.commit()) == {"dispatcher"}
        self.before = self.commit()
        dockerfile.unlink()
        self.write("packages/dispatcher/changed.Dockerfile", "FROM scratch\n")
        dockerfile.symlink_to("changed.Dockerfile")
        assert self.changed(self.commit()) == {"dispatcher"}

    @pytest.mark.parametrize("kind", ["file", "chain", "directory"])
    def test_uncataloged_symlink_targets_fail_even_without_a_link_change(
        self, kind: str
    ) -> None:
        self.write("module-manifests/dispatcher.mod", "module original\n")
        service = self.repo / "packages/dispatcher"
        if kind == "chain":
            (service / "alias.mod").symlink_to("../../module-manifests/dispatcher.mod")
            (service / "go.mod").symlink_to("alias.mod")
        elif kind == "directory":
            (service / "modules").symlink_to("../../module-manifests")
        else:
            (service / "go.mod").symlink_to("../../module-manifests/dispatcher.mod")
        self.before = self.commit()
        self.write("module-manifests/dispatcher.mod", "module changed\n")
        after = self.commit()
        with pytest.raises(
            ValueError, match=r"symlink input .*outside cataloged inputs"
        ):
            self.changed(after)
        with pytest.raises(
            ValueError, match=r"symlink input .*outside cataloged inputs"
        ):
            release.changed_images(self.repo, release.ZERO_SHA, after, self.images)

    def test_covered_symlink_targets_select_the_affected_image(self) -> None:
        self.write("module-manifests/dispatcher.mod", "module original\n")
        (self.repo / "packages/dispatcher/go.mod").symlink_to(
            "../../module-manifests/dispatcher.mod"
        )
        self.images = [
            replace(image, inputs=[*image.inputs, "module-manifests"])
            if image.name == "dispatcher"
            else image
            for image in self.images
        ]
        self.before = self.commit()
        self.write("docs/unrelated.md")
        assert self.changed(self.commit()) == set()
        self.write("module-manifests/dispatcher.mod", "module changed\n")
        assert self.changed(self.commit()) == {"dispatcher"}

    @pytest.mark.parametrize("target", ["missing.mod", "inner/../Dockerfile"])
    def test_ambiguous_or_untracked_symlink_targets_are_unsupported(
        self, target: str
    ) -> None:
        (self.repo / "packages/dispatcher/go.mod").symlink_to(target)
        with pytest.raises(ValueError, match="direct tracked path"):
            self.changed(self.commit())

    def test_repairing_an_old_unsupported_symlink_can_build(self) -> None:
        self.write("module-manifests/dispatcher.mod", "module original\n")
        module = self.repo / "packages/dispatcher/go.mod"
        module.symlink_to("../../module-manifests/dispatcher.mod")
        self.before = self.commit()
        module.unlink()
        module.write_text("module original\n")
        assert self.changed(self.commit()) == {"dispatcher"}

    def test_opaque_gitlink_build_inputs_are_unsupported(self) -> None:
        module = self.repo / "packages/dispatcher/vendor"
        module.mkdir()
        release.git(module, "init", "--quiet")
        release.git(module, "config", "user.email", "test@example.invalid")
        release.git(module, "config", "user.name", "Test")
        release.git(
            module,
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "fixture",
        )
        with pytest.raises(ValueError, match="Gitlink build inputs"):
            self.changed(self.commit())

    def test_absolute_symlink_input_is_unsupported(self) -> None:
        (self.repo / "packages/dispatcher/go.mod").symlink_to(
            "/packages/shared/shared.go"
        )
        with pytest.raises(
            ValueError, match=r"symlink input .*outside cataloged inputs"
        ):
            self.changed(self.commit())

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

    def test_docs_push_after_unpublished_service_change_rebuilds_service(self) -> None:
        last_published = self.before
        self.write("packages/stravapipe/src/writer.py")
        missed = self.commit()  # Its build failed or never left the concurrency queue.
        self.write("docs/release.md")
        target = self.commit()
        # Old filtering reproduces the gap: a successful empty selection.
        assert release.changed_images(self.repo, missed, target, self.images) == []
        result = self.hosted_matrix(target, successful_history(last_published))
        assert result.returncode == 0, result.stderr
        assert {entry["image"] for entry in json.loads(result.stdout)["include"]} == {
            "stravapipe"
        }
        output = (self.repo / "outputs").read_text()
        assert f"git_sha={target}\n" in output
        assert "any=true\n" in output

    def test_no_successful_history_builds_all_images(self) -> None:
        result = self.hosted_matrix(
            self.before, {"total_count": 0, "workflow_runs": []}
        )
        assert result.returncode == 0, result.stderr
        assert {
            entry["image"] for entry in json.loads(result.stdout)["include"]
        } == self.all_images

    def test_docs_after_successful_release_can_skip_builds(self) -> None:
        self.write("docs/release.md")
        target = self.commit()
        result = self.hosted_matrix(target, successful_history(self.before))
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout) == {"include": []}
        assert "any=false\n" in (self.repo / "outputs").read_text()

    @pytest.mark.parametrize(
        ("history", "api_status"),
        [
            ({"total_count": 0, "workflow_runs": []}, 23),
            ("not JSON", 0),
            ({"total_count": 1, "workflow_runs": []}, 0),
            (
                successful_history("f" * 40),
                0,
            ),  # Missing local history cannot skip builds.
        ],
    )
    def test_hosted_checkpoint_errors_publish_no_outputs(
        self, history: object, api_status: int
    ) -> None:
        result = self.hosted_matrix(self.before, history, api_status=api_status)
        assert result.returncode != 0
        assert not (self.repo / "outputs").exists()
        assert not result.stdout

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


class TestCheckpoint:
    def test_reads_only_successful_main_pushes(self) -> None:
        with (
            patch("ci.image_release.executable", return_value="/runner/gh"),
            patch("ci.image_release.subprocess.run") as run,
        ):
            run.return_value.stdout = json.dumps(successful_history("a" * 40))
            assert release.last_successful_release("owner/repository") == "a" * 40
            assert run.call_args.args[0] == [
                "/runner/gh",
                "api",
                "--method",
                "GET",
                "repos/owner/repository/actions/workflows/deploy.yml/runs",
                "-f",
                "branch=main",
                "-f",
                "event=push",
                "-f",
                "status=success",
                "-f",
                "per_page=1",
            ]
            assert run.call_args.kwargs["check"]

    def test_wrong_workflow_run_identity_is_rejected(self) -> None:
        for field, value in [
            ("head_branch", "feature"),
            ("event", "pull_request"),
            ("status", "in_progress"),
            ("conclusion", "failure"),
            ("head_sha", "a" * 7),
            ("head_sha", release.ZERO_SHA),
            ("head_sha", None),
        ]:
            history = successful_history("a" * 40)
            runs = history["workflow_runs"]
            assert isinstance(runs, list)
            runs[0][field] = value
            with (
                patch("ci.image_release.executable", return_value="/runner/gh"),
                patch("ci.image_release.subprocess.run") as run,
            ):
                run.return_value.stdout = json.dumps(history)
                with pytest.raises(
                    ValueError, match="Invalid successful release checkpoint"
                ):
                    release.last_successful_release("owner/repository")

    def test_malformed_history_and_repository_are_rejected(self) -> None:
        for history in [[], {}, {"workflow_runs": None}, {"workflow_runs": []}]:
            with (
                patch("ci.image_release.executable", return_value="/runner/gh"),
                patch("ci.image_release.subprocess.run") as run,
            ):
                run.return_value.stdout = json.dumps(history)
                with pytest.raises(
                    (TypeError, ValueError), match="release workflow history"
                ):
                    release.last_successful_release("owner/repository")
        with patch("ci.image_release.subprocess.run") as run:
            for repository in [
                "repo",
                "owner/repo/extra",
                "owner/repo?event=pull_request",
            ]:
                with pytest.raises(ValueError, match="owner/repository"):
                    release.last_successful_release(repository)
            run.assert_not_called()


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

    def test_selection_uses_release_history_with_read_only_token(self) -> None:
        job = self.jobs["changes"]
        step = next(step for step in job["steps"] if step.get("id") == "set-matrix")
        assert job["permissions"] == {"contents": "read", "actions": "read"}
        assert step["env"]["GH_TOKEN"] == "${{ github.token }}"
        assert '--repository "$GITHUB_REPOSITORY"' in step["run"]
        assert "--before" not in step["run"]
        assert "github.event.before" not in json.dumps(job)
        checkout = job["steps"][0]
        assert checkout["with"]["fetch-depth"] == 0

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
