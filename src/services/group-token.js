export const GROUP_TOKEN_MAX_LENGTH = 128;

export function normalizeGroupToken(token) {
  return typeof token === 'string' ? token.trim() : '';
}

export function isValidGroupToken(token) {
  return Boolean(token) && token.length <= GROUP_TOKEN_MAX_LENGTH && !token.includes('/');
}
