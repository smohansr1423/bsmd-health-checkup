/**
 * REST webhook contracts for external ingestion (design: API Gateway).
 *
 * These describe the request payloads and response envelopes for the
 * lab-results and FHIR webhooks. HMAC verification, structural validation, and
 * persistence are implemented in the Cortisol Data Service (later tasks) — this
 * file defines only the shared contract shapes.
 */

import type { TimeOfDayBucket } from '../domain';

/** Payload encodings accepted by the lab-results webhook (Req 8.4). */
export type LabResultPayloadFormat = 'HL7' | 'JSON';

/** A single normalized cortisol result carried in a lab webhook (Req 8.4/8.5). */
export interface LabResultReading {
  /** Sample identifier linked to the user's QR-linked kit (Req 8.2). */
  sampleId: string;
  /** ISO timestamp of collection. */
  collectedAt: string;
  /** Reported value in the reported unit. */
  value: number;
  /** Reported unit (normalized downstream to nmol/L). */
  unit: string;
  /** Optional diurnal bucket when the lab reports one (Req 8.3). */
  timeOfDayBucket?: TimeOfDayBucket;
}

/**
 * `POST /webhooks/lab-results` request body.
 * When `format` is `HL7`, the raw message is carried in `rawMessage`; when
 * `JSON`, structured `readings` are provided (Req 8.4).
 */
export interface LabResultsWebhookRequest {
  orderId: string;
  labPartnerId: string;
  format: LabResultPayloadFormat;
  rawMessage?: string;
  readings?: LabResultReading[];
}

/** Outcome states of a lab-results webhook (Req 8.4/8.8). */
export type LabResultsIngestStatus =
  | 'accepted'
  | 'results-pending'
  | 'rejected';

/** `POST /webhooks/lab-results` response envelope. */
export interface LabResultsWebhookResponse {
  status: LabResultsIngestStatus;
  orderId: string;
  acceptedCount: number;
  rejectedCount: number;
  /** Present when status is `rejected`. */
  reason?: string;
}

/** FHIR resource version accepted by the FHIR webhook/import (Req 14.6). */
export type FhirVersion = 'R4';

/**
 * `POST /webhooks/fhir` request body — an Epic MyChart SMART-on-FHIR R4
 * DiagnosticReport/Observation bundle plus the linking order (Req 14.6).
 */
export interface FhirWebhookRequest {
  version: FhirVersion;
  orderId: string;
  /** Opaque FHIR Bundle resource (validated structurally downstream). */
  bundle: Record<string, unknown>;
}

/** Outcome states of a FHIR import (Req 14.6/14.7). */
export type FhirIngestStatus = 'accepted' | 'rejected';

/** `POST /webhooks/fhir` response envelope. */
export interface FhirWebhookResponse {
  status: FhirIngestStatus;
  orderId: string;
  importedCount: number;
  /** Present when status is `rejected`; prior results remain unchanged (Req 14.7). */
  reason?: string;
}
