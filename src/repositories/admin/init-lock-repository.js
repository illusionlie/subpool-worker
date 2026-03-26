import { KVService } from '../../services/kv.js';

const INIT_LOCK_KEY = 'admin:init:lock';

export async function getInitLock() {
  return KVService.get(INIT_LOCK_KEY);
}

export async function saveInitLock(lockPayload, ttlSeconds) {
  return KVService.put(INIT_LOCK_KEY, JSON.stringify(lockPayload), { expirationTtl: ttlSeconds });
}
