import { ConfigService } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { SubconverterService } from '../services/subconverter.js';
import { renderNginxWelcomePage } from '../views/nginx.html.js';
import { response, isBot } from '../utils.js';

export async function handleSubscriptionRequest(request, token, logger) {
  const group = await KVService.getGroup(token);
  
  if (!group) {
    logger.warn('Invalid token access attempt', { URL: request.url }, { notify: true });
    return response.normal(renderNginxWelcomePage(), 404);
  }

  const config = ConfigService.get();
  const country = request.headers.get('cf-ipcountry');
  if (country === 'CN' && !group.allowChinaAccess) {
    logger.warn('Blocked China access attempt', { UserAgent: request.headers.get('User-Agent'), URL: request.url }, { notify: true });
    return response.normal(renderNginxWelcomePage(), 403);
  }

  const userAgent = request.headers.get('User-Agent') || '';
  if (config.blockBots && isBot(userAgent)) {
    logger.info('Blocked bot access attempt', { UserAgent: request.headers.get('User-Agent'), URL: request.url });
    return response.normal(renderNginxWelcomePage(), 403);
  }

  logger.info('Subscription accessed', { token, groupName: group.name });
  
  const { content, headers } = await SubconverterService.generateSubscription(group, request, token);

  return new Response(content, { headers });
}