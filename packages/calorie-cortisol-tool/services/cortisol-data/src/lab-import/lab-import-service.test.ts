import { isErr, isOk } from '@calorie-cortisol/shared/result';

import { LabImportErrorCode } from './errors';
import { LabImportService } from './lab-import-service';
import {
  MAX_PDF_BYTES,
  OCR_TIMEOUT_MS,
  FHIR_TIMEOUT_MS,
  REPORT_TIMEOUT_MS,
  PDF_CONTENT_TYPE,
  type TimeSource,
  type ExtractedLabValue,
  type FhirClientPort,
  type FhirImportOutcome,
  type IdSource,
  type ImportedLabResult,
  type ImportedResultsStore,
  type OcrOutcome,
  type OcrPort,
  type PdfUpload,
  type ReportRendererPort,
  type ReportRenderOutcome,
} from './ports';

// ---------------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------------

class StubOcr implements OcrPort {
  calls = 0;
  constructor(private readonly outcome: OcrOutcome) {}
  async extract(): Promise<OcrOutcome> {
    this.calls += 1;
    return this.outcome;
  }
}

class StubFhir implements FhirClientPort {
  calls = 0;
  constructor(private readonly outcome: FhirImportOutcome) {}
  async importResults(): Promise<FhirImportOutcome> {
    this.calls += 1;
    return this.outcome;
  }
}

class StubRenderer implements ReportRendererPort {
  calls = 0;
  lastResults: readonly ImportedLabResult[] = [];
  constructor(private readonly outcome: ReportRenderOutcome) {}
  async render(input: { userId: string; results: readonly ImportedLabResult[] }): Promise<ReportRenderOutcome> {
    this.calls += 1;
    this.lastResults = input.results;
    return this.outcome;
  }
}

class FakeResultsStore implements ImportedResultsStore {
  readonly byUser = new Map<string, ImportedLabResult[]>();

  constructor(seed: Record<string, ImportedLabResult[]> = {}) {
    for (const [userId, results] of Object.entries(seed)) {
      this.byUser.set(userId, [...results]);
    }
  }

  async snapshot(userId: string): Promise<readonly ImportedLabResult[]> {
    return [...(this.byUser.get(userId) ?? [])];
  }

  async append(userId: string, results: readonly ImportedLabResult[]): Promise<void> {
    const existing = this.byUser.get(userId) ?? [];
    this.byUser.set(userId, [...existing, ...results]);
  }

  count(userId: string): number {
    return (this.byUser.get(userId) ?? []).length;
  }
}

const fixedClock: TimeSource = { now: () => '2024-06-01T12:00:00.000Z' };

/** Deterministic incrementing id generator. */
function seqIds(prefix = 'id'): IdSource {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

const sampleValues: ExtractedLabValue[] = [
  { analyte: 'Cortisol, Serum', value: 15.2, unit: 'ug/dL', collectedAt: '2024-05-31T08:00:00.000Z' },
  { analyte: 'ACTH', value: 30, unit: 'pg/mL' },
];

function priorResult(userId: string): ImportedLabResult {
  return {
    id: 'prior-1',
    userId,
    analyte: 'Cortisol, Serum',
    value: 12,
    unit: 'ug/dL',
    source: 'pdf',
    importedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeService(overrides: {
  ocr?: OcrPort;
  fhir?: FhirClientPort;
  reportRenderer?: ReportRendererPort;
  results?: ImportedResultsStore;
  ids?: IdSource;
  clock?: TimeSource;
}) {
  const results = overrides.results ?? new FakeResultsStore();
  const service = new LabImportService({
    ocr: overrides.ocr ?? new StubOcr({ ok: true, values: sampleValues }),
    fhir: overrides.fhir ?? new StubFhir({ ok: true, results: sampleValues }),
    reportRenderer: overrides.reportRenderer ?? new StubRenderer({ ok: true, document: 'PDF' }),
    results,
    ids: overrides.ids ?? seqIds(),
    clock: overrides.clock ?? fixedClock,
  });
  return { service, results };
}

function validUpload(overrides: Partial<PdfUpload> = {}): PdfUpload {
  return {
    userId: 'u1',
    filename: 'labs.pdf',
    contentType: PDF_CONTENT_TYPE,
    sizeBytes: 1024,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PDF OCR import (Req 14.1, 14.2, 14.3)
// ---------------------------------------------------------------------------

describe('LabImportService.importPdf', () => {
  it('extracts and imports values from a valid PDF (Req 14.1)', async () => {
    const ocr = new StubOcr({ ok: true, values: sampleValues });
    const { service, results } = makeService({ ocr, ids: seqIds('r') });

    const result = await service.importPdf(validUpload());

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('pdf');
      expect(result.value.importedCount).toBe(2);
      expect(result.value.imported[0]).toMatchObject({
        userId: 'u1',
        analyte: 'Cortisol, Serum',
        value: 15.2,
        unit: 'ug/dL',
        source: 'pdf',
        importedAt: '2024-06-01T12:00:00.000Z',
        collectedAt: '2024-05-31T08:00:00.000Z',
      });
    }
    expect((results as FakeResultsStore).count('u1')).toBe(2);
  });

  it('rejects a non-PDF upload and retains prior results (Req 14.2)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const ocr = new StubOcr({ ok: true, values: sampleValues });
    const { service } = makeService({ ocr, results: store });

    const result = await service.importPdf(validUpload({ contentType: 'image/png' }));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.PDF_WRONG_FORMAT);
      expect(result.error.retainedState).toBe(true);
    }
    expect(ocr.calls).toBe(0); // rejected before OCR
    expect(store.count('u1')).toBe(1); // prior unchanged
  });

  it('rejects an oversize upload and retains prior results (Req 14.2)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const ocr = new StubOcr({ ok: true, values: sampleValues });
    const { service } = makeService({ ocr, results: store });

    const result = await service.importPdf(validUpload({ sizeBytes: MAX_PDF_BYTES + 1 }));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.PDF_TOO_LARGE);
      expect(result.error.retainedState).toBe(true);
    }
    expect(ocr.calls).toBe(0);
    expect(store.count('u1')).toBe(1);
  });

  it('accepts an upload of exactly 20 MB (boundary, Req 14.2)', async () => {
    const { service } = makeService({ ocr: new StubOcr({ ok: true, values: sampleValues }) });

    const result = await service.importPdf(validUpload({ sizeBytes: MAX_PDF_BYTES }));

    expect(isOk(result)).toBe(true);
  });

  it('discards the partial extraction and retains prior results when OCR fails (Req 14.3)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const ocr = new StubOcr({ ok: false, reason: 'unreadable' });
    const { service } = makeService({ ocr, results: store });

    const result = await service.importPdf(validUpload());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.PDF_OCR_FAILED);
      expect(result.error.retainedState).toBe(true);
    }
    expect(store.count('u1')).toBe(1);
  });

  it('treats an empty OCR extraction (no recognizable values) as failure (Req 14.3)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const ocr = new StubOcr({ ok: true, values: [] });
    const { service } = makeService({ ocr, results: store });

    const result = await service.importPdf(validUpload());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.PDF_OCR_FAILED);
    }
    expect(store.count('u1')).toBe(1);
  });

  it('filters out unusable values and imports only recognizable ones', async () => {
    const ocr = new StubOcr({
      ok: true,
      values: [
        { analyte: '', value: 1, unit: 'x' }, // no analyte
        { analyte: 'ACTH', value: Number.NaN, unit: 'pg/mL' }, // non-finite
        { analyte: 'Cortisol', value: 10, unit: 'ug/dL' }, // usable
      ],
    });
    const { service } = makeService({ ocr });

    const result = await service.importPdf(validUpload());

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.importedCount).toBe(1);
      expect(result.value.imported[0].analyte).toBe('Cortisol');
    }
  });

  it('reports OCR timeout when the reported elapsed time exceeds 30s (Req 14.1/14.3)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const ocr = new StubOcr({ ok: true, values: sampleValues, elapsedMs: OCR_TIMEOUT_MS + 1 });
    const { service } = makeService({ ocr, results: store });

    const result = await service.importPdf(validUpload());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.PDF_OCR_TIMEOUT);
      expect(result.error.retainedState).toBe(true);
      expect(result.error.retryable).toBe(true);
    }
    expect(store.count('u1')).toBe(1);
  });

  it('reports OCR timeout when the port signals a timeout', async () => {
    const ocr = new StubOcr({ ok: false, reason: 'timeout' });
    const { service } = makeService({ ocr });

    const result = await service.importPdf(validUpload());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.PDF_OCR_TIMEOUT);
    }
  });

  it('rejects an upload with a missing userId', async () => {
    const { service } = makeService({});
    const result = await service.importPdf(validUpload({ userId: '' }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.PDF_INVALID_REQUEST);
    }
  });
});

// ---------------------------------------------------------------------------
// Epic MyChart FHIR R4 import (Req 14.4, 14.5)
// ---------------------------------------------------------------------------

describe('LabImportService.importFromFhir', () => {
  it('imports results from Epic MyChart via FHIR R4 (Req 14.4)', async () => {
    const fhir = new StubFhir({ ok: true, results: sampleValues });
    const { service, results } = makeService({ fhir });

    const result = await service.importFromFhir({ userId: 'u1', connectionId: 'epic-1' });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('fhir');
      expect(result.value.importedCount).toBe(2);
      expect(result.value.imported.every((r) => r.source === 'fhir')).toBe(true);
    }
    expect((results as FakeResultsStore).count('u1')).toBe(2);
  });

  it('retains prior results when the connection fails (Req 14.5)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const fhir = new StubFhir({ ok: false, reason: 'connection-failed' });
    const { service } = makeService({ fhir, results: store });

    const result = await service.importFromFhir({ userId: 'u1' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.FHIR_IMPORT_FAILED);
      expect(result.error.retainedState).toBe(true);
    }
    expect(store.count('u1')).toBe(1);
  });

  it('retains prior results when the import times out via the port (Req 14.5)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const fhir = new StubFhir({ ok: false, reason: 'timeout' });
    const { service } = makeService({ fhir, results: store });

    const result = await service.importFromFhir({ userId: 'u1' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.FHIR_IMPORT_TIMEOUT);
      expect(result.error.retainedState).toBe(true);
    }
    expect(store.count('u1')).toBe(1);
  });

  it('reports timeout when the reported elapsed time exceeds 60s (Req 14.5)', async () => {
    const fhir = new StubFhir({ ok: true, results: sampleValues, elapsedMs: FHIR_TIMEOUT_MS + 1 });
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const { service } = makeService({ fhir, results: store });

    const result = await service.importFromFhir({ userId: 'u1' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.FHIR_IMPORT_TIMEOUT);
    }
    expect(store.count('u1')).toBe(1);
  });

  it('treats an empty FHIR import as unsuccessful and retains prior results (Req 14.5)', async () => {
    const fhir = new StubFhir({ ok: true, results: [] });
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const { service } = makeService({ fhir, results: store });

    const result = await service.importFromFhir({ userId: 'u1' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.FHIR_IMPORT_FAILED);
    }
    expect(store.count('u1')).toBe(1);
  });

  it('rejects a request with a missing userId', async () => {
    const { service } = makeService({});
    const result = await service.importFromFhir({ userId: '' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.FHIR_INVALID_REQUEST);
    }
  });
});

// ---------------------------------------------------------------------------
// Physician-ready report generation (Req 14.6, 14.7)
// ---------------------------------------------------------------------------

describe('LabImportService.generateReport', () => {
  it('generates a physician-ready report from imported results (Req 14.6)', async () => {
    const store = new FakeResultsStore({ u1: [priorResult('u1')] });
    const renderer = new StubRenderer({ ok: true, document: 'PDF-BYTES' });
    const { service } = makeService({ reportRenderer: renderer, results: store, ids: seqIds('rep') });

    const result = await service.generateReport({ userId: 'u1' });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.userId).toBe('u1');
      expect(result.value.resultCount).toBe(1);
      expect(result.value.document).toBe('PDF-BYTES');
      expect(result.value.generatedAt).toBe('2024-06-01T12:00:00.000Z');
    }
    expect(renderer.lastResults).toHaveLength(1);
  });

  it('produces no partial report when rendering fails (Req 14.7)', async () => {
    const renderer = new StubRenderer({ ok: false, reason: 'render-failed' });
    const { service } = makeService({ reportRenderer: renderer });

    const result = await service.generateReport({ userId: 'u1' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.REPORT_GENERATION_FAILED);
      expect(result.error.retainedState).toBe(true);
    }
  });

  it('reports a timeout when the port signals a timeout (Req 14.7)', async () => {
    const renderer = new StubRenderer({ ok: false, reason: 'timeout' });
    const { service } = makeService({ reportRenderer: renderer });

    const result = await service.generateReport({ userId: 'u1' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.REPORT_GENERATION_TIMEOUT);
    }
  });

  it('discards a late "success" that exceeds 15s so no partial report is surfaced (Req 14.7)', async () => {
    const renderer = new StubRenderer({ ok: true, document: 'PDF', elapsedMs: REPORT_TIMEOUT_MS + 1 });
    const { service } = makeService({ reportRenderer: renderer });

    const result = await service.generateReport({ userId: 'u1' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.REPORT_GENERATION_TIMEOUT);
    }
  });

  it('rejects a request with a missing userId', async () => {
    const { service } = makeService({});
    const result = await service.generateReport({ userId: '' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(LabImportErrorCode.REPORT_INVALID_REQUEST);
    }
  });
});
