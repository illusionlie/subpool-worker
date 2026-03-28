import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigService } from '../src/services/config.js';
import { SubconverterService } from '../src/services/subconverter.js';

function createLogger() {
  return {
    warnCalls: [],
    errorCalls: [],
    warn(...args) {
      this.warnCalls.push(args);
    },
    error(...args) {
      this.errorCalls.push(args);
    },
    info() {},
    debug() {},
    fatal() {}
  };
}

function createGroup(overrides = {}) {
  return {
    name: 'Cache Group',
    token: 'cache-token',
    allowChinaAccess: true,
    nodes: 'vmess://inline-node',
    filter: {
      enabled: false,
      rules: []
    },
    ...overrides
  };
}

function createRequest(url) {
  return new Request(url, {
    headers: new Headers({
      'User-Agent': 'Mozilla/5.0'
    })
  });
}

async function initConfig(ctx = { waitUntil() {} }, overrides = {}) {
  const config = {
    fileName: 'cache-test-file',
    subconverter: {
      protocol: 'https',
      url: 'converter.example',
      configUrl: 'https://config.example/rules.ini'
    },
    ...overrides
  };

  const kv = {
    async get(key, type = 'text') {
      if (key !== 'config:global') {
        return null;
      }

      if (type === 'json') {
        return config;
      }

      return JSON.stringify(config);
    },
    async put(_key, _value, _options = {}) {},
    async delete(_key) {}
  };

  await ConfigService.init({ KV: kv }, ctx);
}

test('`_normalizeBase64ForDecode` 应将 URL-safe Base64 归一化为标准 Base64', () => {
  const normalized = SubconverterService._normalizeBase64ForDecode('Pj4-\nPz8_');
  assert.equal(normalized, 'Pj4+Pz8/');
});

test('`_fetchRemoteSubscriptions` 应解码 URL-safe Base64 远程订阅内容', async () => {
  const originalFetch = globalThis.fetch;
  const logger = createLogger();

  try {
    globalThis.fetch = async () => new Response('Pj4-', { status: 200 });

    const request = new Request('https://self.example/sub/test-token');
    const result = await SubconverterService._fetchRemoteSubscriptions(
      ['https://remote.example/subscription'],
      request,
      null,
      logger
    );

    assert.deepEqual(result.conversionUrls, []);
    assert.deepEqual(result.fetchedNodes, ['>>>']);
    assert.equal(logger.warnCalls.length, 0);
    assert.equal(logger.errorCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('`_fetchRemoteSubscriptions` 在 Base64 解码异常时应记录 warn 且不中断后续处理', async () => {
  const originalFetch = globalThis.fetch;
  const originalAtob = globalThis.atob;
  const logger = createLogger();

  try {
    globalThis.fetch = async (url) => {
      if (url.toString().includes('bad.example')) {
        return new Response('Pj4-', { status: 200 });
      }
      return new Response('vmess://ok-node', { status: 200 });
    };

    globalThis.atob = () => {
      throw new Error('forced decode failure');
    };

    const request = new Request('https://self.example/sub/test-token');
    const result = await SubconverterService._fetchRemoteSubscriptions(
      ['https://bad.example/subscription', 'https://plain.example/subscription'],
      request,
      null,
      logger
    );

    assert.deepEqual(result.fetchedNodes, ['vmess://ok-node']);
    assert.equal(result.conversionUrls.length, 0);
    assert.equal(logger.warnCalls.length, 1);
    assert.match(logger.warnCalls[0][0], /Failed to decode base64 content from https:\/\/bad\.example\/subscription/);
    assert.equal(logger.errorCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.atob = originalAtob;
  }
});

test('`generateSubscription` 在 fresh TTL 内应命中缓存并避免重复请求 subconverter', async () => {
  SubconverterService.__clearResultCacheForTests();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const logger = createLogger();
  let now = 1700000000000;
  let fetchCallCount = 0;

  try {
    Date.now = () => now;
    await initConfig();

    globalThis.fetch = async (input) => {
      const fetchUrl = input instanceof Request ? input.url : input.toString();
      if (fetchUrl.startsWith('https://converter.example/sub?')) {
        fetchCallCount += 1;
        return new Response(`converted-${fetchCallCount}`, { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${fetchUrl}`);
    };

    const group = createGroup();
    const request = createRequest('https://example.com/sub/cache-token?clash');

    const first = await SubconverterService.generateSubscription(group, request, 'cache-token', logger);
    const second = await SubconverterService.generateSubscription(group, request, 'cache-token', logger);

    assert.equal(first.content, 'converted-1');
    assert.equal(second.content, 'converted-1');
    assert.equal(fetchCallCount, 1);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    SubconverterService.__clearResultCacheForTests();
  }
});

test('`generateSubscription` 并发同 key 请求应复用 in-flight 构建', async () => {
  SubconverterService.__clearResultCacheForTests();
  const originalFetch = globalThis.fetch;
  const logger = createLogger();
  let fetchCallCount = 0;
  let releaseFetch = () => {};
  const fetchGate = new Promise(resolve => {
    releaseFetch = resolve;
  });

  try {
    await initConfig();

    globalThis.fetch = async (input) => {
      const fetchUrl = input instanceof Request ? input.url : input.toString();
      if (fetchUrl.startsWith('https://converter.example/sub?')) {
        fetchCallCount += 1;
        await fetchGate;
        return new Response('converted-concurrent', { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${fetchUrl}`);
    };

    const group = createGroup();
    const request = createRequest('https://example.com/sub/cache-token?clash');

    const firstPromise = SubconverterService.generateSubscription(group, request, 'cache-token', logger);
    const secondPromise = SubconverterService.generateSubscription(group, request, 'cache-token', logger);

    releaseFetch();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(fetchCallCount, 1);
    assert.equal(first.content, 'converted-concurrent');
    assert.equal(second.content, 'converted-concurrent');
  } finally {
    globalThis.fetch = originalFetch;
    SubconverterService.__clearResultCacheForTests();
  }
});

test('`generateSubscription` 缓存过期后应重新请求并更新结果', async () => {
  SubconverterService.__clearResultCacheForTests();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const logger = createLogger();
  const cachePolicy = SubconverterService.__getCachePolicyForTests();
  let now = 1700001000000;
  let fetchCallCount = 0;

  try {
    Date.now = () => now;
    await initConfig();

    globalThis.fetch = async (input) => {
      const fetchUrl = input instanceof Request ? input.url : input.toString();
      if (fetchUrl.startsWith('https://converter.example/sub?')) {
        fetchCallCount += 1;
        return new Response(`converted-${fetchCallCount}`, { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${fetchUrl}`);
    };

    const group = createGroup();
    const request = createRequest('https://example.com/sub/cache-token?clash');

    const first = await SubconverterService.generateSubscription(group, request, 'cache-token', logger);
    assert.equal(first.content, 'converted-1');

    now += cachePolicy.ttlMs + 1;
    const second = await SubconverterService.generateSubscription(group, request, 'cache-token', logger);
    assert.equal(second.content, 'converted-2');
    assert.equal(fetchCallCount, 2);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    SubconverterService.__clearResultCacheForTests();
  }
});

test('`generateSubscription` subconverter 失败回退结果不应写入缓存', async () => {
  SubconverterService.__clearResultCacheForTests();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const logger = createLogger();
  let now = 1700002000000;
  let fetchCallCount = 0;

  try {
    Date.now = () => now;
    await initConfig();

    globalThis.fetch = async (input) => {
      const fetchUrl = input instanceof Request ? input.url : input.toString();
      if (fetchUrl.startsWith('https://converter.example/sub?')) {
        fetchCallCount += 1;
        return new Response('upstream-failure', { status: 503 });
      }
      throw new Error(`Unexpected fetch URL: ${fetchUrl}`);
    };

    const group = createGroup();
    const request = createRequest('https://example.com/sub/cache-token?clash');

    const first = await SubconverterService.generateSubscription(group, request, 'cache-token', logger);
    const second = await SubconverterService.generateSubscription(group, request, 'cache-token', logger);

    assert.equal(fetchCallCount, 2);
    assert.equal(atob(first.content), 'vmess://inline-node');
    assert.equal(second.content, first.content);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    SubconverterService.__clearResultCacheForTests();
  }
});

test('`generateSubscription` 缓存键应包含 host，避免多域名串缓存', async () => {
  SubconverterService.__clearResultCacheForTests();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const logger = createLogger();
  let now = 1700004000000;
  let fetchCallCount = 0;

  try {
    Date.now = () => now;
    await initConfig();

    globalThis.fetch = async (input) => {
      const fetchUrl = input instanceof Request ? input.url : input.toString();
      if (fetchUrl.startsWith('https://converter.example/sub?')) {
        fetchCallCount += 1;
        return new Response(`converted-${fetchCallCount}`, { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${fetchUrl}`);
    };

    const group = createGroup();
    const requestA = createRequest('https://example.com/sub/cache-token?clash');
    const requestB = createRequest('https://another.example/sub/cache-token?clash');

    const first = await SubconverterService.generateSubscription(group, requestA, 'cache-token', logger);
    const second = await SubconverterService.generateSubscription(group, requestB, 'cache-token', logger);

    assert.equal(first.content, 'converted-1');
    assert.equal(second.content, 'converted-2');
    assert.equal(fetchCallCount, 2);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    SubconverterService.__clearResultCacheForTests();
  }
});

test('`generateSubscription` 缓存键应包含输出格式，避免 base64/clash 串缓存', async () => {
  SubconverterService.__clearResultCacheForTests();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const logger = createLogger();
  let now = 1700005000000;
  let fetchCallCount = 0;

  try {
    Date.now = () => now;
    await initConfig();

    globalThis.fetch = async (input) => {
      const fetchUrl = input instanceof Request ? input.url : input.toString();
      if (fetchUrl.startsWith('https://converter.example/sub?')) {
        fetchCallCount += 1;
        return new Response('converted-format-specific', { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${fetchUrl}`);
    };

    const group = createGroup();
    const base64Request = createRequest('https://example.com/sub/cache-token');
    const clashRequest = createRequest('https://example.com/sub/cache-token?clash');

    const base64Response = await SubconverterService.generateSubscription(group, base64Request, 'cache-token', logger);
    assert.equal(atob(base64Response.content), 'vmess://inline-node');

    const clashResponse = await SubconverterService.generateSubscription(group, clashRequest, 'cache-token', logger);
    assert.equal(clashResponse.content, 'converted-format-specific');
    assert.equal(fetchCallCount, 1);

    const base64ResponseAgain = await SubconverterService.generateSubscription(group, base64Request, 'cache-token', logger);
    assert.equal(base64ResponseAgain.content, base64Response.content);
    assert.equal(fetchCallCount, 1);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    SubconverterService.__clearResultCacheForTests();
  }
});
