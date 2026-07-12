"""REST webhook contracts — Python mirror of `contracts/webhooks.ts`.

Shared payload/response shapes for the lab-results and FHIR webhooks. HMAC
verification, structural validation, and persistence live in later tasks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

LabResultPayloadFormat = Literal["HL7", "JSON"]
LabResultsIngestStatus = Literal["accepted", "results-pending", "rejected"]
FhirVersion = Literal["R4"]
FhirIngestStatus = Literal["accepted", "rejected"]


@dataclass
class LabResultReading:
    """A single normalized cortisol result carried in a lab webhook (Req 8.4/8.5)."""

    sample_id: str
    collected_at: str
    value: float
    unit: str
    time_of_day_bucket: Optional[str] = None  # diurnal bucket (Req 8.3)


@dataclass
class LabResultsWebhookRequest:
    """`POST /webhooks/lab-results` request body (Req 8.4)."""

    order_id: str
    lab_partner_id: str
    format: LabResultPayloadFormat
    raw_message: Optional[str] = None
    readings: Optional[List[LabResultReading]] = None


@dataclass
class LabResultsWebhookResponse:
    """`POST /webhooks/lab-results` response envelope (Req 8.4/8.8)."""

    status: LabResultsIngestStatus
    order_id: str
    accepted_count: int
    rejected_count: int
    reason: Optional[str] = None


@dataclass
class FhirWebhookRequest:
    """`POST /webhooks/fhir` request body — Epic MyChart FHIR R4 bundle (Req 14.6)."""

    version: FhirVersion
    order_id: str
    bundle: Dict[str, object] = field(default_factory=dict)


@dataclass
class FhirWebhookResponse:
    """`POST /webhooks/fhir` response envelope (Req 14.6/14.7)."""

    status: FhirIngestStatus
    order_id: str
    imported_count: int
    reason: Optional[str] = None
