import { ConfigService } from '../../services/config.js';
import { serveAssetResponse } from '../../utils.js';

export async function fetchAdminAsset(request, assetPath, logger, status = null, headers = {}) {
  return serveAssetResponse(request, ConfigService.getEnv().ASSETS, assetPath, logger, {
    status,
    headers,
    notConfiguredMessage: 'Admin asset is unavailable because ASSETS binding is not configured.',
    notFoundMessage: 'Admin asset not found.',
    fetchFailureMessage: 'Failed to fetch admin asset',
    logLabel: 'admin asset fetch'
  });
}

export function isAdminEntryPage(pathname) {
  return pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/index.html';
}

export function isAdminInitPage(pathname) {
  return pathname === '/admin/init' || pathname === '/admin/init/' || pathname === '/admin/init.html';
}
