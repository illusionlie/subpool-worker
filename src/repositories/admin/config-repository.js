import { KVService } from '../../services/kv.js';

export async function getGlobalConfig() {
  return KVService.getGlobalConfig();
}

export async function saveGlobalConfig(config) {
  return KVService.saveGlobalConfig(config);
}
