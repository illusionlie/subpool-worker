import { TelegramService } from './telegram.js';

const logLevels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
  none: 5,
};

export default class LoggerService {
  /**
   * @param {Request} request 请求
   * @param {Env} env 环境变量
   * @param {ExecutionContext} ctx 执行上下文
   */
  constructor(request, env, ctx) {
    this.request = request;
    this.env = env;
    this.ctx = ctx;

    // 从环境变量中获取日志级别
    const defaultLogLevel = env.LOG_LEVEL !== undefined ? env.LOG_LEVEL : 'info';
    this.logLevel = logLevels[env.LOG_LEVEL?.toLowerCase() || defaultLogLevel];

    // 确保日志级别在定义的范围内
    if (this.logLevel === undefined) {
      this.logLevel = logLevels[defaultLogLevel];
    }
    
    // 检查请求头以确定是否需要覆盖日志级别
    this.debugOverride = request.headers.get('X-Debug-Log') === 'true';
  }

  /**
   * 日志记录核心
   * @private
   * @param {string} level 日志级别
   * @param {string} message 日志消息
   * @param {object} [data={}] 附加数据
   */
  async _log(level, message, data = {}, options = {}) {
    const levelNumber = logLevels[level];

    // 条件检查：
    // 1. 该消息的日志级别是否足够高以被记录
    // 2. 是否存在调试覆盖 header
    // 如果两者均不成立，则不执行任何操作
    if (levelNumber < this.logLevel && !this.debugOverride) {
      return;
    }
    
    const logObject = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      // 自动为日志添加请求上下文
      context: {
        requestId: this.request.headers.get('cf-request-id'),
        url: this.request.url,
        method: this.request.method,
        colo: this.request.cf?.colo,
        country: this.request.cf?.country,
        region: this.request.cf?.region,
      },
      // 合并任何提供的自定义数据
      ...data,
    };

    if (options.notify || level === 'error' || level === 'fatal') {
      await this.sendNotification(logObject, data, this.request);
    }

    // 使用不同的控制台方法。这有助于在某些日志查看器中进行过滤
    // 使用 JSON.stringify 生成结构化且可搜索的日志
    switch (level) {
      case 'error':
      case 'fatal':
        console.error(JSON.stringify(logObject));
        break;
      case 'warn':
        console.warn(JSON.stringify(logObject));
        break;
      case 'info':
        console.info(JSON.stringify(logObject));
        break;
      default:
        console.log(JSON.stringify(logObject));
        break;
    }
  }

  /**
   * 格式化并发送Telegram通知
   * @private
   */
  async sendNotification(logObject, data, request) {
    const { level, message, context } = logObject;
    const emoji = {
        INFO: 'ℹ️',
        WARN: '⚠️',
        ERROR: '❌',
        FATAL: '🚨'
    }[level] || '⚙️';

    let details = '';
    // 如果有错误堆栈，优先显示
    if (data.error && data.error.stack) {
        details = `<tg-spoiler>${data.error.stack}</tg-spoiler>`;
    } else {
        // 否则显示格式化的数据
        const dataString = JSON.stringify(data, null, 2);
        if (dataString !== '{}') {
            details = `<tg-spoiler>${dataString}</tg-spoiler>`;
        }
    }
    
    const msg = [
        `<b>${emoji} [${level}] ${message}</b>`,
        `Timestamp: ${logObject.timestamp}`,
        // `URL: ${context.url}`,
        `IP: ${request.headers.get('cf-connecting-ip')|| 'N/A'}`,
        `Country: ${context.country} (${context.colo})`,
        `Region: ${context.region}`,
        details
    ].filter(Boolean).join('\n');

    await TelegramService.sendMessage(msg, this.ctx);
  }

  // Public-facing log methods
  async debug(message, data, options) { this._log('debug', message, data, options); }
  async info(message, data, options) { this._log('info', message, data, options); }
  async warn(message, data, options) { this._log('warn', message, data, options); }

  async error(message, data) {
    // 如果 message 是一个 Error 对象，则将其转换为可记录的对象
    if (message instanceof Error) {
        const errorData = {
            error: {
                message: message.message,
                stack: message.stack,
                name: message.name,
            },
            ...data
        };
        this._log('error', message.message, errorData);
    } else {
        this._log('error', message, data);
    }
  }
  
  async fatal(message, data, options) { this._log('fatal', message, data, options); }
}