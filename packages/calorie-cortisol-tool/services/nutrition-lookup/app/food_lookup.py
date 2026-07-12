"""Food search, barcode, and menu-OCR lookup (Task 7.4).

Implements the three supplementary food-input lookups exposed by the Nutrition
Lookup Service (design: *Nutrition Lookup Service*):

    - ``GET /search?q=``   fuzzy food search (1-100 chars) over the 2M+ item
                           Elasticsearch index within 5s (Req 7.7).
    - ``GET /barcode/{code}``  barcode -> nutrition lookup within 5s (Req 7.1).
    - menu-OCR extraction  extract selectable menu items from a scanned menu
                           image (Req 7.5).

Every lookup that finds nothing returns a **no-match indication** that leaves
any prior entry state unchanged and offers a text-search fallback (or, for the
text search itself, a manual-entry fallback). This is the search/barcode/OCR
counterpart to the nutrition-calculation module (Task 7.1) and is kept in its
own module so the two concerns stay independently testable.

This module is **pure and dependency-injected**: it does not open a live
Elasticsearch/HTTP/OCR connection. Callers pass a backend (a small Protocol)
that performs the actual I/O; the query construction, validation, ranking, and
no-match/fallback semantics all live here so they can be verified
deterministically. The Elasticsearch query is built to match the analyzers
defined by the single-source-of-truth index mapping at
``infra/modules/elasticsearch/food-items.index.json`` (edge_ngram index
analyzer + synonym-graph search analyzer, ``rank_feature`` popularity boost).

Requirements: 7.1, 7.2, 7.5, 7.6, 7.7, 7.8
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Protocol, Sequence

from app.result import Err, Ok, err, ok, validation_rejection

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Read/search alias for the food-items index template (index_patterns
#: ``food-items-*`` in the index mapping).
FOOD_ITEMS_INDEX = "food-items"

#: Text-search query length bounds (Req 7.7: "1 to 100 characters").
MIN_QUERY_LEN = 1
MAX_QUERY_LEN = 100

#: Default and maximum number of matches returned to the client.
DEFAULT_SEARCH_SIZE = 25
MAX_SEARCH_SIZE = 50

#: Accepted barcode symbologies by digit length: EAN-8, UPC-A, EAN-13, GTIN-14.
VALID_BARCODE_LENGTHS = frozenset({8, 12, 13, 14})

#: Menu-OCR: ignore extracted item names shorter than this many letters.
MIN_MENU_ITEM_LETTERS = 2


class LookupKind(str, Enum):
    """Which supplementary lookup produced an outcome."""

    SEARCH = "textSearch"
    BARCODE = "barcode"
    MENU_OCR = "menuOCR"


class Fallback(str, Enum):
    """The fallback input method offered alongside a no-match indication."""

    #: Barcode / menu-OCR fall back to text search (Req 7.2, 7.6).
    TEXT_SEARCH = "textSearch"
    #: Text search itself falls back to a manual food entry (Req 7.8).
    MANUAL_ENTRY = "manualEntry"


# ---------------------------------------------------------------------------
# Backends (injected I/O boundaries)
# ---------------------------------------------------------------------------


class SearchBackend(Protocol):
    """Executes a query body against an Elasticsearch index and returns hits.

    Each hit is a dict shaped like an Elasticsearch response hit, i.e. with a
    numeric ``_score`` and a ``_source`` document matching the food-items
    mapping.
    """

    def search(self, index: str, body: dict) -> Sequence[dict]:
        ...


class BarcodeBackend(Protocol):
    """Resolves a barcode to a food document, or ``None`` when unknown."""

    def lookup(self, code: str) -> Optional[dict]:
        ...


class OcrBackend(Protocol):
    """Extracts raw text lines from a scanned menu image."""

    def extract_lines(self, image: bytes) -> Sequence[str]:
        ...


# ---------------------------------------------------------------------------
# Result value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FoodMatch:
    """A single food item returned from search or barcode lookup."""

    food_id: str
    name: str
    score: float
    brand: Optional[str] = None
    category: Optional[str] = None
    serving_size_g: Optional[float] = None
    nutrients: dict = field(default_factory=dict)


@dataclass(frozen=True)
class SearchSuccess:
    """One or more matching food items for a text-search query."""

    query: str
    matches: tuple[FoodMatch, ...]
    kind: LookupKind = LookupKind.SEARCH


@dataclass(frozen=True)
class BarcodeSuccess:
    """A resolved barcode -> food item."""

    code: str
    match: FoodMatch
    kind: LookupKind = LookupKind.BARCODE


@dataclass(frozen=True)
class MenuItemOption:
    """A selectable menu item extracted from a scanned menu."""

    name: str


@dataclass(frozen=True)
class MenuOcrSuccess:
    """One or more selectable items extracted from a scanned menu image."""

    options: tuple[MenuItemOption, ...]
    kind: LookupKind = LookupKind.MENU_OCR


@dataclass(frozen=True)
class NoMatch:
    """A no-match indication.

    Carries the message to display, the fallback input method to offer, and an
    explicit ``retained_state`` flag documenting that no prior entry state was
    mutated (Req 7.2, 7.6, 7.8). This is a *successful* response (wrapped in
    :class:`Ok`), distinct from a validation error.
    """

    kind: LookupKind
    message: str
    fallback: Fallback
    retained_state: bool = True


# ---------------------------------------------------------------------------
# Elasticsearch query construction (aligned to the index mapping)
# ---------------------------------------------------------------------------


def build_search_query(query: str, size: int = DEFAULT_SEARCH_SIZE) -> dict:
    """Build the Elasticsearch query body for a fuzzy food search.

    The body targets the analyzers declared in the food-items index mapping:

    - ``name`` uses an edge_ngram index analyzer + synonym-graph search
      analyzer, so a ``multi_match`` with ``fuzziness: AUTO`` gives
      typo-tolerant, prefix, and synonym matching.
    - ``name.suggest`` (``search_as_you_type``) supports as-you-type prefixes.
    - ``aliases`` and ``brand`` broaden recall.
    - the ``popularity`` ``rank_feature`` boosts common foods.

    ``size`` is clamped to ``[1, MAX_SEARCH_SIZE]``.
    """
    clamped = max(1, min(size, MAX_SEARCH_SIZE))
    return {
        "size": clamped,
        "query": {
            "bool": {
                "should": [
                    {
                        "multi_match": {
                            "query": query,
                            "type": "best_fields",
                            "fuzziness": "AUTO",
                            "fields": [
                                "name^3",
                                "aliases^2",
                                "brand",
                            ],
                        }
                    },
                    {
                        "multi_match": {
                            "query": query,
                            "type": "bool_prefix",
                            "fields": [
                                "name.suggest",
                                "name.suggest._2gram",
                                "name.suggest._3gram",
                            ],
                        }
                    },
                    {"rank_feature": {"field": "popularity", "boost": 1.0}},
                ],
                "minimum_should_match": 1,
            }
        },
    }


def _hit_to_match(hit: dict) -> FoodMatch:
    """Convert an Elasticsearch hit into a :class:`FoodMatch`."""
    source = hit.get("_source", {}) or {}
    food_id = source.get("food_id") or hit.get("_id") or ""
    return FoodMatch(
        food_id=str(food_id),
        name=str(source.get("name", "")),
        score=float(hit.get("_score", 0.0) or 0.0),
        brand=source.get("brand"),
        category=source.get("category"),
        serving_size_g=source.get("serving_size_g"),
        nutrients=dict(source.get("nutrients", {}) or {}),
    )


# ---------------------------------------------------------------------------
# GET /search?q=
# ---------------------------------------------------------------------------


def search_foods(
    query: str,
    backend: SearchBackend,
    *,
    size: int = DEFAULT_SEARCH_SIZE,
    index: str = FOOD_ITEMS_INDEX,
) -> Ok | Err:
    """Fuzzy food search over Elasticsearch (Req 7.7, 7.8).

    Behaviour:

    - The raw query length must be in ``[MIN_QUERY_LEN, MAX_QUERY_LEN]``;
      otherwise a validation rejection is returned (prior state preserved,
      not retryable as-is).
    - A query that is empty after trimming has nothing to match, so a
      :class:`NoMatch` (fallback: manual entry) is returned rather than
      hitting the backend.
    - When the backend returns hits, an :class:`Ok` of :class:`SearchSuccess`
      is returned with matches sorted by descending score.
    - When the backend returns no hits, an :class:`Ok` of :class:`NoMatch`
      (fallback: manual entry) is returned so the user can revise the query or
      create a manual entry (Req 7.8).

    Returns ``Ok[SearchSuccess] | Ok[NoMatch] | Err``.
    """
    if not isinstance(query, str) or not (MIN_QUERY_LEN <= len(query) <= MAX_QUERY_LEN):
        return err(
            validation_rejection(
                "SEARCH_QUERY_INVALID",
                f"Search query must be {MIN_QUERY_LEN}-{MAX_QUERY_LEN} characters.",
            )
        )

    if not query.strip():
        return ok(_no_search_match())

    body = build_search_query(query, size=size)
    hits = list(backend.search(index, body))
    if not hits:
        return ok(_no_search_match())

    matches = tuple(
        sorted((_hit_to_match(h) for h in hits), key=lambda m: m.score, reverse=True)
    )
    return ok(SearchSuccess(query=query, matches=matches))


def _no_search_match() -> NoMatch:
    return NoMatch(
        kind=LookupKind.SEARCH,
        message="No matching food items were found. Revise your query or create a manual entry.",
        fallback=Fallback.MANUAL_ENTRY,
    )


# ---------------------------------------------------------------------------
# GET /barcode/{code}
# ---------------------------------------------------------------------------


def _is_valid_barcode(code: str) -> bool:
    return code.isdigit() and len(code) in VALID_BARCODE_LENGTHS


def lookup_barcode(code: str, backend: BarcodeBackend) -> Ok | Err:
    """Resolve a product barcode to nutrition data (Req 7.1, 7.2).

    Behaviour:

    - A code that is not a digit string of an accepted symbology length is a
      validation rejection (prior state preserved).
    - A recognised code resolves to :class:`Ok` of :class:`BarcodeSuccess`.
    - An unknown code returns :class:`Ok` of :class:`NoMatch` (fallback: text
      search), leaving prior entry state unchanged (Req 7.2).

    Returns ``Ok[BarcodeSuccess] | Ok[NoMatch] | Err``.
    """
    if not isinstance(code, str) or not _is_valid_barcode(code):
        return err(
            validation_rejection(
                "BARCODE_INVALID",
                "Barcode must be a numeric EAN-8, UPC-A, EAN-13, or GTIN-14 code.",
            )
        )

    doc = backend.lookup(code)
    if doc is None:
        return ok(_no_barcode_match())

    return ok(BarcodeSuccess(code=code, match=_hit_to_match({"_source": doc})))


def _no_barcode_match() -> NoMatch:
    return NoMatch(
        kind=LookupKind.BARCODE,
        message="Product not found. Try searching for it by name instead.",
        fallback=Fallback.TEXT_SEARCH,
    )


# ---------------------------------------------------------------------------
# Menu-OCR extraction
# ---------------------------------------------------------------------------

#: Trailing price tokens to strip, e.g. "$12.99", "12,50", "£5", "€ 7.50".
_PRICE_RE = re.compile(
    r"""
    [\$£€]?\s*            # optional currency symbol
    \d{1,4}               # whole part
    (?:[.,]\d{1,2})?      # optional decimal part
    \s*[\$£€]?            # optional trailing currency symbol
    """,
    re.VERBOSE,
)
#: Leading list markers / dot leaders sometimes emitted by OCR.
_LEADER_RE = re.compile(r"[.\u00b7\u2022\-_]{2,}")
_LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)


def _clean_menu_line(raw: str) -> Optional[str]:
    """Normalise one OCR line into a menu-item name, or ``None`` to drop it."""
    line = _LEADER_RE.sub(" ", raw).strip()
    # Strip trailing price tokens (with any surrounding leader/whitespace).
    line = re.sub(r"\s*" + _PRICE_RE.pattern + r"\s*$", "", line, flags=re.VERBOSE).strip()
    line = re.sub(r"\s{2,}", " ", line)
    if len(_LETTER_RE.findall(line)) < MIN_MENU_ITEM_LETTERS:
        return None
    return line[:MAX_QUERY_LEN]


def extract_menu_items(lines: Sequence[str]) -> tuple[MenuItemOption, ...]:
    """Extract selectable menu items from OCR text lines (Req 7.5).

    Strips prices/leaders, drops lines without meaningful text, and dedupes
    case-insensitively while preserving first-seen order.
    """
    seen: set[str] = set()
    options: list[MenuItemOption] = []
    for raw in lines:
        if not isinstance(raw, str):
            continue
        name = _clean_menu_line(raw)
        if name is None:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        options.append(MenuItemOption(name=name))
    return tuple(options)


def scan_menu(image: bytes, backend: OcrBackend) -> Ok | Err:
    """OCR a scanned menu and return selectable items (Req 7.5, 7.6).

    Behaviour:

    - Empty image bytes are a validation rejection.
    - When OCR yields one or more items, returns :class:`Ok` of
      :class:`MenuOcrSuccess`.
    - When OCR yields no items, returns :class:`Ok` of :class:`NoMatch`
      (fallback: text search), leaving current state unchanged (Req 7.6).

    Returns ``Ok[MenuOcrSuccess] | Ok[NoMatch] | Err``.
    """
    if not isinstance(image, (bytes, bytearray)) or len(image) == 0:
        return err(
            validation_rejection(
                "MENU_IMAGE_INVALID",
                "A menu image is required to extract items.",
            )
        )

    lines = backend.extract_lines(bytes(image))
    options = extract_menu_items(list(lines))
    if not options:
        return ok(_no_menu_match())

    return ok(MenuOcrSuccess(options=options))


def _no_menu_match() -> NoMatch:
    return NoMatch(
        kind=LookupKind.MENU_OCR,
        message="No menu items were recognized. Try searching for the item by name instead.",
        fallback=Fallback.TEXT_SEARCH,
    )
