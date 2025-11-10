import { KVService } from './kv.js';

// 定义一套基础的默认配置
const DEFAULT_CONFIG = {
  adminPassword: 'admin_password',
  blockBots: true,
  fileName: 'subpool-worker',
  subUpdateTime: 4,
  subscriptionInfo: {
      totalTB: 99,
      expireDate: '2099-12-31',
  },
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
    logAllAccess: false,
  },
  subconverter: {
    url: '',
    protocol: 'https',
    configUrl: 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini',
  },
  failedBan: {
    enabled: false,
    maxAttempts: 5,
    banDuration: 600, // 10 minutes
    failedAttemptsTtl: 600, // 10 minutes
  },
};

let _config = null;
let _env = null;
let _ctx = null;

function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!source) continue;
    for (const key in source) {
      if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return target;
}

export class ConfigService {
  static async init(env, ctx) {
    _env = env;
    _ctx = ctx;
    const kvConfig = await KVService.getGlobalConfig().catch(() => null) || {};
    // 深层合并，防止覆盖整个对象
    _config = deepMerge({}, DEFAULT_CONFIG, kvConfig);
  }

  static get(key) {
    return key ? _config[key] : _config;
  }

  static getKV() {
    if (!_env || !_env.KV) {
      throw new Error('KV namespace is not bound or ConfigService not initialized.');
    }
    return _env.KV;
  }

  static getEnv() {
    return _env;
  }

  static getCtx() {
    return _ctx;
  }
}