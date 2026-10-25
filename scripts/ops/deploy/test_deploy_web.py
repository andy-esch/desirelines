"""Execute the deployment script with fixture-only CLIs; never contact Firebase."""

import os
from pathlib import Path
import shutil
import subprocess

import pytest


@pytest.mark.parametrize("hosting_only", [False, True])
def test_deploy_targets(tmp_path: Path, hosting_only: bool) -> None:
    root = tmp_path / "repo"
    scripts = root / "scripts/ops/deploy"
    scripts.mkdir(parents=True)
    source = Path(__file__).with_name("deploy-web.sh")
    script = scripts / source.name
    shutil.copyfile(source, script)
    web = root / "packages/web"
    web.mkdir(parents=True)
    (web / "package.json").write_text("{}")
    binaries = tmp_path / "bin"
    binaries.mkdir()
    log = tmp_path / "firebase.log"
    stubs = {
        "firebase": '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_FIREBASE_LOG"\n',
        "npm": "#!/bin/sh\nmkdir -p build\n",
        "infisical": "#!/bin/sh\nexit 0\n",
    }
    for name, content in stubs.items():
        command = binaries / name
        command.write_text(content)
        command.chmod(0o755)
    environment = os.environ | {
        "PATH": f"{binaries}:{os.defpath}",
        "TEST_FIREBASE_LOG": str(log),
    }
    args = ["/bin/bash", str(script), "local"]
    if hosting_only:
        args.append("--hosting-only")
    subprocess.run(args, env=environment, check=True, capture_output=True, text=True)
    deploys = [
        line for line in log.read_text().splitlines() if line.startswith("deploy ")
    ]
    target = "hosting" if hosting_only else "hosting,firestore:rules"
    assert deploys == [f"deploy --only {target} --project desirelines-local"]


def test_unknown_option_refuses_before_any_deploy() -> None:
    script = Path(__file__).with_name("deploy-web.sh")
    result = subprocess.run(
        ["/bin/bash", str(script), "local", "--unknown"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "unknown option" in result.stdout
