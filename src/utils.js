const FILTER_REGEX_LITERAL_PATTERN = /^\/(.*)\/([a-z]*)$/i;
const REGEXP_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;

function escapeRegExpLiteral(value) {
  return value.replace(REGEXP_ESCAPE_PATTERN, '\\$&');
}

function warnInvalidFilterRule(logger, rule, error) {
  if (!logger || typeof logger.warn !== 'function') {
    return;
  }

  logger.warn('Invalid filter rule skipped', {
    rule,
    error: error instanceof Error ? error.message : String(error)
  });
}

function compileFilterRule(rule, logger) {
  if (typeof rule !== 'string' || rule.length === 0) {
    warnInvalidFilterRule(logger, rule, new Error('Rule must be a non-empty string'));
    return null;
  }

  const literalMatch = rule.match(FILTER_REGEX_LITERAL_PATTERN);

  if (literalMatch) {
    const pattern = literalMatch[1];
    const flags = literalMatch[2];

    try {
      const originalRegex = new RegExp(pattern, flags);
      const encodedRegex = new RegExp(encodeURIComponent(pattern), flags);
      return { original: originalRegex, encoded: encodedRegex };
    } catch (error) {
      warnInvalidFilterRule(logger, rule, error);
      return null;
    }
  }

  try {
    const originalRegex = new RegExp(escapeRegExpLiteral(rule));
    const encodedRegex = new RegExp(escapeRegExpLiteral(encodeURIComponent(rule)));
    return { original: originalRegex, encoded: encodedRegex };
  } catch (error) {
    warnInvalidFilterRule(logger, rule, error);
    return null;
  }
}

export function applyFilter(content, filterConfig, logger = null) {
  if (!filterConfig || !filterConfig.enabled || !filterConfig.rules || filterConfig.rules.length === 0) {
    return content;
  }

  // 将字符串规则转换为 RegExp 对象，同时创建 URL 编码版本
  const regexRules = filterConfig.rules
    .map(rule => compileFilterRule(rule, logger))
    .filter(Boolean);

  if (regexRules.length === 0) {
    return content;
  }

  return content.split('\n')
    .filter(line => {
      if (!line.trim()) return true;
      // 同时测试原始规则和编码规则
      return !regexRules.some(ruleSet => {
        ruleSet.original.lastIndex = 0;
        ruleSet.encoded.lastIndex = 0;
        return ruleSet.original.test(line) || ruleSet.encoded.test(line);
      });
    })
    .join('\n');
}


export function createAssetRequest(request, assetPath = null) {
  const assetUrl = new URL(request.url);
  if (assetPath) {
    assetUrl.pathname = assetPath;
    assetUrl.search = '';
  }

  const headers = new Headers(request.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');

  return new Request(assetUrl.toString(), {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers
  });
}

export async function serveAssetResponse(request, assetBinding, assetPath, logger, {
  status = null,
  headers = {},
  notConfiguredMessage = 'ASSETS binding is not configured.',
  notFoundMessage = 'Static asset not found.',
  fetchFailureMessage = 'Failed to fetch static asset',
  logLabel = 'asset fetch'
} = {}) {
  const hasIfNoneMatch = request.headers.has('if-none-match');
  const hasIfModifiedSince = request.headers.has('if-modified-since');

  if (hasIfNoneMatch || hasIfModifiedSince) {
    logger.debug(`Stripping conditional headers before ${logLabel}`, {
      assetPath,
      requestedStatus: status,
      hasIfNoneMatch,
      hasIfModifiedSince
    });
  }

  if (!assetBinding) {
    logger.error('ASSETS binding is not configured.', { assetPath, logLabel });
    return response.normal(notConfiguredMessage, 500, headers);
  }

  try {
    const assetRequest = createAssetRequest(request, assetPath);
    const assetResponse = await assetBinding.fetch(assetRequest);
    const responseStatus = status ?? assetResponse.status;

    logger.debug('Fetched asset response', {
      assetPath,
      assetStatus: assetResponse.status,
      finalStatus: responseStatus,
      contentType: assetResponse.headers.get('Content-Type'),
      logLabel
    });

    if (!assetResponse.ok) {
      logger.error('Asset fetch failed', { assetPath, assetStatus: assetResponse.status, logLabel });
      return response.normal(notFoundMessage, 500, headers);
    }

    return response.fromAsset(assetResponse, responseStatus, headers);
  } catch (err) {
    logger.error(err, { customMessage: fetchFailureMessage, assetPath, logLabel });
    return response.normal('Static asset unavailable.', 500, headers);
  }
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

  fromAsset(assetResponse, status = assetResponse.status, headers = {}) {
    const contentType = assetResponse.headers.get('Content-Type') || 'application/octet-stream';
    const headersObj = new Headers(assetResponse.headers);
    const secureHeaders = this.buildHeaders(headers, contentType);

    secureHeaders.forEach((value, key) => {
      headersObj.set(key, value);
    });

    return new Response(assetResponse.body, { status, headers: headersObj });
  },

  /**
   * JSON 响应方法，强制使用 application/json，忽略传入的 contentType
   * @param {any} body - 响应体（会被序列化为 JSON 字符串）
   * @param {number} [status=200] - HTTP 状态码
   * @param {HeadersInit} [headers={}] - 响应头
   * @param {any} [contentType] - 被忽略的内容类型参数（仅为保持参数一致性）
   * @returns {Response} 返回 JSON 格式的 Response 对象
   */
  json(body, status = 200, headers = {}, _contentType) {
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
      'Content-Security-Policy': csp.join('; ')
    });
    return headersObj;
  }
};

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
