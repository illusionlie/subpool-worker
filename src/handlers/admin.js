import { ConfigService } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { renderAdminPage } from '../views/admin.html.js';
import { renderLoginPage } from '../views/login.html.js';
import { response } from '../utils.js';
import { verifyJwt, createJwt, refreshJwt, getAuthCookie, createAuthCookie } from '../services/auth.js';
import { Router } from 'itty-router';

// 登录处理器
async function handleLogin(request, logger) {
	const { password } = await request.json();
	const adminPassword = ConfigService.get('adminPassword');
	const jwtSecret = ConfigService.getEnv().JWT_SECRET;
  const failedBan = ConfigService.get('failedBan');

	if (!adminPassword || !jwtSecret) {
		logger.fatal('Admin password or JWT secret not set on server.');
		return response.json({ error: 'Admin password or JWT secret not set on server.' }, 500);
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
		return response.json(config);
  });

  // 保存配置
  router.put('/admin/api/config', async () => {
    const newConfig = await request.json();
		// 合并而不是完全替换，防止丢失未在前端展示的配置项
		const oldConfig = await KVService.getGlobalConfig() || {};
		const mergedConfig = { ...oldConfig, ...newConfig };
		await KVService.saveGlobalConfig(mergedConfig);
		logger.info('Global config updated', {}, { notify: true });
		return response.json({ success: true });
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

    const group = await KVService.getGroup(newGroup.name);
    if (group) {
      logger.warn('Group already exists', { GroupName: newGroup.name });
      return response.json({ error: 'Group already exists' }, 400);
    }

    if (!newGroup.token) newGroup.token = crypto.randomUUID();
		await KVService.saveGroup(newGroup);
		logger.info(`Group created`, { GroupName: newGroup.name, Token: newGroup.token }, { notify: true });
		return response.json(newGroup);
  });

  // 更新订阅组
  router.put('/admin/api/groups/:token', async ({ params }) => {
    const token = params.token;
    const groupData = await request.json();
    groupData.token = token;
		await KVService.saveGroup(groupData);
		logger.info(`Group updated`, { GroupName: groupData.name, Token: groupData.token }, { notify: true });
		return response.json(groupData);
  });

  // 删除订阅组
  router.delete('/admin/api/groups/:token', async ({ params }) => {
    const token = params.token;
		await KVService.deleteGroup(token);
		logger.warn(`Group deleted`, { Token: token }, { notify: true });
		return response.json({ success: true });
  });

  // 生成新token
  router.get('/admin/api/utils/gentoken', () => response.json({ token: crypto.randomUUID() }));

  const routerResponse = await router.fetch(request);
  if (routerResponse) return routerResponse;

	return response.json({ error: 'API endpoint not found' }, 404);
}


// 主处理器
export async function handleAdminRequest(request, logger) {
	const url = new URL(request.url);
  const router = Router();
	const jwtSecret = ConfigService.getEnv().JWT_SECRET;
	if (!jwtSecret) {
		logger.fatal('JWT_SECRET is not configured.');
		return response.json({ error: 'JWT_SECRET is not configured.'}, 500);
	}

	// 检查是否是登录API的请求，如果是，则直接处理
  router.post('/admin/api/login', () => handleLogin(request, logger));
  const routerResponse = await router.fetch(request);
  if (routerResponse) return routerResponse;

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
		// 提供主应用
		return response.normal(renderAdminPage(), 200, { 'Set-Cookie': cookie });
	} else {
		// 认证失败
		// 清除可能存在的无效cookie
		const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': createAuthCookie('invalid', 0) };
		return response.normal(renderLoginPage(), 401, headers);
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