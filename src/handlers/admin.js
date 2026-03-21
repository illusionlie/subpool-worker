import { ConfigService, deepMerge } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { response, serveAssetResponse } from '../utils.js';
import { verifyJwt, createJwt, refreshJwt, getAuthCookie, createAuthCookie } from '../services/auth.js';
import { Router } from 'itty-router';

const INIT_LOCK_KEY = 'admin:init:lock';
const INIT_LOCK_TTL_SECONDS = 60;
const INIT_LOCK_MAX_RETRIES = 5;
const INIT_LOCK_RETRY_DELAY_MS = 120;

function hasConfiguredAdminPassword(config) {
  const adminPassword = config?.adminPassword;
  return typeof adminPassword === 'string' && adminPassword.trim().length > 0;
}

function hasConfiguredJwtSecret(config) {
  const jwtSecret = config?.jwtSecret;
  return typeof jwtSecret === 'string' && jwtSecret.trim().length > 0;
}

function getJwtSecretFromConfig() {
  const jwtSecret = ConfigService.get('jwtSecret');
  return typeof jwtSecret === 'string' ? jwtSecret.trim() : '';
}

function generateJwtSecret(byteLength = 48) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateJwtSecretForInitializedAdmin(logger) {
  const currentJwtSecret = getJwtSecretFromConfig();
  if (currentJwtSecret) {
    return currentJwtSecret;
  }

  if (!isAdminInitialized()) {
    return '';
  }

  const oldConfig = await KVService.getGlobalConfig() || {};
  if (hasConfiguredJwtSecret(oldConfig)) {
    await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());
    return getJwtSecretFromConfig();
  }

  const nextJwtSecret = generateJwtSecret();
  const mergedConfig = deepMerge({}, oldConfig, { jwtSecret: nextJwtSecret });
  await KVService.saveGlobalConfig(mergedConfig);

  const latestConfig = await KVService.getGlobalConfig() || {};
  if (!hasConfiguredJwtSecret(latestConfig)) {
    logger.fatal('JWT secret regeneration failed for initialized admin.');
    return '';
  }

  await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());
  logger.warn('JWT secret was missing and has been regenerated for initialized admin.', {}, { notify: true });
  return getJwtSecretFromConfig();
}

function isAdminInitialized() {
  return hasConfiguredAdminPassword({ adminPassword: ConfigService.get('adminPassword') });
}

function isInitSecretConfigured() {
  const initSecret = ConfigService.getEnv().INIT_SECRET;
  return typeof initSecret === 'string' && initSecret.trim().length > 0;
}

function getRequestInitSecret(request, payload) {
  const headerSecret = request.headers.get('X-Init-Secret');
  if (typeof headerSecret === 'string' && headerSecret.trim()) {
    return headerSecret.trim();
  }

  return typeof payload?.initSecret === 'string' ? payload.initSecret.trim() : '';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireInitializationLock(lockOwner, logger) {
  for (let attempt = 0; attempt < INIT_LOCK_MAX_RETRIES; attempt += 1) {
    const now = Date.now();
    const existingLock = await KVService.get(INIT_LOCK_KEY);

    if (!existingLock || typeof existingLock.expiresAt !== 'number' || existingLock.expiresAt <= now) {
      const lockPayload = { owner: lockOwner, expiresAt: now + INIT_LOCK_TTL_SECONDS * 1000 };
      await KVService.put(INIT_LOCK_KEY, JSON.stringify(lockPayload), { expirationTtl: INIT_LOCK_TTL_SECONDS });

      const confirmedLock = await KVService.get(INIT_LOCK_KEY);
      if (confirmedLock?.owner === lockOwner) {
        return true;
      }
    }

    if (attempt < INIT_LOCK_MAX_RETRIES - 1) {
      await wait(INIT_LOCK_RETRY_DELAY_MS);
    }
  }

  logger.warn('Failed to acquire admin initialization lock due to concurrent setup attempts.');
  return false;
}

async function releaseInitializationLock(lockOwner, logger) {
  try {
    const existingLock = await KVService.get(INIT_LOCK_KEY);
    if (existingLock?.owner === lockOwner) {
      await KVService.put(
        INIT_LOCK_KEY,
        JSON.stringify({ owner: 'released', releasedAt: Date.now() }),
        { expirationTtl: 1 }
      );
    }
  } catch (err) {
    logger.error(err, { customMessage: 'Failed to release admin initialization lock' });
  }
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 登录处理器
async function handleLogin(request, logger) {
  const payload = await readJsonBody(request);
  const password = typeof payload?.password === 'string' ? payload.password.trim() : '';
  const adminPassword = ConfigService.get('adminPassword');
  const jwtSecret = await getOrCreateJwtSecretForInitializedAdmin(logger);
  const failedBan = ConfigService.get('failedBan');

  if (!isAdminInitialized()) {
    logger.warn('Login attempted before admin initialization.');
    return response.json({ error: 'Admin is not initialized. Please complete initial setup first.' }, 403);
  }

  if (!jwtSecret) {
    logger.fatal('JWT secret is not set on server.');
    return response.json({ error: 'JWT secret is not set on server.' }, 500);
  }

  if (!password) {
    return response.json({ error: 'Password is required.' }, 400);
  }

	if (constantTimeCompare(password, adminPassword)) {
		const token = await createJwt(jwtSecret, {}, logger);
		const cookie = createAuthCookie(token, 8 * 60 * 60); // 8 hours
		logger.info('Admin logged in', {}, { notify: true });
		return response.json({ success: true }, 200, { 'Set-Cookie': cookie });
	} else {
    // 失败登录记录，防止暴力破解
    if (failedBan.enabled) {
      const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

      // 检查是否被ban
      const banned = await KVService.get(`banned::${ip}`);
      if (banned) {
        logger.warn('Banned IP attempted login', {}, { notify: true });
        return response.json({ error: 'Too many failed attempts, please try again later.' }, 429);
      }

      // 检查失败次数
      const attempts = await KVService.get(`failedAttempts::${ip}`) || 0;
      if (attempts >= failedBan.maxAttempts) {
        await KVService.put(`banned::${ip}`, true, { expirationTtl: failedBan.banDuration });
        logger.warn('Banned IP attempted login', {}, { notify: true });
        return response.json({ error: 'Too many failed attempts, please try again later.' }, 429);
      } else {
        await KVService.put(`failedAttempts::${ip}`, attempts + 1, { expirationTtl: failedBan.failedAttemptsTtl });
      }
    }

		logger.warn('Admin login attempt failed', {}, { notify: true });
		return response.json({ error: 'Invalid password' }, 401);
	}
}

async function handleInitialSetup(request, logger) {
  if (isAdminInitialized()) {
    logger.warn('Admin initialization attempted after setup is already complete.');
    return response.json({ error: 'Admin is already initialized.' }, 409);
  }

  if (!isInitSecretConfigured()) {
    logger.fatal('INIT_SECRET is not set on server.');
    return response.json({ error: 'INIT_SECRET is not set on server.' }, 500);
  }

  const payload = await readJsonBody(request);
  const expectedInitSecret = ConfigService.getEnv().INIT_SECRET.trim();
  const initSecretInput = getRequestInitSecret(request, payload);

  if (!initSecretInput) {
    return response.json({ error: 'Initialization secret is required.' }, 401);
  }

  if (!constantTimeCompare(initSecretInput, expectedInitSecret)) {
    logger.warn('Admin initialization rejected due to invalid initialization secret.');
    return response.json({ error: 'Invalid initialization secret.' }, 401);
  }

  const password = typeof payload?.password === 'string' ? payload.password.trim() : '';
  const confirmPassword = typeof payload?.confirmPassword === 'string' ? payload.confirmPassword.trim() : '';

  if (!password || password.length < 6) {
    return response.json({ error: 'Password must be at least 6 characters.' }, 400);
  }

  if (!confirmPassword) {
    return response.json({ error: 'Please confirm your password.' }, 400);
  }

  if (password !== confirmPassword) {
    return response.json({ error: 'Passwords do not match.' }, 400);
  }

  const lockOwner = crypto.randomUUID();
  const lockAcquired = await acquireInitializationLock(lockOwner, logger);
  if (!lockAcquired) {
    return response.json({ error: 'Initialization is already in progress. Please try again shortly.' }, 409);
  }

  try {
    const oldConfig = await KVService.getGlobalConfig() || {};
    if (hasConfiguredAdminPassword(oldConfig)) {
      return response.json({ error: 'Admin is already initialized.' }, 409);
    }

    const nextJwtSecret = generateJwtSecret();
    const mergedConfig = deepMerge({}, oldConfig, {
      adminPassword: password,
      jwtSecret: nextJwtSecret
    });
    await KVService.saveGlobalConfig(mergedConfig);

    const latestConfig = await KVService.getGlobalConfig() || {};
    if (
      !hasConfiguredAdminPassword(latestConfig)
      || latestConfig.adminPassword !== password
      || !hasConfiguredJwtSecret(latestConfig)
      || latestConfig.jwtSecret !== nextJwtSecret
    ) {
      logger.warn('Admin initialization conflict detected after config write.', {}, { notify: true });
      return response.json({ error: 'Initialization conflict detected. Please retry.' }, 409);
    }

    await ConfigService.init(ConfigService.getEnv(), ConfigService.getCtx());

    const jwtSecret = getJwtSecretFromConfig();
    if (!jwtSecret) {
      logger.fatal('JWT secret is missing after initialization.');
      return response.json({ error: 'JWT secret is missing after initialization.' }, 500);
    }

    const token = await createJwt(jwtSecret, {}, logger);
    const cookie = createAuthCookie(token, 8 * 60 * 60);

    logger.warn('Admin initial password configured.', {}, { notify: true });
    return response.json({ success: true }, 200, { 'Set-Cookie': cookie });
  } finally {
    await releaseInitializationLock(lockOwner, logger);
  }
}

// 登出处理器
function handleLogout() {
	const cookie = createAuthCookie('logged_out', 0); // Expire immediately
	return response.json({ success: true }, 200, { 'Set-Cookie': cookie });
}

// API请求处理器 (它假设请求已通过认证)
async function handleApiRequest(request, url, logger) {
  const router = Router();

	// 登出
  router.post('/admin/api/logout', () => handleLogout());

  // 获取配置
  router.get('/admin/api/config', async () => {
    const config = await KVService.getGlobalConfig() || ConfigService.get();
    const safeConfig = { ...config };
    delete safeConfig.adminPassword;
    delete safeConfig.jwtSecret;
    return response.json(safeConfig);
  });

  // 保存配置
  router.put('/admin/api/config', async () => {
    const newConfig = await readJsonBody(request);
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
      return response.json({ error: 'Invalid config payload.' }, 400);
    }

    if ('jwtSecret' in newConfig) {
      delete newConfig.jwtSecret;
    }

    let passwordChanged = false;
    if ('adminPassword' in newConfig) {
      const nextPassword = typeof newConfig.adminPassword === 'string'
        ? newConfig.adminPassword.trim()
        : '';

      if (!nextPassword) {
        delete newConfig.adminPassword;
      } else {
        if (nextPassword.length < 6) {
          return response.json({ error: 'Password must be at least 6 characters.' }, 400);
        }

        const currentPassword = ConfigService.get('adminPassword');
        passwordChanged = !hasConfiguredAdminPassword({ adminPassword: currentPassword })
          || !constantTimeCompare(nextPassword, currentPassword);

        newConfig.adminPassword = nextPassword;

        if (passwordChanged) {
          newConfig.jwtSecret = generateJwtSecret();
        }
      }
    }

    // 合并而不是完全替换，防止丢失未在前端展示的配置项
    const oldConfig = await KVService.getGlobalConfig() || {};
    const mergedConfig = deepMerge({}, oldConfig, newConfig);
    await KVService.saveGlobalConfig(mergedConfig);

    const responseHeaders = {};
    if (passwordChanged) {
      const jwtSecret = typeof mergedConfig.jwtSecret === 'string'
        ? mergedConfig.jwtSecret.trim()
        : '';

      if (!jwtSecret) {
        logger.fatal('JWT secret is missing after password update.');
        return response.json({ error: 'JWT secret is missing after password update.' }, 500);
      }

      const token = await createJwt(jwtSecret, {}, logger);
      responseHeaders['Set-Cookie'] = createAuthCookie(token, 8 * 60 * 60);
      logger.warn('Admin password updated and JWT secret rotated.', {}, { notify: true });
    } else {
      logger.info('Global config updated', {}, { notify: true });
    }

    return response.json({ success: true, passwordChanged }, 200, responseHeaders);
  });

  // 获取所有订阅组
  router.get('/admin/api/groups', async () => {
    const groups = await KVService.getAllGroups();
		return response.json(groups);
  });

  // 创建新订阅组
  router.post('/admin/api/groups', async () => {
    const newGroup = await request.json();
    if (!newGroup || typeof newGroup.name !== 'string' || !newGroup.name.trim()) {
      logger.warn('Invalid group data', { GroupData: newGroup });
      return response.json({ error: 'Invalid group data' }, 400);
    }

    // 生成随机token
    if (!newGroup.token) newGroup.token = crypto.randomUUID();
    if (!newGroup.token || typeof newGroup.token !== 'string' || !newGroup.token.trim()) {
      logger.warn('Invalid group data', { GroupData: newGroup });
      return response.json({ error: 'Invalid group data' }, 400);
    }

    // 检查token是否已存在
    const group = await KVService.getGroup(newGroup.token);
    if (group) {
      logger.warn('Group already exists', { GroupName: newGroup.name });
      return response.json({ error: 'Group already exists' }, 400);
    }

		await KVService.saveGroup(newGroup);
		logger.info('Group created', { GroupName: newGroup.name, Token: newGroup.token }, { notify: true });
		return response.json(newGroup);
  });

  // 更新订阅组
  router.put('/admin/api/groups/:token', async ({ params }) => {
    const token = params.token;
    const groupData = await request.json();
    groupData.token = token;
		await KVService.saveGroup(groupData);
		logger.info('Group updated', { GroupName: groupData.name, Token: groupData.token }, { notify: true });
		return response.json(groupData);
  });

  // 删除订阅组
  router.delete('/admin/api/groups/:token', async ({ params }) => {
    const token = params.token;
		await KVService.deleteGroup(token);
		logger.warn('Group deleted', { Token: token }, { notify: true });
		return response.json({ success: true });
  });

  // 生成新token
  router.get('/admin/api/utils/gentoken', () => response.json({ token: crypto.randomUUID() }));

  const routerResponse = await router.fetch(request);
  if (routerResponse) return routerResponse;

	return response.json({ error: 'API endpoint not found' }, 404);
}


async function fetchAdminAsset(request, assetPath, logger, status = null, headers = {}) {
  return serveAssetResponse(request, ConfigService.getEnv().ASSETS, assetPath, logger, {
    status,
    headers,
    notConfiguredMessage: 'Admin asset is unavailable because ASSETS binding is not configured.',
    notFoundMessage: 'Admin asset not found.',
    fetchFailureMessage: 'Failed to fetch admin asset',
    logLabel: 'admin asset fetch'
  });
}

function isAdminEntryPage(pathname) {
  return pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/index.html';
}

function isAdminInitPage(pathname) {
  return pathname === '/admin/init' || pathname === '/admin/init/' || pathname === '/admin/init.html';
}

// 主处理器
export async function handleAdminRequest(request, logger) {
	const url = new URL(request.url);
  const router = Router();
	const { ASSETS } = ConfigService.getEnv();
  if (!ASSETS) {
    logger.fatal('ASSETS binding is not configured.');
    return response.json({ error: 'ASSETS binding is not configured.' }, 500);
  }

  const initialized = isAdminInitialized();
  const initSecretConfigured = isInitSecretConfigured();

 // 检查是否是公开API请求，如果是，则直接处理
  router.get('/admin/api/init/status', () => response.json({ initialized, initSecretConfigured }, 200));
  router.post('/admin/api/init', () => handleInitialSetup(request, logger));
  router.post('/admin/api/login', () => handleLogin(request, logger));
  const routerResponse = await router.fetch(request);
  if (routerResponse) return routerResponse;

  if (!initialized) {
    if (!initSecretConfigured) {
      logger.fatal('INIT_SECRET is required before admin initialization.');
      return response.normal('INIT_SECRET is not configured.', 500, { 'Set-Cookie': createAuthCookie('invalid', 0) }, 'text/plain; charset=utf-8');
    }

    if (url.pathname.startsWith('/admin/api/')) {
      return response.json({ error: 'Admin is not initialized. Please complete initial setup first.' }, 403);
    }

    if (isAdminEntryPage(url.pathname) || isAdminInitPage(url.pathname)) {
      return fetchAdminAsset(request, '/admin/init.html', logger, 200, { 'Set-Cookie': createAuthCookie('invalid', 0) });
    }

    return response.normal('Admin is not initialized yet.', 403, { 'Set-Cookie': createAuthCookie('invalid', 0) }, 'text/plain; charset=utf-8');
  }

	 const jwtSecret = await getOrCreateJwtSecretForInitializedAdmin(logger);
	 if (!jwtSecret) {
	   logger.fatal('JWT secret is not configured for initialized admin.');
	   return response.json(
	     { error: 'JWT secret is not configured for initialized admin.' },
	     500,
	     { 'Set-Cookie': createAuthCookie('invalid', 0) }
	   );
	 }

	// 验证所有其他 /admin 请求的JWT
	const token = getAuthCookie(request, logger);
	const isValid = await verifyJwt(jwtSecret, token, logger);

	if (isValid) {
		// 认证通过
		// 刷新JWT
		const newToken = await refreshJwt(jwtSecret, token, logger);
		const cookie = createAuthCookie(newToken, 8 * 60 * 60); // 8 hours
		if (url.pathname.startsWith('/admin/api/')) {
			// 处理API请求
			return handleApiRequest(request, url, logger);
		}

      if (isAdminInitPage(url.pathname)) {
        return fetchAdminAsset(request, '/admin/index.html', logger, 200, { 'Set-Cookie': cookie });
      }

		  if (isAdminEntryPage(url.pathname)) {
		    // 管理后台入口始终返回主页面
		    return fetchAdminAsset(request, '/admin/index.html', logger, 200, { 'Set-Cookie': cookie });
		  }

		  // 其他 /admin/* 路径按静态资源原路径返回（例如 /admin/js/index.js）
		  return fetchAdminAsset(request, url.pathname, logger, null, { 'Set-Cookie': cookie });
	} else {
		// 认证失败
		// 清除可能存在的无效cookie
		  const expiredCookieHeaders = { 'Set-Cookie': createAuthCookie('invalid', 0) };

		  if (url.pathname.startsWith('/admin/api/')) {
		    return response.json({ error: 'Unauthorized' }, 401, expiredCookieHeaders);
		  }

      if (isAdminInitPage(url.pathname)) {
        return fetchAdminAsset(request, '/admin/login.html', logger, 401, expiredCookieHeaders);
      }

		  if (isAdminEntryPage(url.pathname)) {
		    return fetchAdminAsset(request, '/admin/login.html', logger, 401, expiredCookieHeaders);
		  }

		  return response.normal('Unauthorized.', 401, expiredCookieHeaders, 'text/plain; charset=utf-8');
	}
}

/**
 * 常量时间比较函数，用于安全地比较字符串
 * @param {string} a - 第一个字符串
 * @param {string} b - 第二个字符串
 * @returns {boolean} 如果两个字符串相等返回true，否则返回false
 */
function constantTimeCompare(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
