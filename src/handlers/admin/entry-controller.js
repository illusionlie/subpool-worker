import { ConfigService } from '../../services/config.js';
import { response } from '../../utils.js';
import { verifyJwt, refreshJwt, getAuthCookie, createAuthCookie } from '../../services/auth.js';
import { getOrCreateJwtSecretForInitializedAdmin } from '../../services/admin/session-service.js';
import {
  handlePublicAdminApiRequest,
  isAdminInitialized,
  isInitSecretConfigured
} from './public-controller.js';
import { handleProtectedAdminApiRequest } from './protected-api-controller.js';
import { fetchAdminAsset, isAdminEntryPage, isAdminInitPage } from './page-controller.js';

export async function handleAdminRequest(request, logger) {
  const url = new URL(request.url);
  const { ASSETS } = ConfigService.getEnv();
  if (!ASSETS) {
    logger.fatal('ASSETS binding is not configured.');
    return response.json({ error: 'ASSETS binding is not configured.' }, 500);
  }

  const initialized = isAdminInitialized();
  const initSecretConfigured = isInitSecretConfigured();

  const publicApiResponse = await handlePublicAdminApiRequest(request, logger, {
    initialized,
    initSecretConfigured
  });
  if (publicApiResponse) {
    return publicApiResponse;
  }

  if (!initialized) {
    if (!initSecretConfigured) {
      logger.fatal('INIT_SECRET is required before admin initialization.');
      return response.normal('INIT_SECRET is not configured.', 500, { 'Set-Cookie': createAuthCookie('invalid', 0) }, 'text/plain; charset=utf-8');
    }

    if (url.pathname.startsWith('/admin/api/')) {
      return response.json({ error: 'Admin is not initialized. Please complete initial setup first.' }, 403);
    }

    if (isAdminEntryPage(url.pathname) || isAdminInitPage(url.pathname)) {
      return fetchAdminAsset(request, '/admin/init.html', logger, 200, { 'Set-Cookie': createAuthCookie('invalid', 0) });
    }

    return response.normal('Admin is not initialized yet.', 403, { 'Set-Cookie': createAuthCookie('invalid', 0) }, 'text/plain; charset=utf-8');
  }

  const jwtSecret = await getOrCreateJwtSecretForInitializedAdmin(logger);
  if (!jwtSecret) {
    logger.fatal('JWT secret is not configured for initialized admin.');
    return response.json(
      { error: 'JWT secret is not configured for initialized admin.' },
      500,
      { 'Set-Cookie': createAuthCookie('invalid', 0) }
    );
  }

  const token = getAuthCookie(request, logger);
  const isValid = await verifyJwt(jwtSecret, token, logger);

  if (isValid) {
    const newToken = await refreshJwt(jwtSecret, token, logger);
    const cookie = createAuthCookie(newToken, 8 * 60 * 60);
    if (url.pathname.startsWith('/admin/api/')) {
      const apiResponse = await handleProtectedAdminApiRequest(request, logger);
      if (apiResponse.headers.has('Set-Cookie')) {
        return apiResponse;
      }

      const headers = new Headers(apiResponse.headers);
      headers.set('Set-Cookie', cookie);
      return new Response(apiResponse.body, {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        headers
      });
    }

    if (isAdminInitPage(url.pathname)) {
      return fetchAdminAsset(request, '/admin/index.html', logger, 200, { 'Set-Cookie': cookie });
    }

    if (isAdminEntryPage(url.pathname)) {
      return fetchAdminAsset(request, '/admin/index.html', logger, 200, { 'Set-Cookie': cookie });
    }

    return fetchAdminAsset(request, url.pathname, logger, null, { 'Set-Cookie': cookie });
  }

  const expiredCookieHeaders = { 'Set-Cookie': createAuthCookie('invalid', 0) };

  if (url.pathname.startsWith('/admin/api/')) {
    return response.json({ error: 'Unauthorized' }, 401, expiredCookieHeaders);
  }

  if (isAdminInitPage(url.pathname)) {
    return fetchAdminAsset(request, '/admin/login.html', logger, 401, expiredCookieHeaders);
  }

  if (isAdminEntryPage(url.pathname)) {
    return fetchAdminAsset(request, '/admin/login.html', logger, 401, expiredCookieHeaders);
  }

  return response.normal('Unauthorized.', 401, expiredCookieHeaders, 'text/plain; charset=utf-8');
}
