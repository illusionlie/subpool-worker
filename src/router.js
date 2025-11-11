import { handleAdminRequest } from './handlers/admin.js';
import { handleSubscriptionRequest } from './handlers/subscription.js';
import { renderNginxWelcomePage } from './views/nginx.html.js';
import { ConfigService } from './services/config.js';
import { response } from './utils.js';
import { Router } from 'itty-router';

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
  logger.warn('Unhandled path, returning default page', { pathname });
  
  // 根路径或任何其他未知路径
  return response.normal(renderNginxWelcomePage(), 200);
}