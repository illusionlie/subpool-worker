import { handleAdminRequest } from './handlers/admin.js';
import { handleSubscriptionRequest } from './handlers/subscription.js';
import { ConfigService } from './services/config.js';
import { response, serveAssetResponse } from './utils.js';
import { Router } from 'itty-router';

async function fetchAsset(request, env, logger, assetPath = null, status = null, headers = {}) {
  return serveAssetResponse(request, env.ASSETS, assetPath, logger, {
    status,
    headers,
    notConfiguredMessage: 'Fallback asset is unavailable because ASSETS binding is not configured.',
    notFoundMessage: 'Fallback asset not found.',
    fetchFailureMessage: 'Failed to fetch fallback asset',
    logLabel: 'fallback asset fetch'
  });
}

export async function handleRequest(request, env, ctx, logger) {
  // 每次请求都初始化/加载最新的配置
  await ConfigService.init(env);

  const url = new URL(request.url);
  const pathname = url.pathname;
  const router = Router();

  // 管理后台路由
  router.all('/admin', () => handleAdminRequest(request, logger));
  router.all('/admin/*', () => handleAdminRequest(request, logger));

  router
    .all('/favicon.ico', () => response.normal('', 404, { 'Content-Type': 'image/x-icon' }))
    .all('/robots.txt', () => response.normal('User-agent: *\nDisallow: /\n', 200));

  // 提取 token (路径的第一部分)
  router.get('/sub/:token/?', ({ params }) => handleSubscriptionRequest(request, params.token, logger));

  const routerResponse = await router.fetch(request);
  if (routerResponse) return routerResponse;

  // 记录未处理的路径
  logger.warn('Unhandled path, returning asset page', { pathname });

  // 根路径或任何其他未知路径
  return fetchAsset(request, env, logger, '/index.html', 200);
}
