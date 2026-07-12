/**
 * Health-check downtime state machine and availability accounting (Task 16.9).
 *
 *  - Downtime state machine: a monitored service is recorded unavailable after
 *    3 consecutive failed 60s health checks (recording the downtime start) and
 *    available again after 3 consecutive successes (recording the downtime
 *    end); recorded downtime intervals are retained (Req 24.3, 24.4).
 *  - Availability accounting: accumulated downtime per calendar month is
 *    charged against the service class's budget (general 99.9% ≈ 43 min/month;
 *    lab ingestion 99.95% ≈ 21 min/month), raising an availability-breach alert
 *    to operators when the budget is exceeded (Req 24.5).
 *
 * The state machine and accounting are pure/deterministic (results fed as data,
 * clock injected); {@link HealthCheckMonitor} is an ergonomic stateful wrapper.
 */
export * from './constants';
export * from './state-machine';
export * from './accounting';
export * from './monitor';
