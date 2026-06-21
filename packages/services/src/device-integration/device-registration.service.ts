/**
 * Device Registration Service
 * Manages device registration, deregistration, and device queries.
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */

import type {
  DeviceRegistryEntry,
  DeviceRegistrationRequest,
  DeviceType,
} from './device-integration.types';
import { DeviceConflictError, UnauthorizedDeviceError } from './device-integration.errors';

// ─── Repository Interface ──────────────────────────────────────────────────────

/**
 * Repository interface for DeviceRegistry persistence.
 * Implementations can be in-memory (testing) or database-backed (production).
 */
export interface DeviceRepository {
  findById(id: string): Promise<DeviceRegistryEntry | null>;
  findBySerialNumber(serialNumber: string): Promise<DeviceRegistryEntry | null>;
  findBySeniorId(seniorId: string): Promise<DeviceRegistryEntry[]>;
  create(entry: DeviceRegistryEntry): Promise<DeviceRegistryEntry>;
  update(entry: DeviceRegistryEntry): Promise<DeviceRegistryEntry>;
}

// ─── In-Memory Repository ──────────────────────────────────────────────────────

/**
 * In-memory implementation of DeviceRepository.
 * Suitable for development and testing; replace with database-backed
 * implementation for production.
 */
export class InMemoryDeviceRepository implements DeviceRepository {
  private devices: DeviceRegistryEntry[] = [];

  async findById(id: string): Promise<DeviceRegistryEntry | null> {
    return this.devices.find((d) => d.id === id) ?? null;
  }

  async findBySerialNumber(serialNumber: string): Promise<DeviceRegistryEntry | null> {
    return this.devices.find((d) => d.serialNumber === serialNumber) ?? null;
  }

  async findBySeniorId(seniorId: string): Promise<DeviceRegistryEntry[]> {
    return this.devices.filter((d) => d.seniorId === seniorId);
  }

  async create(entry: DeviceRegistryEntry): Promise<DeviceRegistryEntry> {
    this.devices.push(entry);
    return entry;
  }

  async update(entry: DeviceRegistryEntry): Promise<DeviceRegistryEntry> {
    const index = this.devices.findIndex((d) => d.id === entry.id);
    if (index === -1) {
      throw new Error(`Device not found: ${entry.id}`);
    }
    this.devices[index] = entry;
    return entry;
  }

  /** Utility for testing: clear all stored devices */
  clear(): void {
    this.devices = [];
  }
}

// ─── Service Dependencies ──────────────────────────────────────────────────────

export interface DeviceRegistrationDependencies {
  repository: DeviceRepository;
  idGenerator: () => string;
  dateProvider: () => Date;
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `DEV_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

// ─── Supported Device Types ────────────────────────────────────────────────────

const SUPPORTED_DEVICE_TYPES: DeviceType[] = [
  'blood_pressure_monitor',
  'glucometer',
  'pulse_oximeter',
  'thermometer',
  'weight_scale',
];

// ─── Service Implementation ────────────────────────────────────────────────────

/**
 * DeviceRegistrationService implementation.
 *
 * Uses dependency injection for ID generation, date provision, and repository
 * access to support testability.
 */
export class DeviceRegistrationService {
  private readonly repository: DeviceRepository;
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;

  constructor(deps?: Partial<DeviceRegistrationDependencies>) {
    this.repository = deps?.repository ?? new InMemoryDeviceRepository();
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
  }

  /**
   * Register a new device and link it to a Senior.
   *
   * Requirement 1.1: Create a DeviceRegistry entry linking the device to the specified Senior.
   * Requirement 1.2: Support all 5 device types.
   * Requirement 1.3: Reject if serial number already registered to a different Senior.
   * Requirement 1.5: Store device ID, serial number, device type, Senior ID,
   *   registration date, connection protocol, and active status.
   *
   * @throws DeviceConflictError when serial number is already registered
   */
  async registerDevice(request: DeviceRegistrationRequest): Promise<DeviceRegistryEntry> {
    // Validate required fields
    this.validateRegistrationRequest(request);

    // Check serial number uniqueness (Req 1.3)
    const existing = await this.repository.findBySerialNumber(request.serialNumber);
    if (existing) {
      throw new DeviceConflictError(request.serialNumber, existing.seniorId);
    }

    // Create DeviceRegistry entry (Req 1.1, 1.5)
    const entry: DeviceRegistryEntry = {
      id: this.idGenerator(),
      serialNumber: request.serialNumber,
      deviceType: request.deviceType,
      seniorId: request.seniorId,
      registrationDate: this.dateProvider(),
      connectionProtocol: request.connectionProtocol,
      isActive: true,
      lastSyncTimestamp: null,
    };

    return this.repository.create(entry);
  }

  /**
   * Deregister a device by marking it as inactive.
   *
   * Requirement 1.4: Mark the device as inactive and stop accepting readings.
   *
   * @throws UnauthorizedDeviceError when device is not found
   */
  async deregisterDevice(deviceId: string): Promise<void> {
    const device = await this.repository.findById(deviceId);
    if (!device) {
      throw new UnauthorizedDeviceError(deviceId);
    }

    const updated: DeviceRegistryEntry = {
      ...device,
      isActive: false,
    };

    await this.repository.update(updated);
  }

  /**
   * Retrieve a device by its ID.
   *
   * @returns The device entry, or null if not found
   */
  async getDevice(deviceId: string): Promise<DeviceRegistryEntry | null> {
    return this.repository.findById(deviceId);
  }

  /**
   * Retrieve all devices registered to a specific Senior.
   *
   * @returns Array of device entries for the given Senior
   */
  async getDevicesBySenior(seniorId: string): Promise<DeviceRegistryEntry[]> {
    return this.repository.findBySeniorId(seniorId);
  }

  /**
   * Validate the registration request contains all required fields with valid values.
   */
  private validateRegistrationRequest(request: DeviceRegistrationRequest): void {
    if (!request.serialNumber || request.serialNumber.trim() === '') {
      throw new Error('Serial number is required.');
    }

    if (!request.seniorId || request.seniorId.trim() === '') {
      throw new Error('Senior ID is required.');
    }

    if (!SUPPORTED_DEVICE_TYPES.includes(request.deviceType)) {
      throw new Error(
        `Invalid device type "${request.deviceType}". Supported types: ${SUPPORTED_DEVICE_TYPES.join(', ')}`
      );
    }

    if (request.connectionProtocol !== 'bluetooth' && request.connectionProtocol !== 'wifi') {
      throw new Error(
        `Invalid connection protocol "${request.connectionProtocol}". Must be "bluetooth" or "wifi".`
      );
    }
  }
}
