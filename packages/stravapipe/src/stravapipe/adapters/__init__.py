"""Adapters package with shared types."""

from collections.abc import Callable
from typing import TypeVar

from stravapipe.domain import StravaTokenSet

T = TypeVar("T")

Supplier = Callable[[], T]
OneArgSupplier = Callable[[StravaTokenSet], T]

__all__ = ["Supplier", "OneArgSupplier"]
