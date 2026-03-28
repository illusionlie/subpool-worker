import { handleAdminRequest } from './admin/entry-controller.js';
import {
  parseAdminPasswordHashIterations,
  hasConfiguredLegacyAdminPassword,
  hasConfiguredHashedAdminPassword,
  hasConfiguredPbkdf2AdminPassword,
  normalizePersistedAdminCredentialFields,
  normalizeAdminCredentials,
  hashAdminPasswordWithPbkdf2,
  buildAdminPasswordCredentials,
  isValidAdminPassword,
  migrateAdminPasswordStorageIfNeeded
} from '../services/admin/credential-service.js';
import { getBlockedLoginResponse } from './admin/public-controller.js';

export { handleAdminRequest };

export const __adminInternals = {
  parseAdminPasswordHashIterations,
  hasConfiguredLegacyAdminPassword,
  hasConfiguredHashedAdminPassword,
  hasConfiguredPbkdf2AdminPassword,
  normalizePersistedAdminCredentialFields,
  normalizeAdminCredentials,
  hashAdminPasswordWithPbkdf2,
  buildAdminPasswordCredentials,
  isValidAdminPassword,
  migrateAdminPasswordStorageIfNeeded,
  getBlockedLoginResponse
};
