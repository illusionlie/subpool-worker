export function applyFilter(content, filterConfig) {
  if (!filterConfig || !filterConfig.enabled || !filterConfig.rules || filterConfig.rules.length === 0) {
    return content;
  }
  
  // 将字符串规则转换为 RegExp 对象，同时创建URL编码版本
  const regexRules = filterConfig.rules.map(rule => {
    try {
      const match = rule.match(new RegExp('^/(.*?)/([gimy]*)$'));
      const pattern = match[1];
      const flags = match[2];
      
      // 创建原始规则和URL编码规则
      const originalRegex = new RegExp(pattern, flags);
      const encodedRegex = new RegExp(encodeURIComponent(pattern), flags);
      
      return { original: originalRegex, encoded: encodedRegex };
    } catch (e) {
      // 兼容非 /.../i 格式的旧规则
      const originalRegex = new RegExp(rule);
      const encodedRegex = new RegExp(encodeURIComponent(rule));
      return { original: originalRegex, encoded: encodedRegex };
    }
  });

  return content.split('\n')
    .filter(line => {
      if (!line.trim()) return true;
      // 同时测试原始规则和编码规则
      return !regexRules.some(ruleSet => 
        ruleSet.original.test(line) || ruleSet.encoded.test(line)
      );
    })
    .join('\n');
}

// 阻止的 UA 列表
const BOT_UA_PATTERNS = new RegExp([
  'bot',        // Bot 通杀
  'spider',
  'crawler',
  'slurp',      // Yahoo
  'ia_archiver',
  'sogou',
  'facebook',
  'pinterest',
  'ChatGPT-User',
  'QQ',          // QQ
  'MicroMessenger', // 微信
  'request',     // 一些简单的爬虫
  'wget',
].join('|'), 'i');

/**
 * 判断是否为机器人访问
 * @param {Request} request - 请求对象
 * @returns {object} 包含分数和是否为机器人的对象
 */
export function isBot(request) {
  let score = 0;

  // 检查 User-Agent
  const userAgent = request.headers.get('User-Agent') || '';
  if (!userAgent) score += 30;
  if (BOT_UA_PATTERNS.test(userAgent)) score += 50;
  if (!userAgent.includes('Mozilla/5.0') && !(/Chrome|Safari|Firefox|Edg|v2rayN|Clash|sing-box|mihomo|xray/).test(userAgent)) score += 10;

  // 检查 HTTP 版本
  const httpVersion = request.cf?.httpProtocol || '';
  if (httpVersion == 'HTTP/1.0') score += 50;

  // 检查 TLS 版本
  const tlsVersion = request.cf?.tlsVersion || '';
  if (!tlsVersion || tlsVersion == 'TLSv1.0' || tlsVersion == 'TLSv1.1') score += 50;

  // 检查 sec-fetch-*
  const secSite = request.headers.get('sec-fetch-site') || '';
  const secMode = request.headers.get('sec-fetch-mode') || '';
  const secDest = request.headers.get('sec-fetch-dest') || '';
  const secUser = request.headers.get('sec-fetch-user') || '';
  if (!secSite || secMode !== 'navigate' || secDest !== 'document' || !secUser) score += 20;

  // 检查 Accept
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html') || accept.length < 10) score += 10;

  // 赦免 subconverter 的回调
  const subconverterVersion = request.headers.get('subconverter-version') || '';
  const subconverterRequest = request.headers.get('subconverter-request') || '';
  if (subconverterRequest === '1' && subconverterVersion && userAgent.includes('subconverter')) score -= 10;

  return { score, ifBot: score >= 50 };
}


export const response = {
  /**
   * 通用响应方法，使用指定的 content-type
   * @param {any} body - 响应体
   * @param {number} [status=200] - HTTP 状态码
   * @param {HeadersInit} [headers={}] - 响应头
   * @param {string} [contentType='text/plain'] - 内容类型
   * @returns {Response} 返回 Response 对象
   */
  normal(body, status = 200, headers = {}, contentType = 'text/html; charset=utf-8') {
    const headersObj = this.buildHeaders(headers, contentType);
    return new Response(body, { status, headers: headersObj });
  },

  /**
   * JSON 响应方法，强制使用 application/json，忽略传入的 contentType
   * @param {any} body - 响应体（会被序列化为 JSON 字符串）
   * @param {number} [status=200] - HTTP 状态码
   * @param {HeadersInit} [headers={}] - 响应头
   * @param {any} [contentType] - 被忽略的内容类型参数（仅为保持参数一致性）
   * @returns {Response} 返回 JSON 格式的 Response 对象
   */
  json(body, status = 200, headers = {}, contentType) {
    const headersObj = this.buildHeaders(headers, 'application/json');

    // 序列化 body 为 JSON 字符串（处理 undefined/特殊值）
    const jsonBody = body !== undefined ? JSON.stringify(body) : 'null';
    return new Response(jsonBody, { status, headers: headersObj });
  },

  buildHeaders(headers = {}, contentType) {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ];
    const headersObj = new Headers({
      ...headers,
      'Content-Type': contentType,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'fullscreen=(self), camera=(), microphone=(), payment=(self), geolocation=(self)',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'upgrade-insecure-requests': '1',
      'Content-Security-Policy': csp.join('; '),
    });
    return headersObj;
  }
}

/**
 * Checks if a string is a valid Base64 string.
 * @param {string} str - The string to check.
 * @returns {boolean}
 */
export function isValidBase64(str) {
  if (typeof str !== 'string') return false;
  if (str.length === 0) return true; // 空字符串是有效的 Base64
  
  const cleanStr = str.replace(/\s+/g, '');

  // 空字符串检查（清理后可能为空）
  if (cleanStr.length === 0) return false;
  if (cleanStr.length % 4 !== 0) return false;

  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(cleanStr);
}

/**
 * Safely Base64-encodes a string, supporting UTF-8 characters.
 * @param {string} str The string to encode.
 * @returns {string} The Base64-encoded string.
 */
export function safeBtoa(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
