import type { LabResultsWebhookRequest } from '@calorie-cortisol/shared';
import {
  hl7DateToIso,
  parseHl7Readings,
  parseJsonReadings,
  parseLabResultsPayload,
} from './parse';

describe('parseJsonReadings (Req 8.4 JSON)', () => {
  it('normalizes valid readings to nmol/L', () => {
    const res = parseJsonReadings([
      { sampleId: 's1', collectedAt: '2024-01-01T08:00:00Z', value: 1, unit: 'ug/dL' },
    ]);
    expect(res.errors).toHaveLength(0);
    expect(res.readings).toHaveLength(1);
    expect(res.readings[0].valueNmolL).toBeCloseTo(27.59, 2);
    expect(res.readings[0].sampleId).toBe('s1');
  });

  it('flags each structurally invalid reading without dropping the good ones', () => {
    const res = parseJsonReadings([
      { sampleId: 's1', collectedAt: '2024-01-01T08:00:00Z', value: 10, unit: 'nmol/L' },
      { sampleId: '', collectedAt: '2024-01-01T08:00:00Z', value: 10, unit: 'nmol/L' },
      { sampleId: 's3', collectedAt: 'bad', value: 10, unit: 'nmol/L' },
      { sampleId: 's4', collectedAt: '2024-01-01T08:00:00Z', value: -1, unit: 'nmol/L' },
      { sampleId: 's5', collectedAt: '2024-01-01T08:00:00Z', value: 10, unit: 'furlongs' },
    ]);
    expect(res.readings).toHaveLength(1);
    expect(res.errors).toHaveLength(4);
  });

  it('reports an error for an empty/absent array', () => {
    expect(parseJsonReadings([]).errors.length).toBeGreaterThan(0);
    expect(parseJsonReadings(undefined).errors.length).toBeGreaterThan(0);
  });
});

describe('hl7DateToIso', () => {
  it('parses YYYYMMDDHHMMSS', () => {
    expect(hl7DateToIso('20240101080000')).toBe('2024-01-01T08:00:00.000Z');
  });
  it('parses date-only', () => {
    expect(hl7DateToIso('20240101')).toBe('2024-01-01T00:00:00.000Z');
  });
  it('returns null for garbage', () => {
    expect(hl7DateToIso('nope')).toBeNull();
  });
});

describe('parseHl7Readings (Req 8.4 HL7)', () => {
  const hl7 = [
    'MSH|^~\\&|LAB|LABFAC|APP|FAC|20240101080500||ORU^R01|MSG1|P|2.5',
    'OBR|1|PLACER1|ACC-123|CORT^Cortisol',
    'OBX|1|NM|CORT^Cortisol Saliva||12.5|nmol/L|||||F|||20240101080000',
  ].join('\r');

  it('extracts value, unit, datetime and the accession as sampleId', () => {
    const res = parseHl7Readings(hl7);
    expect(res.errors).toHaveLength(0);
    expect(res.readings).toHaveLength(1);
    expect(res.readings[0]).toMatchObject({
      sampleId: 'ACC-123',
      valueNmolL: 12.5,
      collectedAt: '2024-01-01T08:00:00.000Z',
    });
  });

  it('errors when there are no OBX segments', () => {
    const res = parseHl7Readings('MSH|^~\\&|LAB');
    expect(res.readings).toHaveLength(0);
    expect(res.errors.join(' ')).toContain('OBX');
  });

  it('errors on an unrecognized unit in OBX-6', () => {
    const bad = [
      'OBR|1|PLACER1|ACC-9|CORT',
      'OBX|1|NM|CORT||9.9|furlongs|||||F|||20240101080000',
    ].join('\r');
    const res = parseHl7Readings(bad);
    expect(res.readings).toHaveLength(0);
    expect(res.errors.join(' ')).toContain('unrecognized unit');
  });
});

describe('parseLabResultsPayload envelope validation', () => {
  it('flags missing envelope ids', () => {
    const req = { format: 'JSON', readings: [] } as unknown as LabResultsWebhookRequest;
    const res = parseLabResultsPayload(req);
    expect(res.errors.join(' ')).toContain('missing orderId');
    expect(res.errors.join(' ')).toContain('missing labPartnerId');
  });

  it('flags an unsupported format', () => {
    const req = {
      orderId: 'o1',
      labPartnerId: 'l1',
      format: 'XML',
    } as unknown as LabResultsWebhookRequest;
    expect(parseLabResultsPayload(req).errors.join(' ')).toContain('unsupported');
  });
});
