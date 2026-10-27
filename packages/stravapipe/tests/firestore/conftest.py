"""Loopback-only, anonymous SDK fixtures for registry integration tests."""

from collections.abc import Iterator
import os
from uuid import uuid4

# google-auth is provided by the explicit Firestore requirement in BUILD.
from google.auth.credentials import AnonymousCredentials  # pants: no-infer-dep
from google.cloud.firestore_v1 import Client
import pytest


@pytest.fixture
def client() -> Iterator[Client]:
    host = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
    if not host:
        if os.environ.get("CI") == "true":
            pytest.fail("FIRESTORE_EMULATOR_HOST required in CI")
        pytest.skip("Firestore emulator required; never create a live client")
    assert host.startswith(("127.0.0.1:", "localhost:")), (
        "tests require a loopback emulator"
    )
    db = Client(
        project="demo-test-project",
        database=f"registry-python-{uuid4().hex}",
        credentials=AnonymousCredentials(),
    )
    yield db
    db.close()
