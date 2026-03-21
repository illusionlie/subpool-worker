import test from 'node:test';
import assert from 'node:assert/strict';

import { __adminInternals } from '../src/handlers/admin.js';
import { KVService } from '../src/services/kv.js';

const {
  hashAdminPasswordWithLegacySha256,
  hashAdminPasswordWithPbkdf2,
  isValidAdminPassword,
  normalizePersistedAdminCredentialFields,
  getPersistedPasswordCredentialsState,
  getBlockedLoginResponse
} = __adminInternals;

test('legacy SHA-256 凭据应使用 legacy 分支通过校验', async () => {
  const password = 'legacy-pass-123';
  const salt = 'legacy-salt';
  const legacyHash = await hashAdminPasswordWithLegacySha256(password, salt);

  assert.ok(legacyHash, 'legacy hash should be generated');

  const legacyCredentials = {
    adminPasswordHash: legacyHash,
    adminPasswordSalt: salt
  };

  const valid = await isValidAdminPassword(password, legacyCredentials);
  const invalid = await isValidAdminPassword('wrong-password', legacyCredentials);

  assert.equal(valid, true);
  assert.equal(invalid, false);
});

test('封禁 IP 应在密码校验前被短路，避免触发哈希计算', async () => {
  const originalKvGet = KVService.get;

  const queriedKeys = [];
  const blockedIp = '203.0.113.10';

  const logger = {
    info() {},
    warn() {},
    error() {},
    fatal() {}
  };

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

test('PBKDF2 凭据应使用 PBKDF2 分支通过校验', async () => {
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

test('normalizePersistedAdminCredentialFields 不应把 legacy SHA-256 凭据误标记为 PBKDF2', () => {
  const mergedConfig = {
    adminPassword: 'legacy-plain-should-be-cleared',
    adminPasswordHash: 'legacy-hash',
    adminPasswordSalt: 'legacy-salt',
    telegram: { enabled: false }
  };

  const normalized = normalizePersistedAdminCredentialFields({ ...mergedConfig });
  const state = getPersistedPasswordCredentialsState(normalized);

  assert.equal(normalized.adminPassword, '');
  assert.equal(Object.hasOwn(normalized, 'adminPasswordHashIterations'), false);
  assert.equal(state.hasHashedCredentials, true);
  assert.equal(state.isLegacySha256, true);
  assert.equal(state.isPbkdf2, false);
});
