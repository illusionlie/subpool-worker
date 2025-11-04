import { ConfigService } from './config.js';

export class TelegramService {
  static async sendMessage(message, ctx = null) {
    const config = ConfigService.get('telegram');
    if (!config.enabled || !config.botToken || !config.chatId) {
      return;
    }

    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    
    const payload = {
      chat_id: config.chatId,
      text: message,
      parse_mode: 'HTML'
    };

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify(payload)
    };

    const sendTelegram = async () => {
      try {
        console.log('Sending Telegram message:', message);
        const response = await fetch(url, options);
        console.log('Telegram response status:', response.status);
        if (!response.ok) {
          throw new Error(`Telegram API returned ${response.status}: ${await response.text()}`);
        }
        console.log('Telegram message sent successfully');
      } catch (err) {
        console.error('Telegram send failed:', err.message);
      }
    };

    // 如果有 ctx，使用 waitUntil 确保请求完成
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(sendTelegram());
    } else {
      // 否则直接发送（可能在某些情况下失败）
      await sendTelegram();
    }
  }
}
