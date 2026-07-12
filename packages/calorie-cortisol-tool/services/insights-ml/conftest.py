"""Pytest bootstrap for the Insights & ML Service.

Ensures the shared Python contracts package (``cc_contracts``) is importable
when the suite is run without a Poetry-managed editable install (e.g. plain
``pytest`` in a bare environment). Under ``poetry run pytest`` the path
dependency declared in ``pyproject.toml`` already installs it, and this fallback
is a harmless no-op.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SHARED_PYTHON = Path(__file__).resolve().parents[2] / "shared" / "python"

if _SHARED_PYTHON.is_dir():
    shared_str = str(_SHARED_PYTHON)
    if shared_str not in sys.path:
        sys.path.insert(0, shared_str)
