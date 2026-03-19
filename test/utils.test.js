import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFilter, isValidBase64, safeBtoa } from '../src/utils.js';
import { deepMerge } from '../src/services/config.js';

test('`deepMerge` 应深度合并对象且保留未覆盖字段', () => {
  const base = {
    adminPassword: 'old-password',
    telegram: {
      enabled: false,
      chatId: '12345',
    },
    nested: {
      level: 1,
    },
  };

  const override = {
    telegram: {
      enabled: true,
    },
    nested: {
      extra: true,
    },
  };

  const merged = deepMerge({}, base, override);

  assert.deepEqual(merged, {
    adminPassword: 'old-password',
    telegram: {
      enabled: true,
      chatId: '12345',
    },
    nested: {
      level: 1,
      extra: true,
    },
  });
});

test('`applyFilter` 应同时过滤原始规则与 URL 编码规则', () => {
  const content = [
    'vmess://keep-me',
    'ss://remove-me',
    'https://example.com/path/%E8%BF%87%E6%9C%9F',
  ].join('\n');

  const filtered = applyFilter(content, {
    enabled: true,
    rules: ['remove-me', '/过期/i'],
  });

  assert.equal(filtered, 'vmess://keep-me');
});

test('`isValidBase64` 应识别合法与非法 Base64 字符串', () => {
  assert.equal(isValidBase64('dm1lc3M6Ly90ZXN0'), true);
  assert.equal(isValidBase64('YWJjZA=='), true);
  assert.equal(isValidBase64('not-base64!'), false);
  assert.equal(isValidBase64('abc'), false);
  assert.equal(isValidBase64('   '), false);
});

test('`safeBtoa` 应支持 UTF-8 文本编码', () => {
  assert.equal(safeBtoa('中文节点'), '5Lit5paH6IqC54K5');
});
