import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../src/router.js';
import { GROUP_TOKEN_MAX_LENGTH } from '../src/services/group-token.js';

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
      return new Response('<html>fallback</html>', {
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

function createEnv({ globalConfig, groups }) {
  const kv = new InMemoryKV();

  kv.seedJson('config:global', globalConfig);
  for (const group of groups) {
    kv.seedJson(`group:${group.token}`, group);
  }

  return {
    env: {
      KV: kv,
      ASSETS: createAssetsBinding(),
      INIT_SECRET: 'test-init-secret',
      LOG_LEVEL: 'none',
      DEBUG_SECRET: 'debug-secret'
    },
    kv
  };
}

async function dispatchRequest(path, {
  env,
  logger,
  ctx,
  method = 'GET',
  headers = {}
} = {}) {
  const request = new Request(`https://example.com${path}`, {
    method,
    headers: new Headers(headers)
  });

  return handleRequest(request, env, ctx, logger);
}

test('订阅链路回归：转换 URL 列表应以 worker 自回源 base64 地址开头', async () => {
  const token = 'sub-regression-token';
  const { env } = createEnv({
    globalConfig: {
      fileName: 'regression-file',
      subconverter: {
        protocol: 'https',
        url: 'converter.example',
        configUrl: 'https://config.example/rules.ini'
      }
    },
    groups: [
      {
        name: 'Regression Group',
        token,
        allowChinaAccess: true,
        nodes: 'vmess://inline-node\nhttps://remote.example/subscription',
        filter: {
          enabled: false,
          rules: []
        }
      }
    ]
  });

  const logger = createLogger();
  const ctx = createCtx();

  const originalFetch = globalThis.fetch;
  let capturedSubconverterUrl = '';

  try {
    globalThis.fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === 'https://remote.example/subscription') {
        return new Response('proxies:\n  - { name: remote }', { status: 200 });
      }

      if (url.startsWith('https://converter.example/sub?')) {
        capturedSubconverterUrl = url;
        return new Response('converted-subscription-content', { status: 200 });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const response = await dispatchRequest(`/sub/${token}?clash`, {
      env,
      logger,
      ctx,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'converted-subscription-content');

    assert.ok(capturedSubconverterUrl, 'should call subconverter endpoint');
    const converterUrl = new URL(capturedSubconverterUrl);
    assert.equal(converterUrl.searchParams.get('target'), 'clash');

    const convertedUrlList = converterUrl.searchParams.get('url');
    assert.ok(convertedUrlList, 'subconverter url list should exist');
    const [firstUrl, secondUrl] = convertedUrlList.split('|');
    assert.equal(firstUrl, `https://example.com/sub/${token}?format=base64`);
    assert.equal(secondUrl, 'https://remote.example/subscription');

    const disposition = response.headers.get('Content-Disposition') || '';
    assert.match(disposition, /filename\*=utf-8''regression-file/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('订阅链路回归：subconverter 失败时应回退为 base64 原始节点而非 5xx', async () => {
  const token = 'sub-fallback-token';
  const { env } = createEnv({
    globalConfig: {
      fileName: 'fallback-file',
      subconverter: {
        protocol: 'https',
        url: 'converter.example',
        configUrl: 'https://config.example/rules.ini'
      }
    },
    groups: [
      {
        name: 'Fallback Group',
        token,
        allowChinaAccess: true,
        nodes: 'vmess://inline-a\nvmess://inline-b',
        filter: {
          enabled: false,
          rules: []
        }
      }
    ]
  });

  const logger = createLogger();
  const ctx = createCtx();

  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  try {
    globalThis.fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      fetchCallCount += 1;

      if (url.startsWith('https://converter.example/sub?')) {
        return new Response('upstream-failure', { status: 503 });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const response = await dispatchRequest(`/sub/${token}?clash`, {
      env,
      logger,
      ctx,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    assert.equal(fetchCallCount, 1);
    assert.equal(response.status, 200);

    const responseText = await response.text();
    assert.equal(atob(responseText), 'vmess://inline-a\nvmess://inline-b');
    assert.equal(response.headers.get('Content-Disposition'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('订阅链路回归：超长 token 应返回 400', async () => {
  const { env } = createEnv({
    globalConfig: {},
    groups: []
  });

  const logger = createLogger();
  const ctx = createCtx();

  const overLengthToken = 'a'.repeat(GROUP_TOKEN_MAX_LENGTH + 1);
  const invalidLengthResponse = await dispatchRequest(`/sub/${overLengthToken}`, {
    env,
    logger,
    ctx,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  assert.equal(invalidLengthResponse.status, 400);
  assert.equal(await invalidLengthResponse.text(), 'Invalid token format.');
});

test('订阅链路回归：同域远程订阅应触发递归保护且不发起网络抓取', async () => {
  const token = 'sub-recursive-token';
  const { env } = createEnv({
    globalConfig: {
      subconverter: {
        protocol: 'https',
        url: 'converter.example',
        configUrl: 'https://config.example/rules.ini'
      }
    },
    groups: [
      {
        name: 'Recursive Group',
        token,
        allowChinaAccess: true,
        nodes: 'vmess://inline-safe\nhttps://example.com/sub/another-token',
        filter: {
          enabled: false,
          rules: []
        }
      }
    ]
  });

  const logger = createLogger();
  const ctx = createCtx();

  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  try {
    globalThis.fetch = async (_input) => {
      fetchCallCount += 1;
      throw new Error('fetch should not be called for recursive same-host source');
    };

    const response = await dispatchRequest(`/sub/${token}`, {
      env,
      logger,
      ctx,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    assert.equal(response.status, 200);
    assert.equal(fetchCallCount, 0);

    const responseText = await response.text();
    assert.equal(atob(responseText), 'vmess://inline-safe');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
