import { ConfigService, deepMerge } from '../../services/config.js';
import { response } from '../../utils.js';
import { createJwt, createAuthCookie } from '../../services/auth.js';
import { getGlobalConfig, saveGlobalConfig } from '../../repositories/admin/config-repository.js';
import {
  getFailedAttempts,
  saveFailedAttempts,
  getBannedState,
  saveBannedState
} from '../../repositories/admin/login-attempt-repository.js';
import { getInitLock, saveInitLock } from '../../repositories/admin/init-lock-repository.js';
import {
  parseAdminPasswordHashIterations,
  hasConfiguredPbkdf2AdminPassword,
  hasConfiguredAdminPassword,
  getRuntimeAdminCredentials,
  buildAdminPasswordCredentials,
  isValidAdminPassword,
  migrateLegacyAdminPasswordStorageIfNeeded,
  constantTimeCompare
} from '../../services/admin/credential-service.js';
import {
  hasConfiguredJwtSecret,
  getJwtSecretFromConfig,
  generateJwtSecret,
  getOrCreateJwtSecretForInitializedAdmin
} from '../../services/admin/session-service.js';
import { Router } from 'itty-router';

const INIT_LOCK_TTL_SECONDS = 60;
const INIT_LOCK_MAX_RETRIES = 5;
const INIT_LOCK_RETRY_DELAY_MS = 120;

export function isAdminInitialized() {
  return hasConfiguredAdminPassword(getRuntimeAdminCredentials());
}

export function isInitSecretConfigured() {
  const initSecret = ConfigService.getEnv().INIT_SECRET;
  return typeof initSecret === 'string' && initSecret.trim().length > 0;
}

function getRequestInitSecret(request, payload) {
  const headerSecret = request.headers.get('X-Init-Secret');
  if (typeof headerSecret === 'string' && headerSecret.trim()) {
    return headerSecret.trim();
  }

  return typeof payload?.initSecret === 'string' ? payload.initSecret.trim() : '';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireInitializationLock(lockOwner, logger) {
  for (let attempt = 0; attempt < INIT_LOCK_MAX_RETRIES; attempt += 1) {
    const now = Date.now();
    const existingLock = await getInitLock();

    if (!existingLock || typeof existingLock.expiresAt !== 'number' || existingLock.expiresAt <= now) {
      const lockPayload = { owner: lockOwner, expiresAt: now + INIT_LOCK_TTL_SECONDS * 1000 };
      await saveInitLock(lockPayload, INIT_LOCK_TTL_SECONDS);

      const confirmedLock = await getInitLock();
      if (confirmedLock?.owner === lockOwner) {
        return true;
      }
    }

    if (attempt < INIT_LOCK_MAX_RETRIES - 1) {
      await wait(INIT_LOCK_RETRY_DELAY_MS);
    }
  }

  logger.warn('Failed to acquire admin initialization lock due to concurrent setup attempts.');
  return false;
}

async function releaseInitializationLock(lockOwner, logger) {
  try {
    const existingLock = await getInitLock();
    if (existingLock?.owner === lockOwner) {
      await saveInitLock({ owner: 'released', releasedAt: Date.now() }, 1);
    }
  } catch (err) {
    logger.error(err, { customMessage: 'Failed to release admin initialization lock' });
  }
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getLoginRequestIp(request) {
  if (!request || !request.headers) {
    return 'unknown';
  }

  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

export async function getBlockedLoginResponse(request, failedBan, logger) {
  if (!failedBan?.enabled) {
    return null;
  }

  const ip = getLoginRequestIp(request);

  const banned = await getBannedState(ip);
  if (banned) {
    logger.warn('Banned IP attempted login', {}, { notify: true });
    return response.json({ error: 'Too many failed attempts, please try again later.' }, 429);
  }

  return null;
}

async function recordFailedLoginAttempt(request, failedBan, logger) {
  if (!failedBan?.enabled) {
    return null;
  }

  const ip = getLoginRequestIp(request);
  const attempts = await getFailedAttempts(ip) || 0;
  const nextAttempts = attempts + 1;

  await saveFailedAttempts(ip, nextAttempts, failedBan.failedAttemptsTtl);

  if (nextAttempts >= failedBan.maxAttempts) {
    await saveBannedState(ip, true, failedBan.banDuration);
    logger.warn('Banned IP attempted login', {}, { notify: true });
    return response.json({ error: 'Too many failed attempts, please try again later.' }, 429);
  }

  return null;
}

async function handleLogin(request, logger) {
  const payload = await readJsonBody(request);
  const password = typeof payload?.password === 'string' ? payload.password.trim() : '';
  const adminCredentials = getRuntimeAdminCredentials();
  const jwtSecret = await getOrCreateJwtSecretForInitializedAdmin(logger);
  const failedBan = ConfigService.get('failedBan');

  if (!isAdminInitialized()) {
    logger.warn('Login attempted before admin initialization.');
    return response.json({ error: 'Admin is not initialized. Please complete initial setup first.' }, 403);
  }

  if (!jwtSecret) {
    logger.fatal('JWT secret is not set on server.');
    return response.json({ error: 'JWT secret is not set on server.' }, 500);
  }

  if (!password) {
    return response.json({ error: 'Password is required.' }, 400);
  }

  const blockedLoginResponse = await getBlockedLoginResponse(request, failedBan, logger);
  if (blockedLoginResponse) {
    return blockedLoginResponse;
  }

  let passwordMatched;
  try {
    passwordMatched = await isValidAdminPassword(password, adminCredentials);
  } catch (err) {
    logger.error(err, { customMessage: 'Failed to validate admin password hash during login.' });
    return response.json({ error: 'Failed to validate password.' }, 500);
  }

  if (passwordMatched) {
    await migrateLegacyAdminPasswordStorageIfNeeded(password, logger);
    const token = await createJwt(jwtSecret, {}, logger);
    const cookie = createAuthCookie(token, 8 * 60 * 60);
    logger.info('Admin logged in', {}, { notify: true });
    return response.json({ success: true }, 200, { 'Set-Cookie': cookie });
  }

  const failedAttemptResponse = await recordFailedLoginAttempt(request, failedBan, logger);
  if (failedAttemptResponse) {
    return failedAttemptResponse;
  }

  logger.warn('Admin login attempt failed', {}, { notify: true });
  return response.json({ error: 'Invalid password' }, 401);
}

async function handleInitialSetup(request, logger) {
  if (isAdminInitialized()) {
    logger.warn('Admin initialization attempted after setup is already complete.');
    return response.json({ error: 'Admin is already initialized.' }, 409);
  }

  if (!isInitSecretConfigured()) {
    logger.fatal('INIT_SECRET is not set on server.');
    return response.json({ error: 'INIT_SECRET is not set on server.' }, 500);
  }

  const payload = await readJsonBody(request);
  const expectedInitSecret = ConfigService.getEnv().INIT_SECRET.trim();
  const initSecretInput = getRequestInitSecret(request, payload);

  if (!initSecretInput) {
    return response.json({ error: 'Initialization secret is required.' }, 401);
  }

  if (!constantTimeCompare(initSecretInput, expectedInitSecret)) {
    logger.warn('Admin initialization rejected due to invalid initialization secret.');
    return response.json({ error: 'Invalid initialization secret.' }, 401);
  }

  const password = typeof payload?.password === 'string' ? payload.password.trim() : '';
  const confirmPassword = typeof payload?.confirmPassword === 'string' ? payload.confirmPassword.trim() : '';

  if (!password || password.length < 6) {
    return response.json({ error: 'Password must be at least 6 characters.' }, 400);
  }

  if (!confirmPassword) {
    return response.json({ error: 'Please confirm your password.' }, 400);
  }

  if (password !== confirmPassword) {
    return response.json({ error: 'Passwords do not match.' }, 400);
  }

  const lockOwner = crypto.randomUUID();
  const lockAcquired = await acquireInitializationLock(lockOwner, logger);
  if (!lockAcquired) {
    return response.json({ error: 'Initialization is already in progress. Please try again shortly.' }, 409);
  }

  try {
    const oldConfig = await getGlobalConfig() || {};
    if (hasConfiguredAdminPassword(oldConfig)) {
      return response.json({ error: 'Admin is already initialized.' }, 409);
    }

    const nextJwtSecret = generateJwtSecret();
    let passwordCredentials;
    try {
      passwordCredentials = await buildAdminPasswordCredentials(password);
    } catch (err) {
      logger.error(err, { customMessage: 'Failed to hash admin password during initialization.' });
      return response.json({ error: 'Failed to initialize admin credentials.' }, 500);
    }

    const mergedConfig = deepMerge({}, oldConfig, {
      ...passwordCredentials,
      jwtSecret: nextJwtSecret
    });
    await saveGlobalConfig(mergedConfig);

    const latestConfig = await getGlobalConfig() || {};
    if (
      !hasConfiguredPbkdf2AdminPassword(latestConfig)
      || latestConfig.adminPasswordHash !== passwordCredentials.adminPasswordHash
      || latestConfig.adminPasswordSalt !== passwordCredentials.adminPasswordSalt
      || parseAdminPasswordHashIterations(latestConfig.adminPasswordHashIterations) !== passwordCredentials.adminPasswordHashIterations
      || !hasConfiguredJwtSecret(latestConfig)
      || latestConfig.jwtSecret !== nextJwtSecret
    ) {
      logger.warn('Admin initialization conflict detected after config write.', {}, { notify: true });
      return response.json({ error: 'Initialization conflict detected. Please retry.' }, 409);
    }

    await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());

    const jwtSecret = getJwtSecretFromConfig();
    if (!jwtSecret) {
      logger.fatal('JWT secret is missing after initialization.');
      return response.json({ error: 'JWT secret is missing after initialization.' }, 500);
    }

    const token = await createJwt(jwtSecret, {}, logger);
    const cookie = createAuthCookie(token, 8 * 60 * 60);

    logger.warn('Admin initial password configured.', {}, { notify: true });
    return response.json({ success: true }, 200, { 'Set-Cookie': cookie });
  } finally {
    await releaseInitializationLock(lockOwner, logger);
  }
}

export async function handlePublicAdminApiRequest(request, logger, {
  initialized,
  initSecretConfigured
}) {
  const router = Router();

  router.get('/admin/api/init/status', () => response.json({ initialized, initSecretConfigured }, 200));
  router.post('/admin/api/init', () => handleInitialSetup(request, logger));
  router.post('/admin/api/login', () => handleLogin(request, logger));

  return router.fetch(request);
}
