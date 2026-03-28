import { ConfigService, deepMerge } from '../config.js';
import { getGlobalConfig, saveGlobalConfig } from '../../repositories/admin/config-repository.js';

const LEGACY_PASSWORD_HASH_ALGORITHM = 'SHA-256';
const PASSWORD_DERIVATION_ALGORITHM = 'PBKDF2';
const PASSWORD_DERIVATION_HASH = 'SHA-256';
const PASSWORD_SALT_BYTE_LENGTH = 16;
const PASSWORD_HASH_ITERATIONS = 210000;
const PASSWORD_HASH_BIT_LENGTH = 256;
const textEncoder = new TextEncoder();

export function parseAdminPasswordHashIterations(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsedValue = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  return 0;
}

export function hasConfiguredLegacyAdminPassword(config) {
  const adminPassword = config?.adminPassword;
  return typeof adminPassword === 'string' && adminPassword.trim().length > 0;
}

export function hasConfiguredHashedAdminPassword(config) {
  const adminPasswordHash = config?.adminPasswordHash;
  const adminPasswordSalt = config?.adminPasswordSalt;

  return typeof adminPasswordHash === 'string'
    && adminPasswordHash.trim().length > 0
    && typeof adminPasswordSalt === 'string'
    && adminPasswordSalt.trim().length > 0;
}

export function hasConfiguredPbkdf2AdminPassword(config) {
  const adminPasswordHashIterations = parseAdminPasswordHashIterations(config?.adminPasswordHashIterations);
  return hasConfiguredHashedAdminPassword(config) && adminPasswordHashIterations > 0;
}

function hasConfiguredLegacySha256AdminPassword(config) {
  return hasConfiguredHashedAdminPassword(config) && !hasConfiguredPbkdf2AdminPassword(config);
}

export function normalizePersistedAdminCredentialFields(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  if (hasConfiguredPbkdf2AdminPassword(config)) {
    config.adminPassword = '';
    config.adminPasswordHashIterations = parseAdminPasswordHashIterations(config.adminPasswordHashIterations);
    return config;
  }

  if (hasConfiguredLegacyAdminPassword(config)) {
    delete config.adminPasswordHash;
    delete config.adminPasswordSalt;
    delete config.adminPasswordHashIterations;
    return config;
  }

  if (hasConfiguredLegacySha256AdminPassword(config)) {
    config.adminPassword = '';
    delete config.adminPasswordHashIterations;
    return config;
  }

  delete config.adminPasswordHash;
  delete config.adminPasswordSalt;
  delete config.adminPasswordHashIterations;
  return config;
}

export function hasConfiguredAdminPassword(config) {
  return hasConfiguredPbkdf2AdminPassword(config)
    || hasConfiguredLegacyAdminPassword(config)
    || hasConfiguredLegacySha256AdminPassword(config);
}

export function generateRandomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generatePasswordSalt(byteLength = PASSWORD_SALT_BYTE_LENGTH) {
  return generateRandomHex(byteLength);
}

export function normalizeAdminCredentials(config) {
  return {
    adminPassword: typeof config?.adminPassword === 'string' ? config.adminPassword.trim() : '',
    adminPasswordHash: typeof config?.adminPasswordHash === 'string' ? config.adminPasswordHash.trim() : '',
    adminPasswordSalt: typeof config?.adminPasswordSalt === 'string' ? config.adminPasswordSalt.trim() : '',
    adminPasswordHashIterations: parseAdminPasswordHashIterations(config?.adminPasswordHashIterations)
  };
}

export function getRuntimeAdminCredentials() {
  return normalizeAdminCredentials({
    adminPassword: ConfigService.get('adminPassword'),
    adminPasswordHash: ConfigService.get('adminPasswordHash'),
    adminPasswordSalt: ConfigService.get('adminPasswordSalt'),
    adminPasswordHashIterations: ConfigService.get('adminPasswordHashIterations')
  });
}

async function hashAdminPasswordWithLegacySha256(password, salt) {
  const normalizedPassword = typeof password === 'string' ? password.trim() : '';
  const normalizedSalt = typeof salt === 'string' ? salt.trim() : '';
  if (!normalizedPassword || !normalizedSalt) {
    return '';
  }

  const hashBuffer = await crypto.subtle.digest(
    LEGACY_PASSWORD_HASH_ALGORITHM,
    textEncoder.encode(`${normalizedSalt}:${normalizedPassword}`)
  );

  return Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashAdminPasswordWithPbkdf2(password, salt, iterations = PASSWORD_HASH_ITERATIONS) {
  const normalizedPassword = typeof password === 'string' ? password.trim() : '';
  const normalizedSalt = typeof salt === 'string' ? salt.trim() : '';
  const normalizedIterations = parseAdminPasswordHashIterations(iterations);

  if (!normalizedPassword || !normalizedSalt || normalizedIterations <= 0) {
    return '';
  }

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(normalizedPassword),
    { name: PASSWORD_DERIVATION_ALGORITHM },
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: PASSWORD_DERIVATION_ALGORITHM,
      salt: textEncoder.encode(normalizedSalt),
      iterations: normalizedIterations,
      hash: PASSWORD_DERIVATION_HASH
    },
    keyMaterial,
    PASSWORD_HASH_BIT_LENGTH
  );

  return Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildAdminPasswordCredentials(password) {
  const normalizedPassword = typeof password === 'string' ? password.trim() : '';
  if (!normalizedPassword) {
    throw new Error('Admin password is required.');
  }

  const adminPasswordSalt = generatePasswordSalt();
  const adminPasswordHashIterations = PASSWORD_HASH_ITERATIONS;
  const adminPasswordHash = await hashAdminPasswordWithPbkdf2(
    normalizedPassword,
    adminPasswordSalt,
    adminPasswordHashIterations
  );
  if (!adminPasswordHash) {
    throw new Error('Failed to generate admin password hash.');
  }

  return {
    adminPasswordHash,
    adminPasswordSalt,
    adminPasswordHashIterations,
    adminPassword: ''
  };
}

export function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export async function isValidAdminPassword(password, config) {
  const normalizedPassword = typeof password === 'string' ? password.trim() : '';
  if (!normalizedPassword) {
    return false;
  }

  const credentials = normalizeAdminCredentials(config);
  if (!hasConfiguredPbkdf2AdminPassword(credentials)) {
    return false;
  }

  const computedHash = await hashAdminPasswordWithPbkdf2(
    normalizedPassword,
    credentials.adminPasswordSalt,
    credentials.adminPasswordHashIterations
  );
  return Boolean(computedHash) && constantTimeCompare(computedHash, credentials.adminPasswordHash);
}

async function persistMigratedAdminPassword(oldConfig, password, logger, logMessage) {
  const passwordCredentials = await buildAdminPasswordCredentials(password);
  const mergedConfig = deepMerge({}, oldConfig, passwordCredentials);
  await saveGlobalConfig(mergedConfig);
  await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());
  logger.warn(logMessage, {}, { notify: true });
}

export async function migrateAdminPasswordStorageIfNeeded({ logger, loginPassword = '' }) {
  const runtimeCredentials = getRuntimeAdminCredentials();
  if (hasConfiguredPbkdf2AdminPassword(runtimeCredentials)) {
    return;
  }

  const oldConfig = await getGlobalConfig() || {};
  const storedCredentials = normalizeAdminCredentials(oldConfig);

  if (hasConfiguredPbkdf2AdminPassword(storedCredentials)) {
    await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());
    return;
  }

  if (hasConfiguredLegacyAdminPassword(storedCredentials)) {
    await persistMigratedAdminPassword(
      oldConfig,
      storedCredentials.adminPassword,
      logger,
      'Legacy plaintext admin password storage upgraded to PBKDF2 hash.'
    );
    return;
  }

  if (!hasConfiguredLegacySha256AdminPassword(storedCredentials)) {
    return;
  }

  const normalizedLoginPassword = typeof loginPassword === 'string' ? loginPassword.trim() : '';
  if (!normalizedLoginPassword) {
    return;
  }

  const legacyHash = await hashAdminPasswordWithLegacySha256(
    normalizedLoginPassword,
    storedCredentials.adminPasswordSalt
  );
  if (!legacyHash || !constantTimeCompare(legacyHash, storedCredentials.adminPasswordHash)) {
    return;
  }

  await persistMigratedAdminPassword(
    oldConfig,
    normalizedLoginPassword,
    logger,
    'Legacy SHA-256 admin password storage upgraded to PBKDF2 hash.'
  );
}
