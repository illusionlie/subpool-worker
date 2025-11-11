import { ConfigService } from './config.js';
import { applyFilter, isValidBase64, safeBtoa } from '../utils.js';

export class SubconverterService {

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
    let combinedNodes = [...inlineNodes, ...fetchedNodes];
    let content = applyFilter(combinedNodes.join('\n'), group.filter);
    content = [...new Set(content.split('\n'))].join('\n');
    
    // 如果客户端请求的就是 base64，或者 sub-converter 正在回访我们，直接返回结果
    if (outputFormat === 'base64') {
      const headers = this._createSubscriptionHeaders();
      return { content: safeBtoa(content), headers };
    }

    // 创建一个指向自身的回调 URL，用于向 sub-converter 提供已处理好的节点
    let finalConversionUrls = [...conversionUrls];
    if (content.trim()) {
      const selfUrl = `https://${url.hostname}/sub/${token}?format=base64`;
      finalConversionUrls.unshift(selfUrl);
    }
    
    // 如果没有任何可转换的内容，回退到返回空的 base64
    if (finalConversionUrls.length === 0) {
        const headers = this._createSubscriptionHeaders();
        return { content: safeBtoa(''), headers };
    }

    const subconverterConfig = ConfigService.get('subconverter');
    const subconverterUrl = this._generateSubConverterUrl(outputFormat, finalConversionUrls, subconverterConfig);
    if (!subconverterUrl || subconverterUrl.trim() === '') {
      const headers = this._createSubscriptionHeaders();
      return { content: safeBtoa(''), headers };
    }
    
    try {
      const response = await fetch(subconverterUrl);
      if (!response.ok) throw new Error(`Sub-converter API error: ${response.status}`);
      
      let subContent = await response.text();
      if (outputFormat === 'clash') {
          subContent = this._fixClashWireguard(subContent);
      }

      const headers = this._createSubscriptionHeaders(true);
      return { content: subContent, headers };

    } catch (error) {
      logger.error(error, { customMessage: 'Sub-converter fetch failed' });
      // 转换失败时，回退到返回原生 base64 节点
      const headers = this._createSubscriptionHeaders();
      return { content: safeBtoa(content), headers };
    }
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
          signal: controller.signal,
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
          const decoded = atob(content);
          fetchedNodes.push(applyFilter(decoded, filterConfig));
        } else if (content.includes('://')) {
          fetchedNodes.push(applyFilter(content, filterConfig));
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

  static _getOutputFormat(url, userAgent) {
    const formatMap = {
      'clash': 'clash', 'sing-box': 'singbox', 'singbox': 'singbox',
      'surge': 'surge', 'quantumult%20x': 'quanx', 'loon': 'loon',
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
      sort: 'false',
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
      'Subscription-Userinfo': `upload=0; download=0; total=${total}; expire=${expire}`,
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