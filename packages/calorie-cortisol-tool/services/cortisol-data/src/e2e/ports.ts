/**
 * Injectable ports for the cortisol-side end-to-end flow wiring (Task 18.2).
 *
 * The {@link ../e2e/cortisol-flows#CortisolFlowCoordinator} composes the
 * already-implemented Cortisol Data modules — lab-kit ordering/QR linkage
 * (Task 9.1), lab-result webhook ingestion (Task 9.4), wearable/patch sync
 * (Task 9.7), questionnaire scoring (Task 9.11), and CAR/diurnal tracking
 * (Task 9.15) — into the two design flows:
 *
 *   - Flow 2 "Lab Kit → Cortisol Result" (design; Req 8): order → link → lab
 *     webhook ingestion → persist readings → notify results ready → dashboard
 *     / insights update.
 *   - Flow 3 "Wearable → Cortisol Proxy" (design; Req 9): batch sync → per-
 *     reading validation → persist valid proxy readings → dashboard / insights
 *     update, with a sync-failure notice on a revoked/inactive connection.
 *
 * The coordinator reaches its three cross-service collaborators — TimescaleDB
 * persistence, the Notification Service, and the Insights/dashboard read model
 * — only through the ports declared here. Production wiring supplies real
 * adapters (the TimescaleDB hypertable writers under `src/db`, an SQS producer
 * for the Notification Service, and an insights-update publisher); tests supply
 * the in-memory fakes at the bottom of this file. This keeps the flow logic
 * deterministic and free of database / queue / network coupling, and lets the
 * end-to-end test assert exactly what was persisted, notified, and refreshed.
 *
 * NOTE: the outbound-notification shapes here mirror the Notification Service's
 * SQS event contract (`@calorie-cortisol/notification` — deviation alerts and
 * sync-failure notices, Task 13.1). They are re-declared locally rather than
 * imported so this service does not take a build-time dependency on the
 * Notification Service; the Notification Service is the consumer of these
 * events off the queue.
 *
 * Requirements: 8.1, 8.4, 9.1, 10.1, 11.1
 */

import type {
  CARMeasurement,
  CortisolReading,
} from '@calorie-cortisol/shared';
import type { AcceptedReading } from '../wearable-sync';
import type { QuestionnaireResult } from '../questionnaire/types';

// ---------------------------------------------------------------------------
// Persistence port (TimescaleDB hypertables — Req 8.4, 9.3, 11.1)
// ---------------------------------------------------------------------------

/**
 * Write-side persistence for cortisol data. In production these back onto the
 * TimescaleDB hypertables defined under `migrations/` (cortisol_readings,
 * wearable_proxy_series, diurnal_samples). The coordinator only ever hands
 * fully-validated, contextualized/tagged domain rows here — validation and
 * scoring have already happened in the upstream modules.
 */
export interface CortisolPersistencePort {
  /** Persist contextualized lab-result readings (Flow 2, Req 8.4). */
  saveCortisolReadings(readings: readonly CortisolReading[]): Promise<void>;
  /** Persist accepted wearable/patch proxy readings (Flow 3, Req 9.3). */
  saveWearableProxyReadings(readings: readonly AcceptedReading[]): Promise<void>;
  /** Persist an accepted CAR measurement (diurnal samples, Req 11.1). */
  saveCarMeasurement(measurement: CARMeasurement): Promise<void>;
  /** Persist a scored questionnaire result (questionnaire proxy, Req 10.1). */
  saveQuestionnaireResult(
    userId: string,
    result: QuestionnaireResult,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Outbound notification port (→ Notification Service SQS, Task 13.1)
// ---------------------------------------------------------------------------

/** A cortisol lab kit's results have been ingested and are ready to view (Flow 2). */
export interface LabResultsReadyNotification {
  readonly type: 'labResultsReady';
  readonly userId: string;
  readonly orderId: string;
  readonly acceptedCount: number;
}

/**
 * A diurnal-pattern deviation alert — flattened CAR or elevated evening
 * cortisol (Req 11.5, 11.6). `cause` uses the Notification Service's
 * deviation-alert vocabulary so the event maps straight onto its dispatcher.
 */
export interface DeviationAlertNotification {
  readonly type: 'deviationAlert';
  readonly userId: string;
  readonly cause: 'flattenedCAR' | 'elevatedEvening';
  readonly detail: string;
}

/**
 * A background sync-failure notice for a wearable source whose authorization
 * was revoked or is inactive (Req 9.7, 9.8). Maps onto the Notification
 * Service's `syncFailureNotice` / `wearableSync` retry schedule.
 */
export interface SyncFailureNotification {
  readonly type: 'syncFailureNotice';
  readonly userId: string;
  /** Affected source/category, e.g. "wearable:oura". */
  readonly category: string;
  readonly operation: 'wearableSync';
}

/** Every event the cortisol flows emit toward the Notification Service. */
export type OutboundNotification =
  | LabResultsReadyNotification
  | DeviationAlertNotification
  | SyncFailureNotification;

/**
 * Publishes cortisol-domain events onto the Notification Service's queue. In
 * production this is an SQS producer; the Notification Service consumes and
 * delivers them (push/email/in-app) with bounded retry (Task 13.1).
 */
export interface NotificationPublisher {
  publish(event: OutboundNotification): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dashboard / insights refresh port (→ Insights & ML, Task 11.x / 17.2)
// ---------------------------------------------------------------------------

/** The kind of new data that should trigger a dashboard / insights refresh. */
export type InsightUpdateKind =
  | 'labResult'
  | 'wearableProxy'
  | 'car'
  | 'questionnaire';

/**
 * Signals the Insights/dashboard read model that a user has new cortisol data
 * so correlation/trend outputs and the dashboard can refresh asynchronously
 * (design Flow 2/3 "dashboard update (async insight)").
 */
export interface DashboardInsightsPort {
  notifyUpdate(userId: string, kind: InsightUpdateKind): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory fakes for the end-to-end / composition tests
// ---------------------------------------------------------------------------

/** In-memory persistence fake capturing every persisted row (TimescaleDB stand-in). */
export class FakeCortisolPersistence implements CortisolPersistencePort {
  public readonly cortisolReadings: CortisolReading[] = [];
  public readonly wearableProxyReadings: AcceptedReading[] = [];
  public readonly carMeasurements: CARMeasurement[] = [];
  public readonly questionnaireResults: Array<{
    userId: string;
    result: QuestionnaireResult;
  }> = [];

  async saveCortisolReadings(readings: readonly CortisolReading[]): Promise<void> {
    this.cortisolReadings.push(...readings);
  }

  async saveWearableProxyReadings(
    readings: readonly AcceptedReading[],
  ): Promise<void> {
    this.wearableProxyReadings.push(...readings);
  }

  async saveCarMeasurement(measurement: CARMeasurement): Promise<void> {
    this.carMeasurements.push(measurement);
  }

  async saveQuestionnaireResult(
    userId: string,
    result: QuestionnaireResult,
  ): Promise<void> {
    this.questionnaireResults.push({ userId, result });
  }
}

/** In-memory notification publisher capturing every emitted event. */
export class FakeNotificationPublisher implements NotificationPublisher {
  public readonly published: OutboundNotification[] = [];

  async publish(event: OutboundNotification): Promise<void> {
    this.published.push(event);
  }

  /** Convenience: all published events of a given type. */
  ofType<T extends OutboundNotification['type']>(
    type: T,
  ): Array<Extract<OutboundNotification, { type: T }>> {
    return this.published.filter(
      (e): e is Extract<OutboundNotification, { type: T }> => e.type === type,
    );
  }
}

/** In-memory dashboard/insights refresh fake capturing every update signal. */
export class FakeDashboardInsights implements DashboardInsightsPort {
  public readonly updates: Array<{ userId: string; kind: InsightUpdateKind }> = [];

  async notifyUpdate(userId: string, kind: InsightUpdateKind): Promise<void> {
    this.updates.push({ userId, kind });
  }
}
