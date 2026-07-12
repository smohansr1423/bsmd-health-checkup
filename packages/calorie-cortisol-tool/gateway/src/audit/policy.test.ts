import type {
  GatewayRequest,
  GatewayResponse,
  RequestContext,
} from '../types';
import {
  buildAuditRecord,
  defaultHealthDataClassifier,
  deriveOutcome,
  isRetentionExpired,
  isWithinRetention,
  resolveActorId,
  resolveAuditAction,
  resolveRecordId,
  retentionExpiry,
} from './policy';
import { ANONYMOUS_ACTOR, AUDIT_RETENTION_YEARS, type AuditRecord } from './types';

function graphqlRequest(
  operationType: 'query' | 'mutation',
  fieldName: string,
  variables?: Record<string, unknown>,
): GatewayRequest {
  return {
    id: 'req-1',
    kind: 'graphql',
    method: 'POST',
    path: '/graphql',
    headers: {},
    graphql: { operationType, fieldName, ...(variables ? { variables } : {}) },
  };
}

function restRequest(
  method: string,
  path: string,
  body?: unknown,
): GatewayRequest {
  return {
    id: 'req-1',
    kind: 'rest',
    method,
    path,
    headers: {},
    ...(body !== undefined ? { body } : {}),
  };
}

function contextFor(request: GatewayRequest, userId?: string): RequestContext {
  return {
    request,
    auth: userId
      ? { principal: { userId, roles: [] }, token: 'tkn' }
      : null,
    route: null,
    startedAt: 0,
    attributes: {},
  };
}

describe('resolveAuditAction', () => {
  it('maps GraphQL queries to read', () => {
    expect(resolveAuditAction(graphqlRequest('query', 'cortisolTrend'))).toBe('read');
  });

  it('maps create-style mutation verbs to create', () => {
    for (const field of ['createMeal', 'addReading', 'logMeal', 'submitQuestionnaire']) {
      expect(resolveAuditAction(graphqlRequest('mutation', field))).toBe('create');
    }
  });

  it('maps delete-style mutation verbs to delete', () => {
    for (const field of ['deleteMeal', 'removeMember', 'revokeConsent']) {
      expect(resolveAuditAction(graphqlRequest('mutation', field))).toBe('delete');
    }
  });

  it('maps other mutations (update/set/correct) to modify', () => {
    for (const field of ['updateProfile', 'setWakeTime', 'correctPortion']) {
      expect(resolveAuditAction(graphqlRequest('mutation', field))).toBe('modify');
    }
  });

  it('maps HTTP methods to CRUD actions', () => {
    expect(resolveAuditAction(restRequest('GET', '/meals'))).toBe('read');
    expect(resolveAuditAction(restRequest('POST', '/meals'))).toBe('create');
    expect(resolveAuditAction(restRequest('PUT', '/meals'))).toBe('modify');
    expect(resolveAuditAction(restRequest('PATCH', '/meals'))).toBe('modify');
    expect(resolveAuditAction(restRequest('DELETE', '/meals'))).toBe('delete');
  });
});

describe('resolveActorId', () => {
  it('uses the authenticated principal id', () => {
    const ctx = contextFor(restRequest('GET', '/meals'), 'user-42');
    expect(resolveActorId(ctx)).toBe('user-42');
  });

  it('falls back to the anonymous sentinel for unauthenticated requests', () => {
    const ctx = contextFor(restRequest('GET', '/meals'));
    expect(resolveActorId(ctx)).toBe(ANONYMOUS_ACTOR);
  });
});

describe('resolveRecordId', () => {
  it('prefers a GraphQL variable id', () => {
    const req = graphqlRequest('mutation', 'updateMeal', { id: 'meal-7' });
    expect(resolveRecordId(req)).toBe('meal-7');
  });

  it('prefers a REST body id', () => {
    const req = restRequest('PUT', '/meals/x', { id: 'meal-9' });
    expect(resolveRecordId(req)).toBe('meal-9');
  });

  it('falls back to the GraphQL field name when no id is present', () => {
    expect(resolveRecordId(graphqlRequest('query', 'diurnalProfile'))).toBe('diurnalProfile');
  });

  it('falls back to the request path for REST without an id', () => {
    expect(resolveRecordId(restRequest('GET', '/meals'))).toBe('/meals');
  });
});

describe('defaultHealthDataClassifier', () => {
  it('treats normal endpoints as health data', () => {
    expect(defaultHealthDataClassifier(restRequest('GET', '/meals'))).toBe(true);
    expect(defaultHealthDataClassifier(graphqlRequest('query', 'cortisolTrend'))).toBe(true);
  });

  it('excludes operational, non-PHI endpoints', () => {
    for (const path of ['/health', '/healthz', '/livez', '/readyz', '/metrics']) {
      expect(defaultHealthDataClassifier(restRequest('GET', path))).toBe(false);
    }
  });
});

describe('deriveOutcome', () => {
  const resp = (status: number, ok: boolean): GatewayResponse => ({ status, ok });

  it('classifies 401/403 as denied', () => {
    expect(deriveOutcome(resp(401, false))).toBe('denied');
    expect(deriveOutcome(resp(403, false))).toBe('denied');
  });

  it('classifies ok responses as allowed', () => {
    expect(deriveOutcome(resp(200, true))).toBe('allowed');
  });

  it('classifies other failures as error', () => {
    expect(deriveOutcome(resp(500, false))).toBe('error');
    expect(deriveOutcome(resp(400, false))).toBe('error');
  });
});

describe('retention policy', () => {
  it('sets expiry exactly 6 years after the timestamp', () => {
    const from = new Date('2024-01-01T00:00:00.000Z');
    const expiry = new Date(retentionExpiry(from));
    expect(expiry.getUTCFullYear() - from.getUTCFullYear()).toBe(AUDIT_RETENTION_YEARS);
    expect(expiry.getUTCMonth()).toBe(from.getUTCMonth());
    expect(expiry.getUTCDate()).toBe(from.getUTCDate());
  });

  const record: AuditRecord = {
    actorId: 'u1',
    action: 'read',
    recordId: 'r1',
    timestamp: '2024-01-01T00:00:00.000Z',
    requestId: 'req-1',
    outcome: 'allowed',
    expiresAt: '2030-01-01T00:00:00.000Z',
  };

  it('keeps entries within the retention window', () => {
    const now = new Date('2029-12-31T23:59:59.000Z');
    expect(isWithinRetention(record, now)).toBe(true);
    expect(isRetentionExpired(record, now)).toBe(false);
  });

  it('marks entries eligible for purge only after expiry', () => {
    const now = new Date('2030-01-01T00:00:01.000Z');
    expect(isWithinRetention(record, now)).toBe(false);
    expect(isRetentionExpired(record, now)).toBe(true);
  });
});

describe('buildAuditRecord', () => {
  it('produces a complete, retention-stamped entry', () => {
    const now = new Date('2024-06-15T12:00:00.000Z');
    const ctx = contextFor(graphqlRequest('mutation', 'deleteMeal', { id: 'meal-3' }), 'user-1');

    const record = buildAuditRecord({ ctx, outcome: 'allowed', now });

    expect(record).toEqual({
      actorId: 'user-1',
      action: 'delete',
      recordId: 'meal-3',
      timestamp: '2024-06-15T12:00:00.000Z',
      requestId: 'req-1',
      outcome: 'allowed',
      expiresAt: retentionExpiry(now),
    });
  });

  it('records anonymous actor and reason for a denied attempt', () => {
    const now = new Date('2024-06-15T12:00:00.000Z');
    const ctx = contextFor(restRequest('GET', '/meals'));

    const record = buildAuditRecord({
      ctx,
      outcome: 'denied',
      now,
      reason: 'GATEWAY_UNAUTHENTICATED',
    });

    expect(record.actorId).toBe(ANONYMOUS_ACTOR);
    expect(record.action).toBe('read');
    expect(record.outcome).toBe('denied');
    expect(record.reason).toBe('GATEWAY_UNAUTHENTICATED');
  });
});
