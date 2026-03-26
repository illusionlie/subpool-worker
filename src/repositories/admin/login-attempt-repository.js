import { KVService } from '../../services/kv.js';

function getFailedAttemptsKey(ip) {
  return `failedAttempts::${ip}`;
}

function getBannedKey(ip) {
  return `banned::${ip}`;
}

export async function getFailedAttempts(ip) {
  return KVService.get(getFailedAttemptsKey(ip));
}

export async function saveFailedAttempts(ip, attempts, ttlSeconds) {
  return KVService.put(getFailedAttemptsKey(ip), attempts, { expirationTtl: ttlSeconds });
}

export async function getBannedState(ip) {
  return KVService.get(getBannedKey(ip));
}

export async function saveBannedState(ip, value, ttlSeconds) {
  return KVService.put(getBannedKey(ip), value, { expirationTtl: ttlSeconds });
}
