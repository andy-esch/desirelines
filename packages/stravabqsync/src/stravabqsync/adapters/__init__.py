from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

Supplier = Callable[[], T]
