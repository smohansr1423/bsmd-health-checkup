/**
 * End-to-end flow wiring for the cortisol side of the Calorie & Cortisol Tool
 * (Task 18.2).
 *
 * This is the composition seat that connects the already-implemented Cortisol
 * Data modules into the two design flows, without re-implementing any ingestion
 * or scoring logic:
 *
 *   Flow 2 — Lab Kit → Cortisol Result (design; Req 8, 14):
 *     orderKit → linkSample → ingestLabResults (HMAC-verified webhook,
 *     structural validation, diurnal windows, reference-range contextualization)
 *     → persist readings to TimescaleDB → notify results ready → refresh
 *     dashboard/insights.
 *
 *   Flow 3 — Wearable → Cortisol Proxy (design; Req 9, 10, 11, 12):
 *     syncWearable (authorization scoping + per-reading validation + source
 *     tagging) → persist accepted proxy readings → refresh dashboard/insights,
 *     and, when a connection is revoked/inactive, emit a sync-failure notice.
 *     Questionnaire (Req 10) and CAR (Req 11) inputs feed the same
 *     persist → refresh path, with diurnal-deviation alerts routed to the
 *     Notification Service.
 *
 * Every upstream module is consumed through its existing public entry point
 * ({@link LabKitService}, {@link handleLabResultsWebhook}, {@link syncWearable},
 * {@link processCarSubmission}, {@link handleQuestionnaireSubmission}); the only
 * new code here is the orchestration that persists the modules' validated output
 * and fans out the resulting notification / insight-refresh side effects through
 * the injectable ports in {@link ./ports}.
 *
 * Requirements: 8.1, 8.4, 9.1, 10.1, 11.1
 */

import type { Result } from '@calorie-cortisol/shared/result';

import { LabKitService } from '../lab/kit-service';
import type {
  KitLinkConfirmation,
  KitLinkRequest,
  KitOrderRequest,
  KitOrderResult,
} from '../lab/ports';
import {
  handleLabResultsWebhook,
  type LabIngestionDeps,
  type LabWebhookOutcome,
} from '../lab-ingestion/ingest';
import {
  syncWearable,
  type WearableSyncRequest,
  type WearableSyncResult,
} from '../wearable-sync';
import {
  processCarSubmission,
  type CarSubmission,
  type CarSubmissionOutcome,
} from '../car/car';
import { handleQuestionnaireSubmission } from '../questionnaire/handler';
import type {
  QuestionnaireOutcome,
  QuestionnaireSubmission,
} from '../questionnaire/types';

import type {
  CortisolPersistencePort,
  DashboardInsightsPort,
  NotificationPublisher,
} from './ports';

/** Everything the {@link CortisolFlowCoordinator} composes. */
export interface CortisolFlowDeps {
  /** Lab-kit ordering + QR sample linkage service (Task 9.1). */
  readonly labKit: LabKitService;
  /**
   * Dependencies for the lab-result ingestion webhook (Task 9.4). The
   * coordinator owns persistence, so a `persistReadings` sink set here is
   * ignored — accepted readings are persisted through {@link persistence}.
   */
  readonly labIngestion: LabIngestionDeps;
  /** TimescaleDB persistence (Req 8.4, 9.3, 11.1). */
  readonly persistence: CortisolPersistencePort;
  /** Outbound events to the Notification Service (Task 13.1). */
  readonly notifications: NotificationPublisher;
  /** Dashboard / insights refresh trigger (Task 11.x, 17.2). */
  readonly insights: DashboardInsightsPort;
}

/**
 * Composes the cortisol ingestion modules with persistence, notifications, and
 * dashboard/insight refreshes into the two end-to-end flows. Holds no state of
 * its own; every effect goes through an injected port.
 */
export class CortisolFlowCoordinator {
  private readonly deps: CortisolFlowDeps;

  constructor(deps: CortisolFlowDeps) {
    this.deps = deps;
  }

  // =========================================================================
  // Flow 2 — Lab Kit → Cortisol Result (Req 8)
  // =========================================================================

  /** Order an at-home cortisol test kit (Req 8.1). Delegates to Task 9.1. */
  async orderKit(request: KitOrderRequest): Promise<KitOrderResult> {
    return this.deps.labKit.orderKit(request);
  }

  /** Link a scanned kit QR code to the user (Req 8.2). Delegates to Task 9.1. */
  async linkSample(
    request: KitLinkRequest,
  ): Promise<Result<KitLinkConfirmation>> {
    return this.deps.labKit.linkSample(request);
  }

  /**
   * Ingest a lab-results webhook delivery and drive the rest of Flow 2.
   *
   * The HMAC verification, structural validation, 72-hour window, and
   * reference-range contextualization are performed by {@link
   * handleLabResultsWebhook} (Task 9.4). On an `accepted` outcome the
   * contextualized readings are persisted to TimescaleDB, a results-ready
   * notification is emitted to the Notification Service, and a dashboard /
   * insights refresh is triggered. Rejected or results-pending outcomes cause
   * no persistence, notification, or refresh (the order is simply retained by
   * the ingestion module).
   */
  async ingestLabResults(
    rawBody: string,
    signature: string | undefined,
  ): Promise<LabWebhookOutcome> {
    // Ensure our persistence path is the single writer: strip any sink the
    // caller may have configured on the ingestion deps.
    const ingestionDeps: LabIngestionDeps = {
      ...this.deps.labIngestion,
      persistReadings: undefined,
    };

    const outcome = handleLabResultsWebhook(rawBody, signature, ingestionDeps);

    if (outcome.body.status === 'accepted' && outcome.readings.length > 0) {
      await this.deps.persistence.saveCortisolReadings(outcome.readings);

      const userId = outcome.readings[0].userId;
      await this.deps.notifications.publish({
        type: 'labResultsReady',
        userId,
        orderId: outcome.body.orderId,
        acceptedCount: outcome.body.acceptedCount,
      });
      await this.deps.insights.notifyUpdate(userId, 'labResult');
    }

    return outcome;
  }

  // =========================================================================
  // Flow 3 — Wearable → Cortisol Proxy (Req 9)
  // =========================================================================

  /**
   * Import a batch of wearable/patch readings and drive the rest of Flow 3.
   *
   * Authorization scoping, per-reading validation, and source tagging are
   * performed by {@link syncWearable} (Task 9.7). Accepted (valid, authorized)
   * readings are persisted to the wearable-proxy series and a dashboard /
   * insights refresh is triggered. When the connection was revoked/inactive
   * (sync stopped, Req 9.8), a sync-failure notice is emitted to the
   * Notification Service so it can prompt reauthorization on the bounded retry
   * schedule (Req 9.7).
   */
  async syncWearableReadings(
    request: WearableSyncRequest,
  ): Promise<WearableSyncResult> {
    const result = syncWearable(request);

    if (result.accepted.length > 0) {
      await this.deps.persistence.saveWearableProxyReadings(result.accepted);
      await this.deps.insights.notifyUpdate(request.userId, 'wearableProxy');
    }

    // A revoked/inactive connection surfaces a reauthorization-required
    // notification (Req 9.8); route it to the Notification Service as a
    // wearable sync-failure notice (Req 9.7).
    if (
      result.notifications.some((n) => n.kind === 'reauthorization_required')
    ) {
      await this.deps.notifications.publish({
        type: 'syncFailureNotice',
        userId: request.userId,
        category: `wearable:${request.sourceType}`,
        operation: 'wearableSync',
      });
    }

    return result;
  }

  /**
   * Process a CAR submission (Req 11) and drive persistence + alerting.
   *
   * Window validation, completeness gating, and diurnal deviation
   * classification are performed by {@link processCarSubmission} (Task 9.15).
   * On a well-formed submission the retained measurement is persisted and a
   * dashboard / insights refresh is triggered; any raised deviation alerts
   * (flattened CAR / elevated evening cortisol, Req 11.5, 11.6) are forwarded
   * to the Notification Service.
   */
  async submitCar(
    submission: CarSubmission,
  ): Promise<Result<CarSubmissionOutcome>> {
    const outcome = processCarSubmission(submission);
    if (!outcome.ok) {
      return outcome;
    }

    await this.deps.persistence.saveCarMeasurement(outcome.value.measurement);
    await this.deps.insights.notifyUpdate(submission.userId, 'car');

    for (const alert of outcome.value.evaluation.alerts) {
      await this.deps.notifications.publish({
        type: 'deviationAlert',
        userId: submission.userId,
        cause:
          alert.cause === 'flattened_car' ? 'flattenedCAR' : 'elevatedEvening',
        detail: alert.message,
      });
    }

    return outcome;
  }

  /**
   * Score a questionnaire submission (Req 10) and persist the result.
   *
   * Scoring, completeness gating, tier mapping, and non-clinical framing are
   * performed by {@link handleQuestionnaireSubmission} (Task 9.11). On a
   * successful scoring the result is persisted and a dashboard / insights
   * refresh is triggered. An incomplete/invalid submission (which retains the
   * entered answers) causes no persistence or refresh.
   */
  async submitQuestionnaire(
    submission: QuestionnaireSubmission,
  ): Promise<QuestionnaireOutcome> {
    const outcome = handleQuestionnaireSubmission(submission);
    if (!outcome.ok) {
      return outcome;
    }

    const userId = submission.userId ?? '';
    await this.deps.persistence.saveQuestionnaireResult(userId, outcome.result);
    await this.deps.insights.notifyUpdate(userId, 'questionnaire');

    return outcome;
  }
}
