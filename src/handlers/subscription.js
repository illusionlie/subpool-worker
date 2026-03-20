import { ConfigService } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { SubconverterService } from '../services/subconverter.js';
import { response, isBot, serveAssetResponse } from '../utils.js';

async function fetchDefaultPage(request, status, logger) {
  return serveAssetResponse(request, ConfigService.getEnv().ASSETS, '/index.html', logger, {
    status,
    notConfiguredMessage: 'Default fallback asset is unavailable because ASSETS binding is not configured.',
    notFoundMessage: 'Default fallback asset not found.',
    fetchFailureMessage: 'Failed to fetch subscription fallback asset',
    logLabel: 'subscription fallback asset fetch'
  });
}

export async function handleSubscriptionRequest(request, token, logger) {
  if (!token || token.length > 128 || token.includes('/')) {
    // 无效的 token 格式，直接返回 400
    logger.warn('Invalid token format access attempt', { URL: request.url }, { notify: true });
    return response.normal('Invalid token format.', 400);
  }

  const group = await KVService.getGroup(token);
  if (!group) {
    logger.warn('Invalid token access attempt', { URL: request.url }, { notify: true });
    return fetchDefaultPage(request, 404, logger);
  }

  const config = ConfigService.get();
  const country = request.cf?.country || 'XX'; // 'XX' for unknown
  if (country === 'CN' && !group.allowChinaAccess) {
    logger.warn('Blocked China access attempt', { UserAgent: request.headers.get('User-Agent'), URL: request.url }, { notify: true });
    return fetchDefaultPage(request, 403, logger);
  }

  const { score, ifBot } = isBot(request);
  if (config.blockBots && ifBot) {
    logger.info('Blocked bot access attempt', { UserAgent: request.headers.get('User-Agent'), URL: request.url, Score: score });
    return fetchDefaultPage(request, 403, logger);
  }

  logger.info('Subscription accessed', { token, groupName: group.name, Score: score });

  try {
    const { content, headers } = await SubconverterService.generateSubscription(group, request, token, logger);
    return new Response(content, { headers });
  } catch (err) {
    logger.error(err, { customMessage: 'Failed to generate subscription', token });
    return response.normal('Upstream subscription generation failed. Please check the logs.', 502);
  }
}
