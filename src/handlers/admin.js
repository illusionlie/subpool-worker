import { handleAdminRequest } from './admin/entry-controller.js';
import {
  parseAdminPasswordHashIterations,
  hasConfiguredLegacyAdminPassword,
  hasConfiguredHashedAdminPassword,
  hasConfiguredPbkdf2AdminPassword,
  hasConfiguredLegacySha256AdminPassword,
  getPersistedPasswordCredentialsState,
  normalizePersistedAdminCredentialFields,
  requiresAdminPasswordStorageUpgrade,
  normalizeAdminCredentials,
  hashAdminPasswordWithLegacySha256,
  hashAdminPasswordWithPbkdf2,
  buildAdminPasswordCredentials,
  isValidAdminPassword
} from '../services/admin/credential-service.js';
import { getBlockedLoginResponse } from './admin/public-controller.js';

export { handleAdminRequest };

export const __adminInternals = {
  parseAdminPasswordHashIterations,
  hasConfiguredLegacyAdminPassword,
  hasConfiguredHashedAdminPassword,
  hasConfiguredPbkdf2AdminPassword,
  hasConfiguredLegacySha256AdminPassword,
  getPersistedPasswordCredentialsState,
  normalizePersistedAdminCredentialFields,
  requiresAdminPasswordStorageUpgrade,
  normalizeAdminCredentials,
  hashAdminPasswordWithLegacySha256,
  hashAdminPasswordWithPbkdf2,
  buildAdminPasswordCredentials,
  isValidAdminPassword,
  getBlockedLoginResponse
};
