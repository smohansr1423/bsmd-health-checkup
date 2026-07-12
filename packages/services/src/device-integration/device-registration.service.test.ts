/**
 * Device Registration Service — Unit Tests (Edge Cases)
 * Tests device type coverage, connection protocols, conflict handling,
 * and deregistration behavior.
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 */

import {
  DeviceRegistrationService,
  InMemoryDeviceRepository,
} from './device-registration.service';
import { DeviceConflictError, UnauthorizedDeviceError } from './device-integration.errors';
import type { DeviceRegistrationRequest, DeviceType } from './device-integration.types';

describe('DeviceRegistrationService', () => {
  let repository: InMemoryDeviceRepository;
  let service: DeviceRegistrationService;
  let idCounter: number;

  beforeEach(() => {
    repository = new InMemoryDeviceRepository();
    idCounter = 0;
    service = new DeviceRegistrationService({
      repository,
      idGenerator: () => `DEV_TEST_${++idCounter}`,
      dateProvider: () => new Date('2024-01-15T10:00:00Z'),
    });
  });

  const baseRequest: DeviceRegistrationRequest = {
    serialNumber: 'SN-0001',
    deviceType: 'blood_pressure_monitor',
    seniorId: 'SENIOR_1',
    connectionProtocol: 'bluetooth',
  };

  // ─── Requirement 1.2: All 5 device types register successfully ───────────────

  describe('device type coverage (Requirement 1.2)', () => {
    const deviceTypes: DeviceType[] = [
      'blood_pressure_monitor',
      'glucometer',
      'pulse_oximeter',
      'thermometer',
      'weight_scale',
    ];

    it.each(deviceTypes)('should register device type "%s" successfully', async (deviceType) => {
      const result = await service.registerDevice({
        ...baseRequest,
        serialNumber: `SN-${deviceType}`,
        deviceType,
      });

      expect(result.deviceType).toBe(deviceType);
      expect(result.isActive).toBe(true);
      expect(result.lastSyncTimestamp).toBeNull();
      expect(result.serialNumber).toBe(`SN-${deviceType}`);
      expect(result.seniorId).toBe('SENIOR_1');
      expect(result.registrationDate).toEqual(new Date('2024-01-15T10:00:00Z'));
    });

    it('should register all 5 device types to the same senior', async () => {
      for (const deviceType of deviceTypes) {
        await service.registerDevice({
          ...baseRequest,
          serialNumber: `SN-${deviceType}`,
          deviceType,
        });
      }

      const devices = await service.getDevicesBySenior('SENIOR_1');
      expect(devices).toHaveLength(5);
      expect(devices.map((d) => d.deviceType).sort()).toEqual([...deviceTypes].sort());
    });

    it('should reject an unsupported device type', async () => {
      await expect(
        service.registerDevice({
          ...baseRequest,
          deviceType: 'smart_watch' as DeviceType,
        })
      ).rejects.toThrow(/Invalid device type/);
    });
  });

  // ─── Requirement 1.5: Both connection protocols supported ────────────────────

  describe('connection protocols', () => {
    it('should register a device using the bluetooth protocol', async () => {
      const result = await service.registerDevice({
        ...baseRequest,
        serialNumber: 'SN-BT',
        connectionProtocol: 'bluetooth',
      });

      expect(result.connectionProtocol).toBe('bluetooth');
    });

    it('should register a device using the wifi protocol', async () => {
      const result = await service.registerDevice({
        ...baseRequest,
        serialNumber: 'SN-WIFI',
        connectionProtocol: 'wifi',
      });

      expect(result.connectionProtocol).toBe('wifi');
    });

    it('should reject an invalid connection protocol', async () => {
      await expect(
        service.registerDevice({
          ...baseRequest,
          connectionProtocol: 'zigbee' as 'bluetooth' | 'wifi',
        })
      ).rejects.toThrow(/Invalid connection protocol/);
    });
  });

  // ─── Requirement 1.1: Successful registration ────────────────────────────────

  describe('registerDevice() (Requirement 1.1)', () => {
    it('should create a registry entry linking the device to the senior', async () => {
      const result = await service.registerDevice(baseRequest);

      expect(result.id).toBe('DEV_TEST_1');
      expect(result.seniorId).toBe('SENIOR_1');
      expect(result.serialNumber).toBe('SN-0001');
    });

    it('should reject registration with a missing serial number', async () => {
      await expect(
        service.registerDevice({ ...baseRequest, serialNumber: '' })
      ).rejects.toThrow(/Serial number is required/);
    });

    it('should reject registration with a missing senior ID', async () => {
      await expect(
        service.registerDevice({ ...baseRequest, seniorId: '' })
      ).rejects.toThrow(/Senior ID is required/);
    });
  });

  // ─── Requirement 1.3: Conflict on duplicate serial number ────────────────────

  describe('serial number conflict (Requirement 1.3)', () => {
    it('should throw DeviceConflictError when serial is registered to a different senior', async () => {
      await service.registerDevice(baseRequest);

      await expect(
        service.registerDevice({
          ...baseRequest,
          seniorId: 'SENIOR_2',
        })
      ).rejects.toThrow(DeviceConflictError);
    });

    it('should include the existing senior ID in the conflict error', async () => {
      await service.registerDevice(baseRequest);

      try {
        await service.registerDevice({ ...baseRequest, seniorId: 'SENIOR_2' });
        fail('Expected DeviceConflictError');
      } catch (error) {
        expect(error).toBeInstanceOf(DeviceConflictError);
        expect((error as DeviceConflictError).existingSeniorId).toBe('SENIOR_1');
        expect((error as DeviceConflictError).serialNumber).toBe('SN-0001');
      }
    });

    it('should reject a duplicate serial number even for the same senior', async () => {
      await service.registerDevice(baseRequest);

      await expect(service.registerDevice(baseRequest)).rejects.toThrow(DeviceConflictError);
    });
  });

  // ─── Requirement 1.4: Deregistration ─────────────────────────────────────────

  describe('deregisterDevice() (Requirement 1.4)', () => {
    it('should set isActive=false on deregistration', async () => {
      const device = await service.registerDevice(baseRequest);
      expect(device.isActive).toBe(true);

      await service.deregisterDevice(device.id);

      const updated = await service.getDevice(device.id);
      expect(updated).not.toBeNull();
      expect(updated!.isActive).toBe(false);
    });

    it('should preserve all other fields when deregistering', async () => {
      const device = await service.registerDevice(baseRequest);

      await service.deregisterDevice(device.id);

      const updated = await service.getDevice(device.id);
      expect(updated!.serialNumber).toBe(device.serialNumber);
      expect(updated!.deviceType).toBe(device.deviceType);
      expect(updated!.seniorId).toBe(device.seniorId);
      expect(updated!.connectionProtocol).toBe(device.connectionProtocol);
    });

    it('should throw UnauthorizedDeviceError when deregistering an unknown device', async () => {
      await expect(service.deregisterDevice('NON_EXISTENT')).rejects.toThrow(
        UnauthorizedDeviceError
      );
    });
  });

  // ─── Query methods ───────────────────────────────────────────────────────────

  describe('query methods', () => {
    it('should return null for an unknown device ID', async () => {
      const found = await service.getDevice('NON_EXISTENT');
      expect(found).toBeNull();
    });

    it('should return an empty array for a senior with no devices', async () => {
      const devices = await service.getDevicesBySenior('SENIOR_UNKNOWN');
      expect(devices).toEqual([]);
    });
  });
});
