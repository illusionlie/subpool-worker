import { ConfigService, deepMerge } from '../../services/config.js';
import { normalizeGroupToken, isValidGroupToken } from '../../services/group-token.js';
import { response } from '../../utils.js';
import { createJwt, createAuthCookie } from '../../services/auth.js';
import { getGlobalConfig, saveGlobalConfig } from '../../repositories/admin/config-repository.js';
import { getGroup, getAllGroups, saveGroup, deleteGroup } from '../../repositories/admin/group-repository.js';
import {
  hasConfiguredAdminPassword,
  getRuntimeAdminCredentials,
  buildAdminPasswordCredentials,
  isValidAdminPassword,
  normalizePersistedAdminCredentialFields
} from '../../services/admin/credential-service.js';
import { generateJwtSecret } from '../../services/admin/session-service.js';
import {
  ADMIN_DATA_SCHEMA_VERSION,
  sanitizeConfigForResponse,
  normalizeImportPayload,
  buildMergedConfigForImport,
  syncImportedGroups
} from '../../services/admin/import-export-service.js';
import { Router } from 'itty-router';

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function handleLogout() {
  const cookie = createAuthCookie('logged_out', 0);
  return response.json({ success: true }, 200, { 'Set-Cookie': cookie });
}

export async function handleProtectedAdminApiRequest(request, logger) {
  const router = Router();

  router.post('/admin/api/logout', () => handleLogout());

  router.get('/admin/api/config', async () => {
    const config = await getGlobalConfig() || ConfigService.get();
    return response.json(sanitizeConfigForResponse(config));
  });

  router.get('/admin/api/export', async () => {
    const config = await getGlobalConfig() || ConfigService.get();
    const groups = await getAllGroups();

    return response.json({
      schemaVersion: ADMIN_DATA_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      config: sanitizeConfigForResponse(config),
      groups
    });
  });

  router.post('/admin/api/import', async () => {
    const payload = await readJsonBody(request);
    if (!payload) {
      return response.json({ error: 'Invalid JSON payload.' }, 400);
    }

    let normalizedPayload;
    try {
      normalizedPayload = normalizeImportPayload(payload);
    } catch (err) {
      return response.json({
        error: err instanceof Error ? err.message : 'Invalid import payload.'
      }, 400);
    }

    let previousConfig = null;
    let configPersisted = false;

    try {
      previousConfig = await getGlobalConfig() || {};
      const mergedConfig = await buildMergedConfigForImport(normalizedPayload.importedConfig);
      await saveGlobalConfig(mergedConfig);
      configPersisted = true;

      await syncImportedGroups(normalizedPayload.importedGroups, logger);
      await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());

      logger.warn('Admin config/groups imported from JSON backup.', {
        importedGroups: normalizedPayload.importedGroups.length
      }, { notify: true });

      return response.json({
        success: true,
        importedGroups: normalizedPayload.importedGroups.length
      });
    } catch (err) {
      if (configPersisted) {
        try {
          await saveGlobalConfig(previousConfig);
          await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());
        } catch (rollbackErr) {
          logger.error(rollbackErr, { customMessage: 'Failed to rollback global config after import error.' });
        }
      }

      logger.error(err, { customMessage: 'Failed to import admin config/groups from JSON.' });
      return response.json({ error: 'Failed to import data.' }, 500);
    }
  });

  router.put('/admin/api/config', async () => {
    const newConfig = await readJsonBody(request);
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
      return response.json({ error: 'Invalid config payload.' }, 400);
    }

    if ('jwtSecret' in newConfig) {
      delete newConfig.jwtSecret;
    }

    if ('adminPasswordHash' in newConfig) {
      delete newConfig.adminPasswordHash;
    }

    if ('adminPasswordSalt' in newConfig) {
      delete newConfig.adminPasswordSalt;
    }

    if ('adminPasswordHashIterations' in newConfig) {
      delete newConfig.adminPasswordHashIterations;
    }

    if ('blockBots' in newConfig) {
      delete newConfig.blockBots;
    }

    let passwordChanged = false;
    const currentAdminCredentials = getRuntimeAdminCredentials();

    if ('adminPassword' in newConfig) {
      const nextPassword = typeof newConfig.adminPassword === 'string'
        ? newConfig.adminPassword.trim()
        : '';

      if (!nextPassword) {
        delete newConfig.adminPassword;
      } else {
        if (nextPassword.length < 6) {
          return response.json({ error: 'Password must be at least 6 characters.' }, 400);
        }

        let passwordMatched;
        try {
          passwordMatched = await isValidAdminPassword(nextPassword, currentAdminCredentials);
        } catch (err) {
          logger.error(err, { customMessage: 'Failed to validate admin password hash during update.' });
          return response.json({ error: 'Failed to validate password.' }, 500);
        }

        passwordChanged = !hasConfiguredAdminPassword(currentAdminCredentials)
          || !passwordMatched;

        if (passwordChanged) {
          let passwordCredentials;
          try {
            passwordCredentials = await buildAdminPasswordCredentials(nextPassword);
          } catch (err) {
            logger.error(err, { customMessage: 'Failed to hash admin password during update.' });
            return response.json({ error: 'Failed to update admin credentials.' }, 500);
          }

          newConfig.adminPasswordHash = passwordCredentials.adminPasswordHash;
          newConfig.adminPasswordSalt = passwordCredentials.adminPasswordSalt;
          newConfig.adminPasswordHashIterations = passwordCredentials.adminPasswordHashIterations;
          newConfig.adminPassword = '';

          if (passwordChanged) {
            newConfig.jwtSecret = generateJwtSecret();
          }
        } else {
          delete newConfig.adminPassword;
        }
      }
    }

    const oldConfig = await getGlobalConfig() || {};
    const mergedConfig = normalizePersistedAdminCredentialFields(deepMerge({}, oldConfig, newConfig));

    if (Object.hasOwn(mergedConfig, 'blockBots')) {
      delete mergedConfig.blockBots;
    }

    await saveGlobalConfig(mergedConfig);

    const responseHeaders = {};
    if (passwordChanged) {
      const jwtSecret = typeof mergedConfig.jwtSecret === 'string'
        ? mergedConfig.jwtSecret.trim()
        : '';

      if (!jwtSecret) {
        logger.fatal('JWT secret is missing after password update.');
        return response.json({ error: 'JWT secret is missing after password update.' }, 500);
      }

      const token = await createJwt(jwtSecret, {}, logger);
      responseHeaders['Set-Cookie'] = createAuthCookie(token, 8 * 60 * 60);
      logger.warn('Admin password updated and JWT secret rotated.', {}, { notify: true });
    } else {
      logger.info('Global config updated', {}, { notify: true });
    }

    return response.json({ success: true, passwordChanged }, 200, responseHeaders);
  });

  router.get('/admin/api/groups', async () => {
    const groups = await getAllGroups();
    return response.json(groups);
  });

  router.post('/admin/api/groups', async () => {
    const newGroup = await readJsonBody(request);
    if (!newGroup || typeof newGroup !== 'object' || Array.isArray(newGroup)) {
      logger.warn('Invalid group data', { GroupData: newGroup });
      return response.json({ error: 'Invalid group data' }, 400);
    }

    if (typeof newGroup.name !== 'string' || !newGroup.name.trim()) {
      logger.warn('Invalid group data', { GroupData: newGroup });
      return response.json({ error: 'Invalid group data' }, 400);
    }

    if (!newGroup.token) newGroup.token = crypto.randomUUID();
    newGroup.token = normalizeGroupToken(newGroup.token);
    if (!isValidGroupToken(newGroup.token)) {
      logger.warn('Invalid group data', { GroupData: newGroup });
      return response.json({ error: 'Invalid group data' }, 400);
    }

    const group = await getGroup(newGroup.token);
    if (group) {
      logger.warn('Group already exists', { GroupName: newGroup.name });
      return response.json({ error: 'Group already exists' }, 400);
    }

    await saveGroup(newGroup);
    logger.info('Group created', { GroupName: newGroup.name, Token: newGroup.token }, { notify: true });
    return response.json(newGroup);
  });

  router.put('/admin/api/groups/:token', async ({ params }) => {
    const normalizedToken = normalizeGroupToken(params.token);
    const groupData = await readJsonBody(request);
    if (!groupData || typeof groupData !== 'object' || Array.isArray(groupData)) {
      logger.warn('Invalid group data', { GroupData: groupData, Token: normalizedToken });
      return response.json({ error: 'Invalid group data' }, 400);
    }

    if (!isValidGroupToken(normalizedToken)) {
      logger.warn('Invalid group data', { GroupData: groupData, Token: normalizedToken });
      return response.json({ error: 'Invalid group data' }, 400);
    }

    groupData.token = normalizedToken;
    await saveGroup(groupData);
    logger.info('Group updated', { GroupName: groupData.name, Token: groupData.token }, { notify: true });
    return response.json(groupData);
  });

  router.delete('/admin/api/groups/:token', async ({ params }) => {
    const token = params.token;
    await deleteGroup(token);
    logger.warn('Group deleted', { Token: token }, { notify: true });
    return response.json({ success: true });
  });

  router.get('/admin/api/utils/gentoken', () => response.json({ token: crypto.randomUUID() }));

  const routerResponse = await router.fetch(request);
  if (routerResponse) {
    return routerResponse;
  }

  return response.json({ error: 'API endpoint not found' }, 404);
}
