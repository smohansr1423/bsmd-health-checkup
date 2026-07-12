"""Unit tests for food search, barcode, and menu-OCR lookup (Task 7.4).

Covers Req 7.1, 7.2, 7.5, 7.6, 7.7, 7.8 with focused examples and edge cases.
Backends are simple in-memory fakes so the query construction, validation,
ranking, and no-match/fallback semantics are exercised without live I/O.
"""

from __future__ import annotations

from typing import Optional, Sequence

from app.food_lookup import (
    DEFAULT_SEARCH_SIZE,
    FOOD_ITEMS_INDEX,
    MAX_QUERY_LEN,
    MAX_SEARCH_SIZE,
    BarcodeSuccess,
    Fallback,
    LookupKind,
    MenuOcrSuccess,
    NoMatch,
    SearchSuccess,
    build_search_query,
    extract_menu_items,
    lookup_barcode,
    scan_menu,
    search_foods,
)
from app.result import Err, Ok


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeSearchBackend:
    """Returns preset hits and records the query body it was called with."""

    def __init__(self, hits: Sequence[dict]) -> None:
        self._hits = list(hits)
        self.last_index: Optional[str] = None
        self.last_body: Optional[dict] = None

    def search(self, index: str, body: dict) -> Sequence[dict]:
        self.last_index = index
        self.last_body = body
        return self._hits


class FakeBarcodeBackend:
    def __init__(self, table: dict[str, dict]) -> None:
        self._table = table

    def lookup(self, code: str) -> Optional[dict]:
        return self._table.get(code)


class FakeOcrBackend:
    def __init__(self, lines: Sequence[str]) -> None:
        self._lines = list(lines)

    def extract_lines(self, image: bytes) -> Sequence[str]:
        return self._lines


def _hit(food_id: str, name: str, score: float, **source) -> dict:
    return {"_id": food_id, "_score": score, "_source": {"food_id": food_id, "name": name, **source}}


# ---------------------------------------------------------------------------
# search_foods — Req 7.7, 7.8
# ---------------------------------------------------------------------------


def test_search_returns_matches_sorted_by_score() -> None:
    backend = FakeSearchBackend(
        [
            _hit("f1", "Apple", 1.2),
            _hit("f2", "Apple Pie", 3.5, brand="Grandma"),
            _hit("f3", "Applesauce", 2.1),
        ]
    )
    result = search_foods("apple", backend)
    assert isinstance(result, Ok)
    payload = result.value
    assert isinstance(payload, SearchSuccess)
    assert payload.kind is LookupKind.SEARCH
    assert [m.food_id for m in payload.matches] == ["f2", "f3", "f1"]
    assert payload.matches[0].brand == "Grandma"


def test_search_queries_food_items_index() -> None:
    backend = FakeSearchBackend([_hit("f1", "Rice", 1.0)])
    search_foods("rice", backend)
    assert backend.last_index == FOOD_ITEMS_INDEX


def test_search_empty_backend_returns_no_match_with_manual_entry_fallback() -> None:
    backend = FakeSearchBackend([])
    result = search_foods("nonexistentfood", backend)
    assert isinstance(result, Ok)
    nm = result.value
    assert isinstance(nm, NoMatch)
    assert nm.kind is LookupKind.SEARCH
    assert nm.fallback is Fallback.MANUAL_ENTRY
    assert nm.retained_state is True


def test_search_min_length_one_char_is_accepted() -> None:
    backend = FakeSearchBackend([_hit("f1", "Egg", 1.0)])
    result = search_foods("e", backend)
    assert isinstance(result, Ok)
    assert isinstance(result.value, SearchSuccess)


def test_search_max_length_100_chars_is_accepted() -> None:
    backend = FakeSearchBackend([])
    result = search_foods("a" * MAX_QUERY_LEN, backend)
    assert isinstance(result, Ok)  # no match, but valid query


def test_search_empty_string_is_validation_rejection() -> None:
    backend = FakeSearchBackend([_hit("f1", "x", 1.0)])
    result = search_foods("", backend)
    assert isinstance(result, Err)
    assert result.error.code == "SEARCH_QUERY_INVALID"
    assert result.error.retained_state is True
    assert result.error.retryable is False
    assert backend.last_body is None  # backend not consulted


def test_search_over_100_chars_is_validation_rejection() -> None:
    backend = FakeSearchBackend([])
    result = search_foods("a" * (MAX_QUERY_LEN + 1), backend)
    assert isinstance(result, Err)
    assert result.error.code == "SEARCH_QUERY_INVALID"


def test_search_whitespace_only_returns_no_match_without_backend_call() -> None:
    backend = FakeSearchBackend([_hit("f1", "x", 1.0)])
    result = search_foods("   ", backend)
    assert isinstance(result, Ok)
    assert isinstance(result.value, NoMatch)
    assert backend.last_body is None


def test_build_search_query_shape_and_size_clamp() -> None:
    body = build_search_query("cheese", size=999)
    assert body["size"] == MAX_SEARCH_SIZE
    should = body["query"]["bool"]["should"]
    # fuzzy multi_match + as-you-type prefix + popularity rank_feature
    assert any("multi_match" in clause and clause["multi_match"].get("fuzziness") == "AUTO" for clause in should)
    assert any("rank_feature" in clause for clause in should)


def test_build_search_query_default_size() -> None:
    body = build_search_query("cheese")
    assert body["size"] == DEFAULT_SEARCH_SIZE


# ---------------------------------------------------------------------------
# lookup_barcode — Req 7.1, 7.2
# ---------------------------------------------------------------------------


def test_barcode_known_code_returns_match() -> None:
    backend = FakeBarcodeBackend(
        {"0123456789012": {"food_id": "b1", "name": "Cola", "brand": "FizzCo", "nutrients": {"calories_kcal": 140}}}
    )
    result = lookup_barcode("0123456789012", backend)
    assert isinstance(result, Ok)
    payload = result.value
    assert isinstance(payload, BarcodeSuccess)
    assert payload.match.food_id == "b1"
    assert payload.match.nutrients["calories_kcal"] == 140


def test_barcode_unknown_code_returns_no_match_with_text_search_fallback() -> None:
    backend = FakeBarcodeBackend({})
    result = lookup_barcode("0123456789012", backend)
    assert isinstance(result, Ok)
    nm = result.value
    assert isinstance(nm, NoMatch)
    assert nm.kind is LookupKind.BARCODE
    assert nm.fallback is Fallback.TEXT_SEARCH
    assert nm.retained_state is True


def test_barcode_accepts_valid_symbology_lengths() -> None:
    for code in ("12345678", "123456789012", "1234567890123", "12345678901234"):
        backend = FakeBarcodeBackend({})
        result = lookup_barcode(code, backend)
        assert isinstance(result, Ok), code
        assert isinstance(result.value, NoMatch)


def test_barcode_non_numeric_is_validation_rejection() -> None:
    backend = FakeBarcodeBackend({})
    result = lookup_barcode("abc123", backend)
    assert isinstance(result, Err)
    assert result.error.code == "BARCODE_INVALID"
    assert result.error.retained_state is True


def test_barcode_wrong_length_is_validation_rejection() -> None:
    backend = FakeBarcodeBackend({})
    result = lookup_barcode("12345", backend)
    assert isinstance(result, Err)
    assert result.error.code == "BARCODE_INVALID"


# ---------------------------------------------------------------------------
# scan_menu / extract_menu_items — Req 7.5, 7.6
# ---------------------------------------------------------------------------


def test_scan_menu_extracts_selectable_items() -> None:
    backend = FakeOcrBackend(
        [
            "APPETIZERS",
            "Garlic Bread .... $5.99",
            "Caesar Salad  8,50",
            "",
            "   ",
            "Margherita Pizza $12",
        ]
    )
    result = scan_menu(b"\x89PNGfake", backend)
    assert isinstance(result, Ok)
    payload = result.value
    assert isinstance(payload, MenuOcrSuccess)
    names = [o.name for o in payload.options]
    assert names == ["APPETIZERS", "Garlic Bread", "Caesar Salad", "Margherita Pizza"]


def test_scan_menu_no_items_returns_no_match_with_text_search_fallback() -> None:
    backend = FakeOcrBackend(["$4.99", "12.50", "-----", "   "])
    result = scan_menu(b"img", backend)
    assert isinstance(result, Ok)
    nm = result.value
    assert isinstance(nm, NoMatch)
    assert nm.kind is LookupKind.MENU_OCR
    assert nm.fallback is Fallback.TEXT_SEARCH
    assert nm.retained_state is True


def test_scan_menu_empty_image_is_validation_rejection() -> None:
    backend = FakeOcrBackend(["Pizza"])
    result = scan_menu(b"", backend)
    assert isinstance(result, Err)
    assert result.error.code == "MENU_IMAGE_INVALID"


def test_extract_menu_items_dedupes_case_insensitively() -> None:
    options = extract_menu_items(["Fish Tacos", "fish tacos", "FISH TACOS $9"])
    assert [o.name for o in options] == ["Fish Tacos"]


def test_extract_menu_items_truncates_long_names() -> None:
    long_name = "x" * (MAX_QUERY_LEN + 50)
    options = extract_menu_items([long_name])
    assert len(options) == 1
    assert len(options[0].name) == MAX_QUERY_LEN
