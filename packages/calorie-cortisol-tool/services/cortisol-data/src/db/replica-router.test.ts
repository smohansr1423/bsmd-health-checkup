import { ReplicaRouter, type QueryIntent } from './replica-router';
import type { DbEndpoint, TimescaleConfig } from './config';

const primary: DbEndpoint = {
  host: 'primary.local',
  port: 5432,
  database: 'cortisol',
  user: 'svc',
  password: 'secret',
  ssl: true,
  maxConnections: 10,
};

function replica(host: string): DbEndpoint {
  return { ...primary, host };
}

describe('ReplicaRouter', () => {
  it('routes writes and read-your-writes to the primary', () => {
    const router = new ReplicaRouter({
      primary,
      replicas: [replica('r1.local')],
    });

    expect(router.route('write').role).toBe('primary');
    expect(router.route('readWrite').role).toBe('primary');
  });

  it('routes trend and general reads to a replica when replicas exist', () => {
    const router = new ReplicaRouter({
      primary,
      replicas: [replica('r1.local')],
    });

    expect(router.route('trendRead').role).toBe('replica');
    expect(router.route('read').role).toBe('replica');
    expect(router.route('trendRead').endpoint.host).toBe('r1.local');
  });

  it('falls back to the primary for reads when no replicas are configured', () => {
    const router = new ReplicaRouter({ primary, replicas: [] });

    const trend = router.route('trendRead');
    expect(trend.role).toBe('primary');
    expect(trend.endpoint.host).toBe('primary.local');
    expect(router.route('read').role).toBe('primary');
  });

  it('spreads replica reads round-robin across replicas', () => {
    const router = new ReplicaRouter({
      primary,
      replicas: [replica('r1.local'), replica('r2.local')],
    });

    const hosts = [
      router.route('trendRead').endpoint.host,
      router.route('trendRead').endpoint.host,
      router.route('trendRead').endpoint.host,
      router.route('trendRead').endpoint.host,
    ];

    expect(hosts).toEqual(['r1.local', 'r2.local', 'r1.local', 'r2.local']);
  });

  it('classifies replica-eligible intents', () => {
    const eligible: QueryIntent[] = ['read', 'trendRead'];
    const primaryOnly: QueryIntent[] = ['write', 'readWrite'];

    for (const intent of eligible) {
      expect(ReplicaRouter.prefersReplica(intent)).toBe(true);
    }
    for (const intent of primaryOnly) {
      expect(ReplicaRouter.prefersReplica(intent)).toBe(false);
    }
  });
});
