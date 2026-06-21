/**
 * Role-Based Access Control (RBAC)
 * Defines permissions for each role and provides authorization logic.
 * Validates: Requirements 18.1, 18.7
 *
 * Roles:
 * - Administrator: full system access including user management
 * - Physician: read/write access to Health_Profiles, Health_Reports, Test_Results for assigned patients
 * - Lab_Technician: read/write access to Test_Results only
 * - Senior_Citizen: read-only access to own Health_Profile, Health_Reports, Test_Results
 * - Caregiver: read-only access to assigned Senior_Citizen's data
 */

import type { Role, Action, Resource } from './auth.types';

/** Permission definition: which actions are allowed on which resources */
export interface Permission {
  resource: Resource;
  actions: Action[];
}

/** Complete permission map per role */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Administrator: [
    { resource: 'health_profile', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'health_report', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'test_result', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'appointment', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'follow_up', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'invoice', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'payment', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'insurance_claim', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'checkup_package', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'physician_registry', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'user_management', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'analytics', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'notification', actions: ['read', 'write', 'delete', 'manage'] },
    { resource: 'system_config', actions: ['read', 'write', 'delete', 'manage'] },
  ],

  Physician: [
    { resource: 'health_profile', actions: ['read', 'write'] },
    { resource: 'health_report', actions: ['read', 'write'] },
    { resource: 'test_result', actions: ['read', 'write'] },
    { resource: 'appointment', actions: ['read', 'write'] },
    { resource: 'follow_up', actions: ['read', 'write'] },
    { resource: 'analytics', actions: ['read'] },
    { resource: 'notification', actions: ['read'] },
  ],

  Lab_Technician: [
    { resource: 'test_result', actions: ['read', 'write'] },
  ],

  Senior_Citizen: [
    { resource: 'health_profile', actions: ['read'] },
    { resource: 'health_report', actions: ['read'] },
    { resource: 'test_result', actions: ['read'] },
    { resource: 'appointment', actions: ['read', 'write'] },
    { resource: 'invoice', actions: ['read'] },
    { resource: 'payment', actions: ['read', 'write'] },
    { resource: 'notification', actions: ['read'] },
  ],

  Caregiver: [
    { resource: 'health_profile', actions: ['read'] },
    { resource: 'health_report', actions: ['read'] },
    { resource: 'test_result', actions: ['read'] },
    { resource: 'appointment', actions: ['read', 'write'] },
    { resource: 'notification', actions: ['read'] },
  ],
};

/**
 * Check whether a role has permission to perform an action on a resource.
 */
export function hasPermission(role: Role, resource: string, action: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) {
    return false;
  }

  return permissions.some(
    (perm) => perm.resource === resource && perm.actions.includes(action as Action)
  );
}

/**
 * Get all permissions for a given role.
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Get all roles that have a specific permission.
 */
export function getRolesWithPermission(resource: Resource, action: Action): Role[] {
  const roles: Role[] = [];
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    if (permissions.some((p) => p.resource === resource && p.actions.includes(action))) {
      roles.push(role as Role);
    }
  }
  return roles;
}
