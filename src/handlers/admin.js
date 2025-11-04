import { ConfigService } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { renderAdminPage } from '../views/admin.html.js';
import { renderLoginPage } from '../views/login.html.js';
import { response, generateToken } from '../utils.js';
// import { TelegramService } from '../services/telegram.js';
import { verifyJwt, createJwt, getAuthCookie, createAuthCookie } from '../services/auth.js';

// 登录处理器
async function handleLogin(request, logger) {
	const { password } = await request.json();
	const adminPassword = ConfigService.get('adminPassword');
	const jwtSecret = ConfigService.getEnv().JWT_SECRET;

	if (!adminPassword || !jwtSecret) {
		logger.fatal('Admin password or JWT secret not set on server.');
		return response.json({ error: 'Admin password or JWT secret not set on server.' }, 500);
	}

	if (password === adminPassword) {
		const token = await createJwt(jwtSecret);
		const cookie = createAuthCookie(token, 8 * 60 * 60); // 8 hours
		logger.info('Admin logged in', {}, { notify: true });
		return response.json({ success: true }, 200, { 'Set-Cookie': cookie });
	} else {
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
	const method = request.method;
	const pathParts = url.pathname.split('/').filter(Boolean); // ['admin', 'api', 'groups', 'token123']

	// 路由到不同的 API 处理器
	if (pathParts[2] === 'logout' && method === 'POST') {
		return handleLogout();
	}
	if (pathParts[2] === 'config' && method === 'GET') {
		const config = await KVService.getGlobalConfig() || ConfigService.get();
		return response.json(config);
	}
	if (pathParts[2] === 'config' && method === 'PUT') {
		const newConfig = await request.json();
		// 合并而不是完全替换，防止丢失未在前端展示的配置项
		const oldConfig = await KVService.getGlobalConfig() || {};
		const mergedConfig = { ...oldConfig, ...newConfig };
		await KVService.saveGlobalConfig(mergedConfig);
		logger.info('Global config updated', {}, { notify: true });
		return response.json({ success: true });
	}
	if (pathParts[2] === 'groups' && method === 'GET') {
		const groups = await KVService.getAllGroups();
		return response.json(groups);
	}
	if (pathParts[2] === 'groups' && method === 'POST') {
		const newGroup = await request.json();
		if (!newGroup.token) newGroup.token = generateToken();
		await KVService.saveGroup(newGroup);
		logger.info(`Group created`, { GroupName: newGroup.name, Token: newGroup.token }, { notify: true });
		return response.json(newGroup);
	}
	if (pathParts[2] === 'groups' && pathParts[3] && method === 'PUT') {
		const token = pathParts[3];
		const groupData = await request.json();
		groupData.token = token;
		await KVService.saveGroup(groupData);
		logger.info(`Group updated`, { GroupName: groupData.name, Token: groupData.token }, { notify: true });
		return response.json(groupData);
	}
	if (pathParts[2] === 'groups' && pathParts[3] && method === 'DELETE') {
		const token = pathParts[3];
		await KVService.deleteGroup(token);
		logger.warn(`Group deleted`, { Token: token }, { notify: true });
		return response.json({ success: true });
	}
	if (pathParts[2] === 'utils' && pathParts[3] === 'gentoken' && method === 'GET') {
		return response.json({ token: generateToken() });
	}

	return response.json({ error: 'API endpoint not found' }, 404);
}


// 主处理器
export async function handleAdminRequest(request, logger) {
	const url = new URL(request.url);
	const jwtSecret = ConfigService.getEnv().JWT_SECRET;
	if (!jwtSecret) {
		logger.fatal('JWT_SECRET is not configured.');
		return response.json({ error: 'JWT_SECRET is not configured.'}, 500);
	}

	// 1. 检查是否是登录API的请求，如果是，则直接处理
	if (url.pathname === '/admin/api/login' && request.method === 'POST') {
		return handleLogin(request, logger);
	}

	// 2. 验证所有其他 /admin 请求的JWT
	const token = getAuthCookie(request);
	const isValid = await verifyJwt(jwtSecret, token);

	if (isValid) {
		// 认证通过
		if (url.pathname.startsWith('/admin/api/')) {
			// 处理API请求
			return handleApiRequest(request, url, logger);
		}
		// 提供主应用
		return response.normal(renderAdminPage());
	} else {
		// 认证失败
		// 清除可能存在的无效cookie
		const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': createAuthCookie('invalid', 0) };
		return response.normal(renderLoginPage(), 401, headers);
	}
}