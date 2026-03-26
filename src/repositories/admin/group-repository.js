import { KVService } from '../../services/kv.js';

export async function getGroup(token) {
  return KVService.getGroup(token);
}

export async function getAllGroups() {
  return KVService.getAllGroups();
}

export async function saveGroup(groupData) {
  return KVService.saveGroup(groupData);
}

export async function deleteGroup(token) {
  return KVService.deleteGroup(token);
}
