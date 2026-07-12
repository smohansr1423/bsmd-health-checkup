import {
  loadPrimaryEndpoint,
  loadReplicaEndpoints,
  loadTimescaleConfig,
} from './config';

const base: NodeJS.ProcessEnv = {
  TIMESCALE_PRIMARY_HOST: 'primary.local',
  TIMESCALE_DB: 'cortisol',
  TIMESCALE_USER: 'svc',
  TIMESCALE_PASSWORD: 'secret',
};

describe('loadPrimaryEndpoint', () => {
  it('parses required fields with secure defaults', () => {
    const ep = loadPrimaryEndpoint(base);
    expect(ep.host).toBe('primary.local');
    expect(ep.port).toBe(5432);
    expect(ep.ssl).toBe(true); // TLS on by default
    expect(ep.maxConnections).toBe(10);
  });

  it('throws when a required field is missing', () => {
    expect(() => loadPrimaryEndpoint({ ...base, TIMESCALE_PRIMARY_HOST: undefined })).toThrow();
    expect(() => loadPrimaryEndpoint({ ...base, TIMESCALE_DB: undefined })).toThrow();
    expect(() => loadPrimaryEndpoint({ ...base, TIMESCALE_USER: undefined })).toThrow();
    expect(() => loadPrimaryEndpoint({ ...base, TIMESCALE_PASSWORD: undefined })).toThrow();
  });

  it('rejects an invalid port', () => {
    expect(() => loadPrimaryEndpoint({ ...base, TIMESCALE_PRIMARY_PORT: '0' })).toThrow();
    expect(() => loadPrimaryEndpoint({ ...base, TIMESCALE_PRIMARY_PORT: 'abc' })).toThrow();
  });
});

describe('loadReplicaEndpoints', () => {
  const primary = loadPrimaryEndpoint(base);

  it('returns no replicas when the host list is empty/unset', () => {
    expect(loadReplicaEndpoints(primary, base)).toEqual([]);
    expect(loadReplicaEndpoints(primary, { ...base, TIMESCALE_REPLICA_HOSTS: '  ' })).toEqual([]);
  });

  it('parses a comma-separated host list inheriting primary credentials', () => {
    const replicas = loadReplicaEndpoints(primary, {
      ...base,
      TIMESCALE_REPLICA_HOSTS: 'r1.local, r2.local',
    });
    expect(replicas.map((r) => r.host)).toEqual(['r1.local', 'r2.local']);
    expect(replicas[0].database).toBe('cortisol');
    expect(replicas[0].user).toBe('svc');
    expect(replicas[0].ssl).toBe(true);
  });

  it('allows replica-specific credentials to override the primary', () => {
    const replicas = loadReplicaEndpoints(primary, {
      ...base,
      TIMESCALE_REPLICA_HOSTS: 'r1.local',
      TIMESCALE_REPLICA_USER: 'reader',
      TIMESCALE_REPLICA_PASSWORD: 'ro',
    });
    expect(replicas[0].user).toBe('reader');
    expect(replicas[0].password).toBe('ro');
  });
});

describe('loadTimescaleConfig', () => {
  it('assembles primary + replicas', () => {
    const config = loadTimescaleConfig({
      ...base,
      TIMESCALE_REPLICA_HOSTS: 'r1.local',
    });
    expect(config.primary.host).toBe('primary.local');
    expect(config.replicas).toHaveLength(1);
  });
});
