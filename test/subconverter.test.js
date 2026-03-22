import test from 'node:test';
import assert from 'node:assert/strict';

import { SubconverterService } from '../src/services/subconverter.js';

test('`_normalizeBase64ForDecode` 应将 URL-safe Base64 归一化为标准 Base64', () => {
  const normalized = SubconverterService._normalizeBase64ForDecode('Pj4-\nPz8_');
  assert.equal(normalized, 'Pj4+Pz8/');
});

test('`_fetchRemoteSubscriptions` 应解码 URL-safe Base64 远程订阅内容', async () => {
  const originalFetch = globalThis.fetch;
  const logger = {
    warnCalls: [],
    errorCalls: [],
    warn(...args) {
      this.warnCalls.push(args);
    },
    error(...args) {
      this.errorCalls.push(args);
    }
  };

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
  const logger = {
    warnCalls: [],
    errorCalls: [],
    warn(...args) {
      this.warnCalls.push(args);
    },
    error(...args) {
      this.errorCalls.push(args);
    }
  };

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
