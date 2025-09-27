from collections.abc import Callable
from typing import TypeVar

from aggregator.domain import StravaTokenSet

T = TypeVar("T")

Supplier = Callable[[], T]
OneArgSupplier = Callable[[StravaTokenSet], T]
