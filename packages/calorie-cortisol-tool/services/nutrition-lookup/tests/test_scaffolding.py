"""Scaffolding smoke test: verify the pytest + Hypothesis toolchain is wired.

Design correctness properties (e.g. Property 11, 12) are implemented in later
tasks.
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from app import PACKAGE_NAME


def test_package_name() -> None:
    assert PACKAGE_NAME == "nutrition-lookup"


@settings(max_examples=100)
@given(st.floats(min_value=0, max_value=1e6, allow_nan=False, allow_infinity=False))
def test_hypothesis_toolchain_runs(value: float) -> None:
    assert value >= 0
