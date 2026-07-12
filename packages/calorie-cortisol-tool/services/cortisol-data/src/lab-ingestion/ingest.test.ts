import type { CortisolReading, LabResultsWebhookRequest } from '@calorie-cortisol/shared';
import { computeSignature } from './hmac';
import {
  handleLabResultsWebhook,
  isResultsTimedOut,
  type LabIngestionDeps,
} from './ingest';
import { LabIngestErrorCode } from './errors';

const SECRET = 'partner-secret';

function makeDeps(overrides: Partial<LabIngestionDeps> = {}): LabIngestionDeps {
  return {
    webhookSecret: SECRET,
    resolveUser: () => ({ userId: 'user-1', age: 40, sex: 'F' }),
    now: () => new Date('2024-01-02T00:00:00Z'),
    utcOffsetMinutes: 0,
    ...overrides,
  };
}

function signed(request: LabResultsWebhookRequest): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(request);
  return { rawBody, signature: computeSignature(rawBody, SECRET) };
}

describe('handleLabResultsWebhook', () => {
  it('rejects when the HMAC signature is missing or wrong (Req 8.4)', () => {
    const { rawBody } = signed({
      orderId: 'o1',
      labPartnerId: 'l1',
      format: 'JSON',
      readings: [],
    });
    const out = handleLabResultsWebhook(rawBody, 'deadbeef', makeDeps());
    expect(out.statusCode).toBe(401);
    expect(out.body.status).toBe('rejected');
    expect(out.body.reason).toBe(LabIngestErrorCode.SIGNATURE_INVALID);
    expect(out.readings).toHaveLength(0);
  });

  it('rejects an unparseable JSON body', () => {
    const rawBody = '{not json';
    const signature = computeSignature(rawBody, SECRET);
    const out = handleLabResultsWebhook(rawBody, signature, makeDeps());
    expect(out.statusCode).toBe(400);
    expect(out.body.reason).toBe(LabIngestErrorCode.PAYLOAD_UNPARSEABLE);
  });

  it('accepts a valid JSON payload and contextualizes readings (Req 8.5)', () => {
    const persisted: CortisolReading[] = [];
    const { rawBody, signature } = signed({
      orderId: 'o1',
      labPartnerId: 'l1',
      format: 'JSON',
      readings: [
        {
          sampleId: 's1',
          collectedAt: '2024-01-01T08:00:00Z',
          value: 12,
          unit: 'nmol/L',
          timeOfDayBucket: 'morning',
        },
      ],
    });
    const out = handleLabResultsWebhook(
      rawBody,
      signature,
      makeDeps({ persistReadings: (r) => persisted.push(...r) }),
    );
    expect(out.statusCode).toBe(200);
    expect(out.body.status).toBe('accepted');
    expect(out.body.acceptedCount).toBe(1);
    expect(out.readings[0].source).toBe('lab');
    expect(out.readings[0].valid).toBe(true);
    expect(out.readings[0].timeOfDayBucket).toBe('morning');
    expect(out.readings[0].contextualized?.classification).toBeDefined();
    expect(persisted).toHaveLength(1);
  });

  it('omits contextualization when the user has no age/sex (Req 8.5 gate)', () => {
    const { rawBody, signature } = signed({
      orderId: 'o1',
      labPartnerId: 'l1',
      format: 'JSON',
      readings: [
        { sampleId: 's1', collectedAt: '2024-01-01T08:00:00Z', value: 12, unit: 'nmol/L' },
      ],
    });
    const out = handleLabResultsWebhook(
      rawBody,
      signature,
      makeDeps({ resolveUser: () => ({ userId: 'user-1' }) }),
    );
    expect(out.statusCode).toBe(200);
    expect(out.readings[0].contextualized).toBeUndefined();
  });

  it('flags results-pending on a structurally invalid payload (Req 8.8)', () => {
    const { rawBody, signature } = signed({
      orderId: 'o1',
      labPartnerId: 'l1',
      format: 'JSON',
      readings: [{ sampleId: '', collectedAt: 'bad', value: -1, unit: 'x' } as never],
    });
    const out = handleLabResultsWebhook(rawBody, signature, makeDeps());
    expect(out.statusCode).toBe(202);
    expect(out.body.status).toBe('results-pending');
    expect(out.body.reason).toBe(LabIngestErrorCode.PAYLOAD_INVALID);
    expect(out.readings).toHaveLength(0);
  });

  it('flags results-pending with a timeout reason past 72h (Req 8.8)', () => {
    const { rawBody, signature } = signed({
      orderId: 'o1',
      labPartnerId: 'l1',
      format: 'JSON',
      readings: [],
    });
    const out = handleLabResultsWebhook(
      rawBody,
      signature,
      makeDeps({
        now: () => new Date('2024-01-10T00:00:00Z'),
        expectedPublicationAt: () => new Date('2024-01-01T00:00:00Z'),
      }),
    );
    expect(out.statusCode).toBe(202);
    expect(out.body.status).toBe('results-pending');
    expect(out.body.reason).toBe(LabIngestErrorCode.RESULTS_TIMEOUT);
  });

  it('ingests an HL7 payload', () => {
    const hl7 = [
      'MSH|^~\\&|LAB|LABFAC|APP|FAC|20240101080500||ORU^R01|MSG1|P|2.5',
      'OBR|1|PLACER1|ACC-123|CORT^Cortisol',
      'OBX|1|NM|CORT^Cortisol||18|nmol/L|||||F|||20240101080000',
    ].join('\r');
    const { rawBody, signature } = signed({
      orderId: 'o1',
      labPartnerId: 'l1',
      format: 'HL7',
      rawMessage: hl7,
    });
    const out = handleLabResultsWebhook(rawBody, signature, makeDeps());
    expect(out.statusCode).toBe(200);
    expect(out.body.acceptedCount).toBe(1);
    expect(out.readings[0].valueNmolL).toBe(18);
  });
});

describe('isResultsTimedOut (Req 8.8)', () => {
  const expected = new Date('2024-01-01T00:00:00Z');
  it('is false within 72h', () => {
    expect(isResultsTimedOut(expected, new Date('2024-01-03T23:00:00Z'))).toBe(false);
  });
  it('is true past 72h', () => {
    expect(isResultsTimedOut(expected, new Date('2024-01-04T01:00:00Z'))).toBe(true);
  });
});
