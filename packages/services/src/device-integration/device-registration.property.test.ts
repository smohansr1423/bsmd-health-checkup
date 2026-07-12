/**
 * Device Registration Service — Property-Based Tests
 * Uses fast-check to validate universal correctness properties from the design document.
 *
 * Feature: daily-health-device-readings
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5
 */

import * as fc from 'fast-check';

import {
  DeviceRegistrationService,
  InMemoryDeviceRepository,
} from './device-registration.service';
import {
  DeviceIntegrationService,
  InMemoryHealthReadingRepository,
  InMemoryDailyHealthRecordRepository,
} from './device-integration.service';
import { DeviceConflictError, UnauthorizedDeviceError } from './device-integration.errors';
import type {
  DeviceRegistrationRequest,
  DeviceType,
  HealthReadingRequest,
} from './device-integration.types';

// ─── Arbitraries ────────────────────────────────────────────────────────────────

const deviceTypeArb: fc.Arbitrary<DeviceType> = fc.constantFrom(
  'blood_pressure_monitor',
  'glucometer',
  'pulse_oximeter',
  'thermometer',
  'weight_scale'
);

const connectionProtocolArb: fc.Arbitrary<'bluetooth' | 'wifi'> = fc.constantFrom(
  'bluetooth',
  'wifi'
);

/** Non-empty identifier string (serial numbers / senior IDs) */
const nonEmptyIdArb = (): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength: 24 })
    .filter((s) => s.trim().length > 0);

const registrationRequestArb: fc.Arbitrary<DeviceRegistrationRequest> = fc.record({
  serialNumber: nonEmptyIdArb(),
  deviceType: deviceTypeArb,
  seniorId: nonEmptyIdArb(),
  connectionProtocol: connectionProtocolArb,
});

/**
 * Build a fresh DeviceRegistrationService with an isolated in-memory repository
 * and a deterministic, monotonically increasing ID generator.
 */
function makeRegistrationService(): {
  service: DeviceRegistrationService;
  repository: InMemoryDeviceRepository;
} {
  const repository = new InMemoryDeviceRepository();
  let counter = 0;
  const service = new DeviceRegistrationService({
    repository,
    idGenerator: () => `DEV_TEST_${++counter}`,
    dateProvider: () => new Date('2024-06-01T09:00:00.000Z'),
  });
  return { service, repository };
}

// ─── Property 1 ──────────────────────────────────────────────────────────────────

describe('Property 1: Device registration produces a complete registry entry', () => {
  // Feature: daily-health-device-readings, Property 1: For any valid device
  // registration request, the service creates a Device Registry entry containing
  // all input fields plus a system-generated ID, registration date, active status
  // set to true, and null last-sync timestamp.
  // Validates: Requirements 1.1, 1.5
  it('creates an entry with all input fields plus generated defaults', async () => {
    await fc.assert(
      fc.asyncProperty(registrationRequestArb, async (request) => {
        const { service } = makeRegistrationService();

        const entry = await service.registerDevice(request);

        // Input fields preserved
        expect(entry.serialNumber).toBe(request.serialNumber);
        expect(entry.deviceType).toBe(request.deviceType);
        expect(entry.seniorId).toBe(request.seniorId);
        expect(entry.connectionProtocol).toBe(request.connectionProtocol);

        // System-generated fields
        expect(typeof entry.id).toBe('string');
        expect(entry.id.length).toBeGreaterThan(0);
        expect(entry.registrationDate).toBeInstanceOf(Date);
        expect(entry.isActive).toBe(true);
        expect(entry.lastSyncTimestamp).toBeNull();

        // The entry is retrievable and identical to what was returned
        const stored = await service.getDevice(entry.id);
        expect(stored).toEqual(entry);
      })
    );
  });
});

// ─── Property 2 ──────────────────────────────────────────────────────────────────

describe('Property 2: Device serial number uniqueness across seniors', () => {
  // Feature: daily-health-device-readings, Property 2: A serial number already
  // registered to one Senior cannot be registered to a different Senior (conflict
  // error), and cannot be re-registered to the same Senior either (no duplicates).
  // Validates: Requirements 1.3
  it('rejects duplicate serial numbers for a different senior', async () => {
    await fc.assert(
      fc.asyncProperty(
        registrationRequestArb,
        nonEmptyIdArb(),
        async (request, otherSeniorId) => {
          // Ensure the second senior is genuinely different
          fc.pre(otherSeniorId !== request.seniorId);

          const { service } = makeRegistrationService();

          await service.registerDevice(request);

          const conflicting: DeviceRegistrationRequest = {
            ...request,
            seniorId: otherSeniorId,
          };

          await expect(service.registerDevice(conflicting)).rejects.toBeInstanceOf(
            DeviceConflictError
          );
        }
      )
    );
  });

  it('rejects re-registering the same serial number to the same senior', async () => {
    await fc.assert(
      fc.asyncProperty(registrationRequestArb, async (request) => {
        const { service } = makeRegistrationService();

        await service.registerDevice(request);

        // Re-registering the identical request (same serial, same senior) is rejected
        await expect(service.registerDevice({ ...request })).rejects.toBeInstanceOf(
          DeviceConflictError
        );
      })
    );
  });
});

// ─── Property 3 ──────────────────────────────────────────────────────────────────

describe('Property 3: Deregistered devices reject subsequent readings', () => {
  // Feature: daily-health-device-readings, Property 3: A registered device that is
  // subsequently deregistered is marked inactive, and any reading submitted from
  // that device is rejected with an unauthorized error.
  // Validates: Requirements 1.4, 2.3
  it('marks device inactive and rejects readings after deregistration', async () => {
    await fc.assert(
      fc.asyncProperty(registrationRequestArb, async (request) => {
        const deviceRepository = new InMemoryDeviceRepository();
        let counter = 0;
        const fixedDate = new Date('2024-06-01T09:00:00.000Z');

        const registrationService = new DeviceRegistrationService({
          repository: deviceRepository,
          idGenerator: () => `DEV_TEST_${++counter}`,
          dateProvider: () => fixedDate,
        });

        // Register then deregister the device
        const entry = await registrationService.registerDevice(request);
        await registrationService.deregisterDevice(entry.id);

        // Device is marked inactive (Req 1.4)
        const afterDeregister = await registrationService.getDevice(entry.id);
        expect(afterDeregister).not.toBeNull();
        expect(afterDeregister!.isActive).toBe(false);

        // A reading from the deregistered device is rejected (Req 2.3)
        const integrationService = new DeviceIntegrationService({
          deviceRepository,
          readingRepository: new InMemoryHealthReadingRepository(),
          dailyRecordRepository: new InMemoryDailyHealthRecordRepository(),
          idGenerator: () => `RDG_TEST_${++counter}`,
          dateProvider: () => fixedDate,
        });

        const reading: HealthReadingRequest = {
          deviceId: entry.id,
          timestamp: fixedDate.toISOString(),
          readingType: 'heart_rate',
          measuredValue: 72,
          unit: 'bpm',
        };

        await expect(integrationService.ingestReading(reading)).rejects.toBeInstanceOf(
          UnauthorizedDeviceError
        );
      })
    );
  });
});
