import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../src/router.js';

class InMemoryKV {
  constructor() {
    this.store = new Map();
  }

  seedJson(key, value) {
    this.store.set(key, JSON.stringify(value));
  }

  async get(key, type = 'text') {
    if (!this.store.has(key)) {
      return null;
    }

    const value = this.store.get(key);

    if (type === 'json') {
      if (typeof value !== 'string') {
        return value;
      }

      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  async put(key, value, _options = {}) {
    if (typeof value === 'string') {
      this.store.set(key, value);
      return;
    }

    this.store.set(key, JSON.stringify(value));
  }

  async delete(key) {
    this.store.delete(key);
  }
}

function createAssetsBinding() {
  return {
    async fetch(_request) {
      return new Response('<html>asset</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  };
}

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {}
  };
}

function createCtx() {
  return {
    waitUntil() {}
  };
}

function createEnv(initialGlobalConfig = null) {
  const kv = new InMemoryKV();
  if (initialGlobalConfig) {
    kv.seedJson('config:global', initialGlobalConfig);
  }

  return {
    kv,
    env: {
      KV: kv,
      ASSETS: createAssetsBinding(),
      INIT_SECRET: 'test-init-secret',
      LOG_LEVEL: 'none',
      DEBUG_SECRET: 'debug-secret'
    }
  };
}

async function dispatchRequest(path, {
  env,
  logger,
  ctx,
  method = 'GET',
  headers = {},
  body = undefined
} = {}) {
  const requestHeaders = new Headers(headers);
  let requestBody;

  if (body !== undefined) {
    requestBody = typeof body === 'string' ? body : JSON.stringify(body);
    if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }
  }

  const request = new Request(`https://example.com${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody
  });

  return handleRequest(request, env, ctx, logger);
}

function extractCookie(response) {
  const setCookie = response.headers.get('Set-Cookie');
  assert.ok(setCookie, 'expected response to include Set-Cookie header');
  return setCookie.split(';')[0];
}

test('后台 API 流程：初始化 -> 登录 -> 配置保存 -> 组 CRUD', async () => {
  const { env, kv } = createEnv({
    telegram: {
      enabled: false,
      botToken: 'should-be-preserved',
      chatId: ''
    },
    hiddenField: {
      keep: true
    }
  });

  const logger = createLogger();
  const ctx = createCtx();

  const initResponse = await dispatchRequest('/admin/api/init', {
    env,
    logger,
    ctx,
    method: 'POST',
    headers: {
      'X-Init-Secret': 'test-init-secret'
    },
    body: {
      password: 'StrongPass123',
      confirmPassword: 'StrongPass123'
    }
  });

  assert.equal(initResponse.status, 200);
  assert.equal((await initResponse.json()).success, true);

  const loginResponse = await dispatchRequest('/admin/api/login', {
    env,
    logger,
    ctx,
    method: 'POST',
    body: {
      password: 'StrongPass123'
    }
  });

  assert.equal(loginResponse.status, 200);
  assert.equal((await loginResponse.json()).success, true);

  let authCookie = extractCookie(loginResponse);

  const saveConfigResponse = await dispatchRequest('/admin/api/config', {
    env,
    logger,
    ctx,
    method: 'PUT',
    headers: {
      Cookie: authCookie
    },
    body: {
      fileName: 'flow-test-subscription',
      telegram: {
        enabled: true,
        chatId: '10086'
      },
      failedBan: {
        enabled: true,
        maxAttempts: 3,
        banDuration: 120,
        failedAttemptsTtl: 120
      }
    }
  });

  assert.equal(saveConfigResponse.status, 200);
  assert.deepEqual(await saveConfigResponse.json(), {
    success: true,
    passwordChanged: false
  });
  authCookie = extractCookie(saveConfigResponse);

  const getConfigResponse = await dispatchRequest('/admin/api/config', {
    env,
    logger,
    ctx,
    headers: {
      Cookie: authCookie
    }
  });

  assert.equal(getConfigResponse.status, 200);
  const safeConfig = await getConfigResponse.json();
  assert.equal(safeConfig.fileName, 'flow-test-subscription');
  assert.equal(safeConfig.telegram.enabled, true);
  assert.equal(safeConfig.telegram.chatId, '10086');
  assert.equal(safeConfig.telegram.botToken, 'should-be-preserved');
  assert.equal(Object.hasOwn(safeConfig, 'adminPassword'), false);
  assert.equal(Object.hasOwn(safeConfig, 'adminPasswordHash'), false);
  assert.equal(Object.hasOwn(safeConfig, 'adminPasswordSalt'), false);
  assert.equal(Object.hasOwn(safeConfig, 'adminPasswordHashIterations'), false);
  assert.equal(Object.hasOwn(safeConfig, 'jwtSecret'), false);
  authCookie = extractCookie(getConfigResponse);

  const groupToken = 'flow-group-token';

  const createGroupResponse = await dispatchRequest('/admin/api/groups', {
    env,
    logger,
    ctx,
    method: 'POST',
    headers: {
      Cookie: authCookie
    },
    body: {
      name: 'Flow Group',
      token: groupToken,
      allowChinaAccess: true,
      nodes: 'vmess://node-a',
      filter: {
        enabled: false,
        rules: []
      }
    }
  });

  assert.equal(createGroupResponse.status, 200);
  const createdGroup = await createGroupResponse.json();
  assert.equal(createdGroup.name, 'Flow Group');
  assert.equal(createdGroup.token, groupToken);
  authCookie = extractCookie(createGroupResponse);

  const listGroupsResponse = await dispatchRequest('/admin/api/groups', {
    env,
    logger,
    ctx,
    headers: {
      Cookie: authCookie
    }
  });

  assert.equal(listGroupsResponse.status, 200);
  const groupsAfterCreate = await listGroupsResponse.json();
  assert.equal(groupsAfterCreate.length, 1);
  assert.equal(groupsAfterCreate[0].token, groupToken);
  authCookie = extractCookie(listGroupsResponse);

  const updateGroupResponse = await dispatchRequest(`/admin/api/groups/${groupToken}`, {
    env,
    logger,
    ctx,
    method: 'PUT',
    headers: {
      Cookie: authCookie
    },
    body: {
      name: 'Flow Group Updated',
      allowChinaAccess: false,
      nodes: 'vmess://node-b',
      filter: {
        enabled: true,
        rules: ['remove-me']
      }
    }
  });

  assert.equal(updateGroupResponse.status, 200);
  const updatedGroup = await updateGroupResponse.json();
  assert.equal(updatedGroup.name, 'Flow Group Updated');
  assert.equal(updatedGroup.token, groupToken);
  assert.equal(updatedGroup.allowChinaAccess, false);
  authCookie = extractCookie(updateGroupResponse);

  const deleteGroupResponse = await dispatchRequest(`/admin/api/groups/${groupToken}`, {
    env,
    logger,
    ctx,
    method: 'DELETE',
    headers: {
      Cookie: authCookie
    }
  });

  assert.equal(deleteGroupResponse.status, 200);
  assert.equal((await deleteGroupResponse.json()).success, true);
  authCookie = extractCookie(deleteGroupResponse);

  const finalListResponse = await dispatchRequest('/admin/api/groups', {
    env,
    logger,
    ctx,
    headers: {
      Cookie: authCookie
    }
  });

  assert.equal(finalListResponse.status, 200);
  assert.deepEqual(await finalListResponse.json(), []);

  const storedConfig = await kv.get('config:global', 'json');
  assert.ok(storedConfig, 'stored global config should exist');
  assert.equal(storedConfig.hiddenField.keep, true);
  assert.equal(storedConfig.telegram.botToken, 'should-be-preserved');
  assert.equal(typeof storedConfig.adminPasswordHash, 'string');
  assert.equal(typeof storedConfig.adminPasswordSalt, 'string');
  assert.equal(typeof storedConfig.adminPasswordHashIterations, 'number');
  assert.equal(storedConfig.adminPassword, '');
  assert.equal(typeof storedConfig.jwtSecret, 'string');

  assert.deepEqual(await kv.get('groups:index', 'json'), []);
  assert.equal(await kv.get(`group:${groupToken}`, 'json'), null);
});
