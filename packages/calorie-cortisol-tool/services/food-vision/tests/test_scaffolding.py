"""Scaffolding smoke test: verify the pytest + Hypothesis toolchain is wired.

Design correctness properties (e.g. Property 6..10, 60) are implemented in
later tasks.
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from app import PACKAGE_NAME


def test_package_name() -> None:
    assert PACKAGE_NAME == "food-vision"


@settings(max_examples=10)
@given(st.integers(min_value=0, max_value=100))
def test_hypothesis_toolchain_runs(confidence: int) -> None:
    assert 0 <= confidence <= 100
