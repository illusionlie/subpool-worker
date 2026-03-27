import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../src/router.js';

class InMemoryKV {
  constructor() {
    this.store = new Map();
    this.failures = [];
  }

  seedJson(key, value) {
    this.store.set(key, JSON.stringify(value));
  }

  queueFailure({
    operation,
    key,
    times = 1,
    message = 'Injected KV failure.'
  }) {
    this.failures.push({ operation, key, times, message });
  }

  maybeThrow(operation, key) {
    for (const failure of this.failures) {
      if (!failure || failure.times <= 0 || failure.operation !== operation) {
        continue;
      }

      const matchKey = failure.key;
      const matched = matchKey instanceof RegExp
        ? matchKey.test(key)
        : matchKey === key;

      if (!matched) {
        continue;
      }

      failure.times -= 1;
      throw new Error(failure.message);
    }
  }

  async get(key, type = 'text') {
    this.maybeThrow('get', key);

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
    this.maybeThrow('put', key);

    if (typeof value === 'string') {
      this.store.set(key, value);
      return;
    }

    this.store.set(key, JSON.stringify(value));
  }

  async delete(key) {
    this.maybeThrow('delete', key);
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

async function initializeAdminSession({
  env,
  logger,
  ctx,
  password = 'StrongPass123'
}) {
  const initResponse = await dispatchRequest('/admin/api/init', {
    env,
    logger,
    ctx,
    method: 'POST',
    headers: {
      'X-Init-Secret': 'test-init-secret'
    },
    body: {
      password,
      confirmPassword: password
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
      password
    }
  });

  assert.equal(loginResponse.status, 200);
  assert.equal((await loginResponse.json()).success, true);
  return extractCookie(loginResponse);
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

test('后台 API 流程：创建/更新订阅组应拒绝订阅端不可访问的非法 token', async () => {
  const logger = createLogger();
  const ctx = createCtx();
  const { env, kv } = createEnv();

  let authCookie = await initializeAdminSession({
    env,
    logger,
    ctx,
    password: 'GroupTokenGuardPass123'
  });

  const invalidCreateResponse = await dispatchRequest('/admin/api/groups', {
    env,
    logger,
    ctx,
    method: 'POST',
    headers: {
      Cookie: authCookie
    },
    body: {
      name: 'Invalid Token Group',
      token: 'invalid/token',
      allowChinaAccess: true,
      nodes: 'vmess://invalid',
      filter: {
        enabled: false,
        rules: []
      }
    }
  });

  assert.equal(invalidCreateResponse.status, 400);
  assert.equal((await invalidCreateResponse.json()).error, 'Invalid group data');
  authCookie = extractCookie(invalidCreateResponse);

  assert.equal(await kv.get('groups:index', 'json'), null);

  const validToken = 'valid-group-token';
  const createValidResponse = await dispatchRequest('/admin/api/groups', {
    env,
    logger,
    ctx,
    method: 'POST',
    headers: {
      Cookie: authCookie
    },
    body: {
      name: 'Valid Token Group',
      token: validToken,
      allowChinaAccess: false,
      nodes: 'vmess://valid',
      filter: {
        enabled: false,
        rules: []
      }
    }
  });

  assert.equal(createValidResponse.status, 200);
  authCookie = extractCookie(createValidResponse);

  const overLengthToken = 'a'.repeat(129);
  const invalidUpdateResponse = await dispatchRequest(`/admin/api/groups/${overLengthToken}`, {
    env,
    logger,
    ctx,
    method: 'PUT',
    headers: {
      Cookie: authCookie
    },
    body: {
      name: 'Should Not Persist',
      allowChinaAccess: true,
      nodes: 'vmess://changed',
      filter: {
        enabled: true,
        rules: ['drop-me']
      }
    }
  });

  assert.equal(invalidUpdateResponse.status, 400);
  assert.equal((await invalidUpdateResponse.json()).error, 'Invalid group data');

  const storedValidGroup = await kv.get(`group:${validToken}`, 'json');
  assert.ok(storedValidGroup);
  assert.equal(storedValidGroup.name, 'Valid Token Group');
  assert.equal(storedValidGroup.nodes, 'vmess://valid');

  assert.equal(await kv.get(`group:${overLengthToken}`, 'json'), null);
  assert.deepEqual(await kv.get('groups:index', 'json'), [validToken]);
});

test('后台 API 流程：达到失败阈值当次应返回 429 并写入封禁状态', async () => {
  const logger = createLogger();
  const ctx = createCtx();
  const { env, kv } = createEnv();

  const authCookie = await initializeAdminSession({
    env,
    logger,
    ctx,
    password: 'ThresholdPass123'
  });

  const failedBanConfig = {
    enabled: true,
    maxAttempts: 3,
    banDuration: 120,
    failedAttemptsTtl: 120
  };

  const saveConfigResponse = await dispatchRequest('/admin/api/config', {
    env,
    logger,
    ctx,
    method: 'PUT',
    headers: {
      Cookie: authCookie
    },
    body: {
      failedBan: failedBanConfig
    }
  });

  assert.equal(saveConfigResponse.status, 200);

  const loginIp = '198.51.100.24';

  for (let index = 1; index <= failedBanConfig.maxAttempts; index += 1) {
    const response = await dispatchRequest('/admin/api/login', {
      env,
      logger,
      ctx,
      method: 'POST',
      headers: {
        'cf-connecting-ip': loginIp
      },
      body: {
        password: 'WrongPass'
      }
    });

    if (index < failedBanConfig.maxAttempts) {
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'Invalid password');
      continue;
    }

    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'Too many failed attempts, please try again later.');
  }

  assert.equal(await kv.get(`failedAttempts::${loginIp}`, 'json'), failedBanConfig.maxAttempts);
  assert.equal(await kv.get(`banned::${loginIp}`, 'json'), true);
});

test('后台 API 流程：配置/订阅组 JSON 导出后可导入到新实例', async () => {
  const logger = createLogger();
  const ctx = createCtx();

  const { env: sourceEnv } = createEnv({
    telegram: {
      enabled: false,
      botToken: 'source-bot-token',
      chatId: ''
    },
    hiddenField: {
      keep: true,
      nested: {
        marker: 'source-marker'
      }
    }
  });

  let sourceCookie = await initializeAdminSession({
    env: sourceEnv,
    logger,
    ctx,
    password: 'SourcePass123'
  });

  const sourceConfigResponse = await dispatchRequest('/admin/api/config', {
    env: sourceEnv,
    logger,
    ctx,
    method: 'PUT',
    headers: {
      Cookie: sourceCookie
    },
    body: {
      fileName: 'export-file-name',
      blockBots: false,
      telegram: {
        enabled: true,
        chatId: '123456789'
      },
      subconverter: {
        url: 'converter.example'
      }
    }
  });

  assert.equal(sourceConfigResponse.status, 200);
  sourceCookie = extractCookie(sourceConfigResponse);

  const sourceGroups = [
    {
      name: 'Export Group A',
      token: 'export-group-a',
      allowChinaAccess: true,
      nodes: 'vmess://group-a',
      filter: {
        enabled: false,
        rules: []
      }
    },
    {
      name: 'Export Group B',
      token: 'export-group-b',
      allowChinaAccess: false,
      nodes: 'vmess://group-b',
      filter: {
        enabled: true,
        rules: ['/过期/i']
      }
    }
  ];

  for (const group of sourceGroups) {
    const createGroupResponse = await dispatchRequest('/admin/api/groups', {
      env: sourceEnv,
      logger,
      ctx,
      method: 'POST',
      headers: {
        Cookie: sourceCookie
      },
      body: group
    });

    assert.equal(createGroupResponse.status, 200);
    sourceCookie = extractCookie(createGroupResponse);
  }

  const exportResponse = await dispatchRequest('/admin/api/export', {
    env: sourceEnv,
    logger,
    ctx,
    headers: {
      Cookie: sourceCookie
    }
  });

  assert.equal(exportResponse.status, 200);
  const exportedPayload = await exportResponse.json();
  assert.equal(exportedPayload.schemaVersion, 1);
  assert.equal(typeof exportedPayload.exportedAt, 'string');
  assert.equal(exportedPayload.config.fileName, 'export-file-name');
  assert.equal(exportedPayload.config.telegram.botToken, 'source-bot-token');
  assert.equal(Object.hasOwn(exportedPayload.config, 'adminPassword'), false);
  assert.equal(Object.hasOwn(exportedPayload.config, 'adminPasswordHash'), false);
  assert.equal(Object.hasOwn(exportedPayload.config, 'adminPasswordSalt'), false);
  assert.equal(Object.hasOwn(exportedPayload.config, 'adminPasswordHashIterations'), false);
  assert.equal(Object.hasOwn(exportedPayload.config, 'jwtSecret'), false);
  assert.equal(exportedPayload.groups.length, 2);

  const { env: targetEnv, kv: targetKv } = createEnv({
    telegram: {
      enabled: false,
      botToken: 'target-bot-token',
      chatId: ''
    },
    hiddenField: {
      keep: false,
      untouched: true
    }
  });

  let targetCookie = await initializeAdminSession({
    env: targetEnv,
    logger,
    ctx,
    password: 'TargetPass123'
  });

  const legacyGroupToken = 'legacy-group-token';
  const legacyCreateResponse = await dispatchRequest('/admin/api/groups', {
    env: targetEnv,
    logger,
    ctx,
    method: 'POST',
    headers: {
      Cookie: targetCookie
    },
    body: {
      name: 'Legacy Group',
      token: legacyGroupToken,
      allowChinaAccess: false,
      nodes: 'vmess://legacy',
      filter: {
        enabled: false,
        rules: []
      }
    }
  });

  assert.equal(legacyCreateResponse.status, 200);
  targetCookie = extractCookie(legacyCreateResponse);

  const configBeforeImport = await targetKv.get('config:global', 'json');
  assert.equal(typeof configBeforeImport.adminPasswordHash, 'string');
  assert.equal(typeof configBeforeImport.adminPasswordSalt, 'string');
  assert.equal(typeof configBeforeImport.adminPasswordHashIterations, 'number');
  assert.equal(typeof configBeforeImport.jwtSecret, 'string');

  const invalidImportResponse = await dispatchRequest('/admin/api/import', {
    env: targetEnv,
    logger,
    ctx,
    method: 'POST',
    headers: {
      Cookie: targetCookie
    },
    body: {
      config: {},
      groups: {
        invalid: true
      }
    }
  });

  assert.equal(invalidImportResponse.status, 400);
  assert.match((await invalidImportResponse.json()).error, /groups/i);
  targetCookie = extractCookie(invalidImportResponse);

  const tamperedImportPayload = {
    ...exportedPayload,
    config: {
      ...exportedPayload.config,
      adminPassword: 'hacker-pass',
      adminPasswordHash: 'forged-hash',
      adminPasswordSalt: 'forged-salt',
      adminPasswordHashIterations: 1,
      jwtSecret: 'forged-jwt-secret'
    }
  };

  const importResponse = await dispatchRequest('/admin/api/import', {
    env: targetEnv,
    logger,
    ctx,
    method: 'POST',
    headers: {
      Cookie: targetCookie
    },
    body: tamperedImportPayload
  });

  assert.equal(importResponse.status, 200);
  assert.deepEqual(await importResponse.json(), {
    success: true,
    importedGroups: 2
  });
  targetCookie = extractCookie(importResponse);

  const importedConfigResponse = await dispatchRequest('/admin/api/config', {
    env: targetEnv,
    logger,
    ctx,
    headers: {
      Cookie: targetCookie
    }
  });

  assert.equal(importedConfigResponse.status, 200);
  const importedConfig = await importedConfigResponse.json();
  assert.equal(importedConfig.fileName, 'export-file-name');
  assert.equal(importedConfig.blockBots, false);
  assert.equal(importedConfig.telegram.enabled, true);
  assert.equal(importedConfig.telegram.chatId, '123456789');
  assert.equal(importedConfig.telegram.botToken, 'source-bot-token');
  assert.equal(importedConfig.subconverter.url, 'converter.example');
  assert.equal(importedConfig.hiddenField.keep, true);
  assert.equal(importedConfig.hiddenField.nested.marker, 'source-marker');
  assert.equal(importedConfig.hiddenField.untouched, true);

  targetCookie = extractCookie(importedConfigResponse);

  const importedGroupsResponse = await dispatchRequest('/admin/api/groups', {
    env: targetEnv,
    logger,
    ctx,
    headers: {
      Cookie: targetCookie
    }
  });

  assert.equal(importedGroupsResponse.status, 200);
  const importedGroups = await importedGroupsResponse.json();
  assert.equal(importedGroups.length, 2);
  const importedGroupTokens = importedGroups.map(group => group.token).sort();
  assert.deepEqual(importedGroupTokens, ['export-group-a', 'export-group-b']);

  const indexedTokens = await targetKv.get('groups:index', 'json');
  assert.deepEqual([...indexedTokens].sort(), ['export-group-a', 'export-group-b']);
  assert.equal(await targetKv.get(`group:${legacyGroupToken}`, 'json'), null);

  const configAfterImport = await targetKv.get('config:global', 'json');
  assert.equal(configAfterImport.adminPasswordHash, configBeforeImport.adminPasswordHash);
  assert.equal(configAfterImport.adminPasswordSalt, configBeforeImport.adminPasswordSalt);
  assert.equal(configAfterImport.adminPasswordHashIterations, configBeforeImport.adminPasswordHashIterations);
  assert.equal(configAfterImport.jwtSecret, configBeforeImport.jwtSecret);
});

test('后台 API 流程：导入订阅组中途失败时应回滚订阅组状态', async () => {
  const logger = createLogger();
  const ctx = createCtx();
  const { env, kv } = createEnv();

  let authCookie = await initializeAdminSession({
    env,
    logger,
    ctx,
    password: 'RollbackPass123'
  });

  const existingGroups = [
    {
      name: 'Existing Overlap Group',
      token: 'existing-overlap-token',
      allowChinaAccess: false,
      nodes: 'vmess://existing-overlap',
      filter: {
        enabled: false,
        rules: []
      }
    },
    {
      name: 'Existing Legacy Group',
      token: 'existing-legacy-token',
      allowChinaAccess: true,
      nodes: 'vmess://existing-legacy',
      filter: {
        enabled: true,
        rules: ['/legacy/i']
      }
    }
  ];

  for (const group of existingGroups) {
    const createResponse = await dispatchRequest('/admin/api/groups', {
      env,
      logger,
      ctx,
      method: 'POST',
      headers: {
        Cookie: authCookie
      },
      body: group
    });

    assert.equal(createResponse.status, 200);
    authCookie = extractCookie(createResponse);
  }

  const overlapToken = 'existing-overlap-token';
  const legacyToken = 'existing-legacy-token';
  const importedOnlyToken = 'imported-only-token';

  kv.queueFailure({
    operation: 'delete',
    key: `group:${legacyToken}`,
    message: 'Injected KV delete failure during import.'
  });

  const configBeforeFailureImport = await kv.get('config:global', 'json');
  assert.ok(configBeforeFailureImport);
  assert.equal(typeof configBeforeFailureImport.adminPasswordHash, 'string');
  assert.equal(typeof configBeforeFailureImport.adminPasswordSalt, 'string');
  assert.equal(typeof configBeforeFailureImport.adminPasswordHashIterations, 'number');
  assert.equal(typeof configBeforeFailureImport.jwtSecret, 'string');

  const importResponse = await dispatchRequest('/admin/api/import', {
    env,
    logger,
    ctx,
    method: 'POST',
    headers: {
      Cookie: authCookie
    },
    body: {
      schemaVersion: 1,
      config: {
        fileName: 'rollback-import-test'
      },
      groups: [
        {
          name: 'Imported Overlap Group',
          token: overlapToken,
          allowChinaAccess: true,
          nodes: 'vmess://imported-overlap',
          filter: {
            enabled: false,
            rules: []
          }
        },
        {
          name: 'Imported New Group',
          token: importedOnlyToken,
          allowChinaAccess: false,
          nodes: 'vmess://imported-new',
          filter: {
            enabled: false,
            rules: []
          }
        }
      ]
    }
  });

  assert.equal(importResponse.status, 500);
  assert.equal((await importResponse.json()).error, 'Failed to import data.');

  const indexAfterFailure = await kv.get('groups:index', 'json');
  assert.ok(Array.isArray(indexAfterFailure));
  assert.deepEqual([...indexAfterFailure].sort(), [legacyToken, overlapToken]);

  const overlapGroupAfterFailure = await kv.get(`group:${overlapToken}`, 'json');
  assert.equal(overlapGroupAfterFailure.name, 'Existing Overlap Group');
  assert.equal(overlapGroupAfterFailure.nodes, 'vmess://existing-overlap');

  const legacyGroupAfterFailure = await kv.get(`group:${legacyToken}`, 'json');
  assert.equal(legacyGroupAfterFailure.name, 'Existing Legacy Group');
  assert.equal(legacyGroupAfterFailure.nodes, 'vmess://existing-legacy');

  assert.equal(await kv.get(`group:${importedOnlyToken}`, 'json'), null);

  const configAfterFailureImport = await kv.get('config:global', 'json');
  assert.equal(configAfterFailureImport.fileName, configBeforeFailureImport.fileName);
  assert.equal(configAfterFailureImport.adminPasswordHash, configBeforeFailureImport.adminPasswordHash);
  assert.equal(configAfterFailureImport.adminPasswordSalt, configBeforeFailureImport.adminPasswordSalt);
  assert.equal(configAfterFailureImport.adminPasswordHashIterations, configBeforeFailureImport.adminPasswordHashIterations);
  assert.equal(configAfterFailureImport.jwtSecret, configBeforeFailureImport.jwtSecret);
});
