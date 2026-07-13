"""Scaffolding smoke test: verify the pytest + Hypothesis toolchain is wired.

Design correctness properties (e.g. Property 33..41) are implemented in later
tasks.
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from app import PACKAGE_NAME


def test_package_name() -> None:
    assert PACKAGE_NAME == "insights-ml"


@settings(max_examples=10)
@given(st.floats(min_value=-1.0, max_value=1.0, allow_nan=False, allow_infinity=False))
def test_hypothesis_toolchain_runs(coefficient: float) -> None:
    assert -1.0 <= coefficient <= 1.0
