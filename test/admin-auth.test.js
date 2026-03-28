import test from 'node:test';
import assert from 'node:assert/strict';

import { __adminInternals } from '../src/handlers/admin.js';
import { KVService } from '../src/services/kv.js';
import { ConfigService } from '../src/services/config.js';

const {
  hashAdminPasswordWithPbkdf2,
  isValidAdminPassword,
  normalizePersistedAdminCredentialFields,
  getBlockedLoginResponse,
  migrateAdminPasswordStorageIfNeeded
} = __adminInternals;

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    fatal() {}
  };
}

test('封禁 IP 应在密码校验前被短路，避免触发哈希计算', async () => {
  const originalKvGet = KVService.get;

  const queriedKeys = [];
  const blockedIp = '203.0.113.10';

  const logger = createLogger();

  try {
    KVService.get = async (key) => {
      queriedKeys.push(key);
      if (key === `banned::${blockedIp}`) {
        return true;
      }
      return 0;
    };

    const request = new Request('https://example.com/admin/api/login', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': blockedIp
      }
    });

    const failedBan = {
      enabled: true,
      maxAttempts: 5,
      banDuration: 600,
      failedAttemptsTtl: 600
    };

    const response = await getBlockedLoginResponse(request, failedBan, logger);

    assert.ok(response, 'blocked response should exist');
    assert.equal(response.status, 429);
    const responseJson = await response.json();
    assert.equal(responseJson.error, 'Too many failed attempts, please try again later.');
    assert.deepEqual(queriedKeys, [`banned::${blockedIp}`]);
  } finally {
    KVService.get = originalKvGet;
  }
});

test('PBKDF2 凭据应通过校验，错误口令应失败', async () => {
  const password = 'pbkdf2-pass-123';
  const salt = 'pbkdf2-salt';
  const iterations = 210000;

  const pbkdf2Hash = await hashAdminPasswordWithPbkdf2(password, salt, iterations);
  assert.ok(pbkdf2Hash, 'pbkdf2 hash should be generated');

  const pbkdf2Credentials = {
    adminPasswordHash: pbkdf2Hash,
    adminPasswordSalt: salt,
    adminPasswordHashIterations: iterations
  };

  const valid = await isValidAdminPassword(password, pbkdf2Credentials);
  const invalid = await isValidAdminPassword('wrong-password', pbkdf2Credentials);

  assert.equal(valid, true);
  assert.equal(invalid, false);
});

test('非 PBKDF2 凭据（legacy hash / 明文）应被拒绝', async () => {
  const password = 'legacy-pass-123';

  const legacyShaCredentials = {
    adminPasswordHash: 'legacy-sha-hash',
    adminPasswordSalt: 'legacy-salt'
  };
  const plainCredentials = {
    adminPassword: password
  };

  assert.equal(await isValidAdminPassword(password, legacyShaCredentials), false);
  assert.equal(await isValidAdminPassword(password, plainCredentials), false);
});

test('normalizePersistedAdminCredentialFields 应规范 PBKDF2 字段并保留 legacy SHA 凭据', () => {
  const pbkdf2Config = {
    adminPassword: 'should-be-cleared',
    adminPasswordHash: 'pbkdf2-hash',
    adminPasswordSalt: 'pbkdf2-salt',
    adminPasswordHashIterations: '210000',
    telegram: { enabled: false }
  };

  const normalizedPbkdf2 = normalizePersistedAdminCredentialFields({ ...pbkdf2Config });
  assert.equal(normalizedPbkdf2.adminPassword, '');
  assert.equal(normalizedPbkdf2.adminPasswordHash, 'pbkdf2-hash');
  assert.equal(normalizedPbkdf2.adminPasswordSalt, 'pbkdf2-salt');
  assert.equal(normalizedPbkdf2.adminPasswordHashIterations, 210000);

  const legacyShaConfig = {
    adminPassword: '',
    adminPasswordHash: 'legacy-hash',
    adminPasswordSalt: 'legacy-salt',
    adminPasswordHashIterations: 0,
    telegram: { enabled: false }
  };

  const normalizedLegacySha = normalizePersistedAdminCredentialFields({ ...legacyShaConfig });
  assert.equal(normalizedLegacySha.adminPassword, '');
  assert.equal(normalizedLegacySha.adminPasswordHash, 'legacy-hash');
  assert.equal(normalizedLegacySha.adminPasswordSalt, 'legacy-salt');
  assert.equal(Object.hasOwn(normalizedLegacySha, 'adminPasswordHashIterations'), false);
});

test('migrateAdminPasswordStorageIfNeeded 应在明文凭据下执行一次性迁移到 PBKDF2', async () => {
  const originalGetGlobalConfig = KVService.getGlobalConfig;
  const originalSaveGlobalConfig = KVService.saveGlobalConfig;

  const env = {
    KV: {
      async get() {
        return null;
      },
      async put() {
        return undefined;
      }
    }
  };

  const ctx = { waitUntil() {} };
  await ConfigService.init(env, ctx);

  const logger = createLogger();
  const oldConfig = {
    adminPassword: 'LegacyPlainPass123',
    telegram: { enabled: true }
  };
  const savedConfigs = [];

  try {
    KVService.getGlobalConfig = async () => oldConfig;
    KVService.saveGlobalConfig = async (config) => {
      savedConfigs.push(config);
    };

    await migrateAdminPasswordStorageIfNeeded({ logger });

    assert.equal(savedConfigs.length, 1);
    const migrated = savedConfigs[0];
    assert.equal(migrated.adminPassword, '');
    assert.equal(typeof migrated.adminPasswordHash, 'string');
    assert.equal(typeof migrated.adminPasswordSalt, 'string');
    assert.equal(typeof migrated.adminPasswordHashIterations, 'number');
    assert.equal(migrated.telegram.enabled, true);

    const migratedPasswordMatched = await isValidAdminPassword('LegacyPlainPass123', migrated);
    assert.equal(migratedPasswordMatched, true);
  } finally {
    KVService.getGlobalConfig = originalGetGlobalConfig;
    KVService.saveGlobalConfig = originalSaveGlobalConfig;
  }
});
