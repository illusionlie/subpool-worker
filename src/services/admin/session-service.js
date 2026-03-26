import { ConfigService, deepMerge } from '../config.js';
import { getGlobalConfig, saveGlobalConfig } from '../../repositories/admin/config-repository.js';
import {
  hasConfiguredAdminPassword,
  getRuntimeAdminCredentials,
  generateRandomHex
} from './credential-service.js';

export function hasConfiguredJwtSecret(config) {
  const jwtSecret = config?.jwtSecret;
  return typeof jwtSecret === 'string' && jwtSecret.trim().length > 0;
}

export function getJwtSecretFromConfig() {
  const jwtSecret = ConfigService.get('jwtSecret');
  return typeof jwtSecret === 'string' ? jwtSecret.trim() : '';
}

export function generateJwtSecret(byteLength = 48) {
  return generateRandomHex(byteLength);
}

function isAdminInitialized() {
  return hasConfiguredAdminPassword(getRuntimeAdminCredentials());
}

export async function getOrCreateJwtSecretForInitializedAdmin(logger) {
  const currentJwtSecret = getJwtSecretFromConfig();
  if (currentJwtSecret) {
    return currentJwtSecret;
  }

  if (!isAdminInitialized()) {
    return '';
  }

  const oldConfig = await getGlobalConfig() || {};
  if (hasConfiguredJwtSecret(oldConfig)) {
    await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());
    return getJwtSecretFromConfig();
  }

  const nextJwtSecret = generateJwtSecret();
  const mergedConfig = deepMerge({}, oldConfig, { jwtSecret: nextJwtSecret });
  await saveGlobalConfig(mergedConfig);

  const latestConfig = await getGlobalConfig() || {};
  if (!hasConfiguredJwtSecret(latestConfig)) {
    logger.fatal('JWT secret regeneration failed for initialized admin.');
    return '';
  }

  await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());
  logger.warn('JWT secret was missing and has been regenerated for initialized admin.', {}, { notify: true });
  return getJwtSecretFromConfig();
}
