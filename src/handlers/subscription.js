import { ConfigService } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { SubconverterService } from '../services/subconverter.js';
import { TelegramService } from '../services/telegram.js';
import { renderNginxWelcomePage } from '../views/nginx.html.js';
import { isBot } from '../utils.js';

export async function handleSubscriptionRequest(request, token) {
  const group = await KVService.getGroup(token);
  
  if (!group) {
    await TelegramService.sendSubscriptionLog(request, null);
    return new Response(renderNginxWelcomePage(), { status: 404 });
  }

  const config = ConfigService.get();
  const country = request.headers.get('cf-ipcountry');
  if (country === 'CN' && !group.allowChinaAccess) {
    return new Response(renderNginxWelcomePage(), { status: 403 });
  }

  const userAgent = request.headers.get('User-Agent') || '';
  if (config.blockBots && isBot(userAgent)) {
    return new Response(renderNginxWelcomePage(), { status: 403 });
  }

  await TelegramService.sendSubscriptionLog(request, group.name);
  
  const { content, headers } = await SubconverterService.generateSubscription(group, request, token);

  return new Response(content, { headers });
}