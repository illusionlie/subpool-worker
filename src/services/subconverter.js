import { ConfigService } from './config.js';
import { applyFilter, isValidBase64, safeBtoa } from '../utils.js';

const SUBSCRIPTION_CACHE_POLICY = Object.freeze({
  freshTtlMs: 60 * 1000,
  swrTtlMs: 3 * 60 * 1000,
  negativeTtlMs: 15 * 1000,
  maxEntries: 512
});

export class SubconverterService {
  static _resultCache = new Map();
  static _inFlightRefreshes = new Map();

  /**
   * 主方法：生成最终的订阅内容
   * @param {object} group - The subscription group object from KV.
   * @param {Request} request - The original incoming request.
   * @param {string} token - The group's token.
   * @returns {Promise<{content: string, headers: object}>}
   */
  static async generateSubscription(group, request, token, logger) {
    const url = new URL(request.url);
    const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();

    // 确定最终输出格式
    const outputFormat = this._getOutputFormat(url, userAgent);

    const cacheKey = this._createResultCacheKey(group, token, url, outputFormat);
    const now = Date.now();
    this._pruneExpiredCacheEntries(now);

    const cacheState = this._getCacheState(cacheKey, now);
    if (cacheState.state === 'fresh' && cacheState.entry) {
      return this._clonePayload(cacheState.entry.payload);
    }

    const buildResult = () => this._buildSubscriptionResult(group, request, token, logger, outputFormat, url);

    if (cacheState.state === 'stale' && cacheState.entry) {
      this._refreshResultInBackground(cacheKey, buildResult, logger, cacheState.entry);
      return this._clonePayload(cacheState.entry.payload);
    }

    return this._refreshResultBlocking(cacheKey, buildResult, logger);
  }

  static async _buildSubscriptionResult(group, request, token, logger, outputFormat, url) {
    // 分离内联节点和订阅链接
    const allSources = (group.nodes || '').split('\n').filter(Boolean);
    const inlineNodes = [];
    const subscriptionUrls = [];
    allSources.forEach(source => {
      /^(https?:)?\/\//i.test(source.toLowerCase()) ? subscriptionUrls.push(source) : inlineNodes.push(source);
    });

    // 并发获取远程订阅内容
    const { fetchedNodes, conversionUrls } = await this._fetchRemoteSubscriptions(subscriptionUrls, request, group.filter, logger);

    // 合并、过滤和去重所有原生节点
    const combinedNodes = [...inlineNodes, ...fetchedNodes];
    let content = applyFilter(combinedNodes.join('\n'), group.filter, logger);
    content = [...new Set(content.split('\n'))].join('\n');

    // 如果客户端请求的就是 base64，或者 sub-converter 正在回访我们，直接返回结果
    if (outputFormat === 'base64') {
      const headers = this._createSubscriptionHeaders();
      return {
        payload: { content: safeBtoa(content), headers },
        cacheStatus: 'positive'
      };
    }

    // 创建一个指向自身的回调 URL，用于向 sub-converter 提供已处理好的节点
    const finalConversionUrls = [...conversionUrls];
    if (content.trim()) {
      const selfUrl = `https://${url.hostname}/sub/${token}?format=base64`;
      finalConversionUrls.unshift(selfUrl);
    }

    // 如果没有任何可转换的内容，回退到返回空的 base64
    if (finalConversionUrls.length === 0) {
      const headers = this._createSubscriptionHeaders();
      return {
        payload: { content: safeBtoa(''), headers },
        cacheStatus: 'positive'
      };
    }

    const subconverterConfig = ConfigService.get('subconverter');
    const subconverterUrl = this._generateSubConverterUrl(outputFormat, finalConversionUrls, subconverterConfig);
    if (!subconverterUrl || subconverterUrl.trim() === '') {
      const headers = this._createSubscriptionHeaders();
      return {
        payload: { content: safeBtoa(''), headers },
        cacheStatus: 'positive'
      };
    }

    try {
      const response = await fetch(subconverterUrl);
      if (!response.ok) throw new Error(`Sub-converter API error: ${response.status}`);

      let subContent = await response.text();
      if (outputFormat === 'clash') {
        subContent = this._fixClashWireguard(subContent);
      }

      const headers = this._createSubscriptionHeaders(true);
      return {
        payload: { content: subContent, headers },
        cacheStatus: 'positive'
      };
    } catch (error) {
      logger.error(error, { customMessage: 'Sub-converter fetch failed' });
      // 转换失败时，回退到返回原生 base64 节点
      const headers = this._createSubscriptionHeaders();
      return {
        payload: { content: safeBtoa(content), headers },
        cacheStatus: 'negative'
      };
    }
  }

  static async _refreshResultBlocking(cacheKey, buildResult, logger) {
    const refreshPromise = this._ensureRefreshPromise(cacheKey, buildResult, logger, {
      preserveStaleOnNegative: false,
      staleEntry: null
    });
    const payload = await refreshPromise;
    return this._clonePayload(payload);
  }

  static _refreshResultInBackground(cacheKey, buildResult, logger, staleEntry) {
    const refreshPromise = this._ensureRefreshPromise(cacheKey, buildResult, logger, {
      preserveStaleOnNegative: true,
      staleEntry
    });

    const ctx = ConfigService.getCtx();
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(refreshPromise.catch(() => {}));
      return;
    }

    refreshPromise.catch(() => {});
  }

  static _ensureRefreshPromise(cacheKey, buildResult, logger, options) {
    const inFlight = this._inFlightRefreshes.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const refreshPromise = (async () => {
      const result = await buildResult();
      const shouldPreserveStale = this._shouldPreserveStaleOnNegative(result, options);
      if (!shouldPreserveStale) {
        this._setCacheEntry(cacheKey, result.payload, result.cacheStatus);
      }
      return result.payload;
    })();

    const trackedPromise = refreshPromise
      .catch(error => {
        this._logCacheRefreshError(error, logger, cacheKey);
        throw error;
      })
      .finally(() => {
        this._inFlightRefreshes.delete(cacheKey);
      });

    this._inFlightRefreshes.set(cacheKey, trackedPromise);
    return trackedPromise;
  }

  static _shouldPreserveStaleOnNegative(result, options) {
    if (!options?.preserveStaleOnNegative) {
      return false;
    }

    if (!result || result.cacheStatus !== 'negative') {
      return false;
    }

    const staleEntry = options.staleEntry;
    if (!staleEntry || staleEntry.status !== 'positive') {
      return false;
    }

    return Date.now() <= staleEntry.staleUntil;
  }

  static _setCacheEntry(cacheKey, payload, cacheStatus) {
    const now = Date.now();
    const isNegative = cacheStatus === 'negative';
    const freshUntil = now + (isNegative ? SUBSCRIPTION_CACHE_POLICY.negativeTtlMs : SUBSCRIPTION_CACHE_POLICY.freshTtlMs);
    const staleUntil = now + (isNegative ? SUBSCRIPTION_CACHE_POLICY.negativeTtlMs : (SUBSCRIPTION_CACHE_POLICY.freshTtlMs + SUBSCRIPTION_CACHE_POLICY.swrTtlMs));

    this._resultCache.set(cacheKey, {
      payload: this._clonePayload(payload),
      status: isNegative ? 'negative' : 'positive',
      createdAt: now,
      freshUntil,
      staleUntil
    });

    this._enforceCacheSizeLimit();
  }

  static _getCacheState(cacheKey, now = Date.now()) {
    const entry = this._resultCache.get(cacheKey);
    if (!entry) {
      return { state: 'miss', entry: null };
    }

    if (now <= entry.freshUntil) {
      return { state: 'fresh', entry };
    }

    if (now <= entry.staleUntil) {
      return { state: 'stale', entry };
    }

    this._resultCache.delete(cacheKey);
    return { state: 'miss', entry: null };
  }

  static _createResultCacheKey(group, token, url, outputFormat) {
    const host = (url.hostname || '').toLowerCase();
    const groupFingerprint = this._hashString(JSON.stringify({
      nodes: group?.nodes || '',
      filter: group?.filter || null
    }));

    return `token:${token}|host:${host}|format:${outputFormat}|group:${groupFingerprint}`;
  }

  static _hashString(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 33) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  static _clonePayload(payload) {
    return {
      content: payload.content,
      headers: { ...(payload.headers || {}) }
    };
  }

  static _pruneExpiredCacheEntries(now = Date.now()) {
    for (const [cacheKey, entry] of this._resultCache.entries()) {
      if (now > entry.staleUntil) {
        this._resultCache.delete(cacheKey);
      }
    }
  }

  static _enforceCacheSizeLimit() {
    while (this._resultCache.size > SUBSCRIPTION_CACHE_POLICY.maxEntries) {
      const oldestKey = this._resultCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this._resultCache.delete(oldestKey);
    }
  }

  static _logCacheRefreshError(error, logger, cacheKey) {
    if (logger && typeof logger.error === 'function') {
      logger.error(error, { customMessage: 'Subscription cache refresh failed', cacheKey });
    }
  }

  static __clearResultCacheForTests() {
    this._resultCache.clear();
    this._inFlightRefreshes.clear();
  }

  static __getCachePolicyForTests() {
    return { ...SUBSCRIPTION_CACHE_POLICY };
  }

  static async _fetchRemoteSubscriptions(urls, request, filterConfig, logger) {
    if (!urls || urls.length === 0) {
      return { fetchedNodes: [], conversionUrls: [] };
    }

    const requestHostname = new URL(request.url).hostname.toLowerCase();
    const fetchedNodes = [];
    const conversionUrls = [];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4秒超时

    const promises = urls.map(async (url) => {
      try {
        const urlStr = url.toString();
        const targetHostname = new URL(urlStr).hostname.toLowerCase();

        // 检查递归，如果是，直接抛出错误
        if (targetHostname === requestHostname) {
          throw new Error('Recursive loop detected');
        }

        // 使用 await 等待 fetch 完成
        const resp = await fetch(urlStr, {
          method: 'GET',
          headers: { 'User-Agent': `${request.headers.get('User-Agent') || 'Mozilla/5.0'} v2rayN/7.15.7 (SubPool-Worker/1.0.0; +https://github.com/illusionlie/subpool-worker  )` },
          signal: controller.signal
        });

        if (!resp.ok) {
          throw new Error(`Fetch failed: ${resp.status}`);
        }

        // 使用 await 等待读取文本内容
        const content = await resp.text();
        return { url: urlStr, content };

      } catch (error) {
        // 抛出一个包含URL和错误信息的对象，以便后续处理
        // Promise.allSettled 会捕获这个 throw，并将其作为 rejected 的 reason
        throw { url: url.toString(), error };
      }
    });

    const results = await Promise.allSettled(promises);
    clearTimeout(timeoutId);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { url, content } = result.value;
        // 判断是否是 Clash 或 Sing-box 等配置文件
        if (content.includes('proxies:') || (content.includes('outbounds') && content.includes('inbounds'))) {
          conversionUrls.push(url);
        } else if (isValidBase64(content)) {
          const normalizedContent = this._normalizeBase64ForDecode(content);
          try {
            const decoded = atob(normalizedContent);
            fetchedNodes.push(applyFilter(decoded, filterConfig, logger));
          } catch (error) {
            logger.warn(`Failed to decode base64 content from ${url}`, {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else if (content.includes('://')) {
          fetchedNodes.push(applyFilter(content, filterConfig, logger));
        } else {
          logger.warn(`Unrecognized content from ${url}`);
        }
      } else {
        const { url, error } = result.reason;
        logger.error(error, `Failed to fetch ${url}`);
      }
    }

    return { fetchedNodes, conversionUrls };
  }

  static _normalizeBase64ForDecode(content) {
    return content.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  }

  static _getOutputFormat(url, userAgent) {
    const formatMap = {
      'clash': 'clash', 'sing-box': 'singbox', 'singbox': 'singbox',
      'surge': 'surge', 'quantumult%20x': 'quanx', 'loon': 'loon'
    };
    const paramMap = {
      'clash': 'clash', 'sb': 'singbox', 'singbox': 'singbox',
      'surge': 'surge', 'quanx': 'quanx', 'loon': 'loon',
      'b64': 'base64', 'base64': 'base64', 'format=base64': 'base64'
    };

    // 优先匹配 URL 参数
    const params = new URLSearchParams(url.search);
    for (const [param, format] of Object.entries(paramMap)) {
      if (params.has(param)) return format;
    }

    // 再匹配 User-Agent
    for (const [ua, format] of Object.entries(formatMap)) {
      if (userAgent.includes(ua)) return format;
    }
    return 'base64'; // 默认格式
  }

  static _generateSubConverterUrl(targetFormat, urls, subconverterConfig) {
    const params = new URLSearchParams({
      target: targetFormat,
      url: urls.join('|'),
      insert: 'false',
      config: subconverterConfig.configUrl,
      emoji: 'true',
      list: 'false',
      tfo: 'false',
      scv: 'true',
      fdn: 'false',
      sort: 'false'
    });

    if (targetFormat === 'clash' || targetFormat === 'singbox') {
      params.set('new_name', 'true');
    }
    return `${subconverterConfig.protocol}://${subconverterConfig.url}/sub?${params.toString()}`;
  }

  static _createSubscriptionHeaders(isConverted = false) {
    const config = ConfigService.get();
    const { totalTB, expireDate } = config.subscriptionInfo;
    const total = totalTB * 1099511627776;
    const expire = (expireDate === '0')
      ? 0
      : (!isNaN(Date.parse(expireDate))
        ? Math.floor(new Date(expireDate).getTime() / 1000)
        : -1);

    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Profile-Update-Interval': `${config.subUpdateTime}`,
      'Subscription-Userinfo': `upload=0; download=0; total=${total}; expire=${expire}`
    };
    if (isConverted) {
      headers['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(config.fileName)}`;
    }
    return headers;
  }

  static _fixClashWireguard(content) {
    if (content.includes('type: wireguard') && !content.includes('remote-dns-resolve')) {
      return content.replace(/, mtu: 1280, udp: true/g, ', mtu: 1280, remote-dns-resolve: true, udp: true');
    }
    return content;
  }
}
