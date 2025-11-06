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

export function isBot(userAgent) {
  return /bot|spider|crawl|slurp|ia_archiver/i.test(userAgent);
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
    const headersObj = new Headers(headers || {});
    headersObj.set('Content-Type', contentType);
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
    const headersObj = new Headers(headers || {});
    headersObj.set('Content-Type', 'application/json');

    // 序列化 body 为 JSON 字符串（处理 undefined/特殊值）
    const jsonBody = body !== undefined ? JSON.stringify(body) : 'null';
    return new Response(jsonBody, { status, headers: headersObj });
  }
}

/**
 * Checks if a string is a valid Base64 string.
 * @param {string} str - The string to check.
 * @returns {boolean}
 */
export function isValidBase64(str) {
  if (!str || typeof str !== 'string') return false;
  const cleanStr = str.replace(/\s/g, '');
  return /^[A-Za-z0-9+/=]+$/.test(cleanStr) && cleanStr.length % 4 === 0;
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
