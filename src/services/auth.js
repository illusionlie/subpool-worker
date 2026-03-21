const CONFIG = {
  COOKIE_NAME: 'auth_token',
  DEFAULT_EXPIRATION: 8 * 60 * 60, // 8小时
  ALGORITHM: 'HS256',
  HASH: 'SHA-256',
  COOKIE_PATH: '/admin',
  TOKEN_ISSUER: 'web-app',
  TOKEN_AUDIENCE: 'web-app-users'
};

const textEncoder = new TextEncoder();

/**
 * Base64URL编码
 * @param {string} str - 要编码的字符串
 * @returns {string} Base64URL编码后的字符串
 */
function base64UrlEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL解码
 * @param {string} str - 要解码的字符串
 * @returns {string} 解码后的字符串
 */
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return atob(str);
}

/**
 * 从字符串生成用于签名的密钥
 * @param {string} secret - 密钥字符串
 * @returns {Promise<CryptoKey>} 加密密钥
 */
async function getKey(secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('Invalid secret');
  }

  const keyData = textEncoder.encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: { name: CONFIG.HASH } },
    false,
    ['sign', 'verify']
  );
}

/**
 * 创建JWT
 * @param {string} secret - 用于签名的密钥
 * @param {Object} payload - JWT载荷
 * @param {number} expirationInSeconds - 过期时间（秒）
 * @returns {Promise<string>} JWT令牌
 */
export async function createJwt(secret, payload = {}, logger) {
  if (!secret) {
    logger.fatal('Secret is required to create JWT.');
    throw new Error('Secret is required to create JWT.');
  }

  try {
    const key = await getKey(secret);
    const header = { alg: CONFIG.ALGORITHM, typ: 'JWT' };

    // 添加标准声明
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      ...payload,
      iat: now, // 签发时间
      exp: now + CONFIG.DEFAULT_EXPIRATION, // 过期时间
      iss: CONFIG.TOKEN_ISSUER, // 签发者
      aud: CONFIG.TOKEN_AUDIENCE // 受众
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(jwtPayload));
    const partialToken = `${encodedHeader}.${encodedPayload}`;

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      textEncoder.encode(partialToken)
    );

    const signature = base64UrlEncode(
      String.fromCharCode(...new Uint8Array(signatureBuffer))
    );

    return `${partialToken}.${signature}`;
  } catch (err) {
    logger.error(err, { customMessage: 'Failed to create JWT' });
    throw new Error('Failed to create JWT', { cause: err });
  }
}

/**
 * 验证JWT
 * @param {string} secret - 用于验证的密钥
 * @param {string} token - JWT令牌
 * @returns {Promise<Object|boolean>} 验证成功返回载荷，失败返回false
 */
export async function verifyJwt(secret, token, logger) {
  if (!secret || !token) {
    logger.warn('Secret or token is missing for JWT verification.');
    return false;
  }

  try {
    const key = await getKey(secret);
    const [header, payload, signature] = token.split('.');

    if (!header || !payload || !signature) {
      logger.error('JWT verification error: malformed token');
      return false;
    }

    // 验证签名
    const signatureBuffer = Uint8Array.from(base64UrlDecode(signature), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      textEncoder.encode(`${header}.${payload}`)
    );

    if (!isValid) {
      console.error('JWT verification error: invalid signature');
      return false;
    }

    // 解析并验证载荷
    const payloadData = JSON.parse(base64UrlDecode(payload));
    const now = Math.floor(Date.now() / 1000);

    // 检查过期时间
    if (payloadData.exp && payloadData.exp < now) {
      logger.error('JWT verification error: token expired');
      return false;
    }

    // 检查签发时间
    if (payloadData.iat && payloadData.iat > now) {
      logger.error('JWT verification error: token issued in the future');
      return false;
    }

    // 检查签发者和受众
    if (payloadData.iss !== CONFIG.TOKEN_ISSUER ||
        payloadData.aud !== CONFIG.TOKEN_AUDIENCE) {
      logger.error('JWT verification error: invalid issuer or audience');
      return false;
    }

    return payloadData;
  } catch (err) {
    logger.error('JWT verification error:', err);
    return false;
  }
}

/**
 * 从请求中获取认证Cookie
 * @param {Request} request - 请求对象
 * @returns {string|null} Cookie值或null
 */
export function getAuthCookie(request, logger) {
  if (!request || !request.headers) {
    logger.error('Invalid request object');
    return null;
  }

  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  try {
    const cookies = cookieHeader.split(';');
    const authCookie = cookies.find(c => c.trim().startsWith(`${CONFIG.COOKIE_NAME}=`));

    return authCookie ? authCookie.split('=')[1].trim() : null;
  } catch (err) {
    logger.error(err, { customMessage: 'Error parsing cookies' });
    return null;
  }
}

/**
 * 创建认证Cookie头
 * @param {string} token - JWT令牌
 * @param {number} maxAge - Cookie最大存活时间（秒）
 * @param {Object} options - 额外的Cookie选项
 * @returns {string} Set-Cookie头值
 */
export function createAuthCookie(token, maxAge, options = {}) {
  if (!token || typeof maxAge !== 'number' || isNaN(maxAge)) {
    throw new Error('Token and maxAge are required');
  }

  const {
    path = CONFIG.COOKIE_PATH,
    domain = '',
    sameSite = 'Strict'
  } = options;

  const cookieString = [
    `${CONFIG.COOKIE_NAME}=${token}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'Secure',
    'SameSite=' + sameSite,
    ...(domain ? [`Domain=${domain}`] : [])
  ].join('; ');

  return cookieString;
}

/**
 * 刷新JWT令牌
 * @param {string} secret - 密钥
 * @param {string} token - 当前JWT令牌
 * @param {number} expirationInSeconds - 新令牌的过期时间
 * @returns {Promise<string|null>} 新的JWT令牌或null
 */
export async function refreshJwt(secret, token, logger) {
  if (!secret || !token) {
    logger.error('JWT refresh error: missing secret or token');
    return null;
  }

  try {
    const payload = await verifyJwt(secret, token, logger);
    if (!payload) {
      return null;
    }

    // 创建新令牌，保留原始载荷但更新过期时间
    const originalPayload = { ...payload };
    delete originalPayload.iat;
    delete originalPayload.exp;
    return await createJwt(secret, originalPayload, logger);
  } catch (err) {
    logger.error(err, { customMessage: 'JWT refresh error' });
    return null;
  }
}
