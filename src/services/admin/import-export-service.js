import { deepMerge } from '../config.js';
import { normalizeGroupToken, isValidGroupToken } from '../group-token.js';
import { getGlobalConfig } from '../../repositories/admin/config-repository.js';
import { getAllGroups, saveGroup, deleteGroup } from '../../repositories/admin/group-repository.js';
import {
  normalizePersistedAdminCredentialFields,
  hasConfiguredAdminPassword
} from './credential-service.js';
import { hasConfiguredJwtSecret, generateJwtSecret } from './session-service.js';

export const ADMIN_DATA_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeConfigForResponse(config) {
  const safeConfig = { ...(config || {}) };
  delete safeConfig.adminPassword;
  delete safeConfig.adminPasswordHash;
  delete safeConfig.adminPasswordSalt;
  delete safeConfig.adminPasswordHashIterations;
  delete safeConfig.jwtSecret;
  delete safeConfig.blockBots;
  return safeConfig;
}

export function sanitizeConfigForImport(config) {
  const sanitizedConfig = { ...(config || {}) };
  delete sanitizedConfig.adminPassword;
  delete sanitizedConfig.adminPasswordHash;
  delete sanitizedConfig.adminPasswordSalt;
  delete sanitizedConfig.adminPasswordHashIterations;
  delete sanitizedConfig.jwtSecret;
  delete sanitizedConfig.blockBots;
  return sanitizedConfig;
}

function normalizeGroupFilterForImport(filter, groupIndex) {
  if (filter === undefined) {
    return {
      enabled: false,
      rules: []
    };
  }

  if (!isPlainObject(filter)) {
    throw new Error(`Invalid filter for group at index ${groupIndex}.`);
  }

  const rawRules = filter.rules;
  if (rawRules !== undefined && !Array.isArray(rawRules)) {
    throw new Error(`Invalid filter rules for group at index ${groupIndex}.`);
  }

  const normalizedRules = (rawRules || []).map((rule, ruleIndex) => {
    if (typeof rule !== 'string') {
      throw new Error(`Invalid filter rule at group index ${groupIndex}, rule index ${ruleIndex}.`);
    }

    return rule;
  });

  return deepMerge({}, filter, {
    enabled: Boolean(filter.enabled),
    rules: normalizedRules
  });
}

function normalizeGroupForImport(rawGroup, groupIndex) {
  if (!isPlainObject(rawGroup)) {
    throw new Error(`Invalid group at index ${groupIndex}.`);
  }

  const name = typeof rawGroup.name === 'string' ? rawGroup.name.trim() : '';
  const token = normalizeGroupToken(rawGroup.token);

  if (!name) {
    throw new Error(`Group name is required at index ${groupIndex}.`);
  }

  if (!isValidGroupToken(token)) {
    throw new Error(`Invalid token for group at index ${groupIndex}.`);
  }

  const nodes = typeof rawGroup.nodes === 'string' ? rawGroup.nodes : '';

  return deepMerge({}, rawGroup, {
    name,
    token,
    nodes,
    allowChinaAccess: Boolean(rawGroup.allowChinaAccess),
    filter: normalizeGroupFilterForImport(rawGroup.filter, groupIndex)
  });
}

export function normalizeImportPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error('Invalid import payload. Expected a JSON object.');
  }

  const schemaVersion = payload.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== ADMIN_DATA_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${schemaVersion}.`);
  }

  if (!isPlainObject(payload.config)) {
    throw new Error('Invalid import payload. "config" must be an object.');
  }

  if (!Array.isArray(payload.groups)) {
    throw new Error('Invalid import payload. "groups" must be an array.');
  }

  const normalizedGroups = payload.groups.map((group, index) => normalizeGroupForImport(group, index));
  const tokenSet = new Set();

  for (const group of normalizedGroups) {
    if (tokenSet.has(group.token)) {
      throw new Error(`Duplicated group token: ${group.token}.`);
    }

    tokenSet.add(group.token);
  }

  return {
    importedConfig: sanitizeConfigForImport(payload.config),
    importedGroups: normalizedGroups
  };
}

export async function buildMergedConfigForImport(importedConfig) {
  const currentConfig = await getGlobalConfig() || {};
  const mergedConfig = normalizePersistedAdminCredentialFields(
    deepMerge({}, currentConfig, importedConfig)
  );

  if (Object.hasOwn(mergedConfig, 'blockBots')) {
    delete mergedConfig.blockBots;
  }

  if (hasConfiguredAdminPassword(mergedConfig) && !hasConfiguredJwtSecret(mergedConfig)) {
    mergedConfig.jwtSecret = generateJwtSecret();
  }

  return mergedConfig;
}

export async function syncImportedGroups(importedGroups, logger) {
  const existingGroups = await getAllGroups();
  const existingGroupMap = new Map();

  for (const group of existingGroups) {
    if (!group || typeof group.token !== 'string') {
      continue;
    }

    const normalizedToken = group.token.trim();
    if (!normalizedToken) {
      continue;
    }

    existingGroupMap.set(normalizedToken, group);
  }

  const existingTokens = new Set(existingGroupMap.keys());
  const importedTokens = new Set(importedGroups.map(group => group.token));
  const importedOnlyTokens = [...importedTokens].filter(token => !existingTokens.has(token));

  const rollbackGroups = async () => {
    for (const group of existingGroupMap.values()) {
      await saveGroup(group);
    }

    for (const token of importedOnlyTokens) {
      await deleteGroup(token);
    }
  };

  try {
    for (const group of importedGroups) {
      await saveGroup(group);
    }

    for (const token of existingTokens) {
      if (!importedTokens.has(token)) {
        await deleteGroup(token);
      }
    }
  } catch (err) {
    try {
      await rollbackGroups();
    } catch (rollbackErr) {
      if (logger && typeof logger.error === 'function') {
        logger.error(rollbackErr, { customMessage: 'Failed to rollback groups after import synchronization error.' });
      }
    }

    throw err;
  }
}
