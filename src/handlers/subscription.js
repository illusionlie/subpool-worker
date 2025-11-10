import { ConfigService } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { SubconverterService } from '../services/subconverter.js';
import { renderNginxWelcomePage } from '../views/nginx.html.js';
import { response, isBot } from '../utils.js';

export async function handleSubscriptionRequest(request, token, logger) {
  const group = await KVService.getGroup(token);
  if (!token || token.length > 128 || token.includes('/')) {
    // 无效的 token 格式，直接返回 400
    logger.warn('Invalid token format access attempt', { URL: request.url }, { notify: true });
    return response.normal('Invalid token format.', 400);
  }
  
  if (!group) {
    logger.warn('Invalid token access attempt', { URL: request.url }, { notify: true });
    return response.normal(renderNginxWelcomePage(), 404);
  }

  const config = ConfigService.get();
  const country = request.cf?.country || 'XX'; // 'XX' for unknown
  if (country === 'CN' && !group.allowChinaAccess) {
    logger.warn('Blocked China access attempt', { UserAgent: request.headers.get('User-Agent'), URL: request.url }, { notify: true });
    return response.normal(renderNginxWelcomePage(), 403);
  }

  const { score, ifBot } = isBot(request);
  if (config.blockBots && ifBot) {
    logger.info('Blocked bot access attempt', { UserAgent: request.headers.get('User-Agent'), URL: request.url, Score: score });
    return response.normal(renderNginxWelcomePage(), 403);
  }

  logger.info('Subscription accessed', { token, groupName: group.name, Score: score });
  
  try {
    const { content, headers } = await SubconverterService.generateSubscription(group, request, token);
    return new Response(content, { headers });
  } catch (err) {
    logger.error(err, { customMessage: 'Failed to generate subscription', token });
    return response.normal('Upstream subscription generation failed. Please check the logs.', 502);
  }
}