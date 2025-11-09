import { ConfigService } from './config.js';

export class KVService {
  static #getKV() {
    const kv = ConfigService.getKV();
    if (!kv) {
      throw new Error('KV namespace is not bound.');
    }
    return kv;
  }

  static async get(key, type = 'json') {
    return this.#getKV().get(key, type);
  }

  static async put(key, value, options) {
    return this.#getKV().put(key, value, options);
  }

  static async getGlobalConfig() {
    return this.#getKV().get('config:global', 'json');
  }

  static async saveGlobalConfig(config) {
    return this.#getKV().put('config:global', JSON.stringify(config));
  }

  static async getGroup(token) {
    return this.#getKV().get(`group:${token}`, 'json');
  }

  static async getAllGroups() {
    const kv = this.#getKV();
    const index = await kv.get('groups:index', 'json') || [];
    if (!index || !Array.isArray(index)) return [];
    if (index.length === 0) return [];
    
    const promises = index.map(token => this.getGroup(token));
    const groups = await Promise.all(promises);
    return groups.filter(Boolean); // 过滤掉可能已删除但索引未清理的 null 项
  }

  static async saveGroup(groupData) {
    const kv = this.#getKV();
    const token = groupData.token;
    if (!token) throw new Error('Group token is required.');

    // 更新索引
    const index = await kv.get('groups:index', 'json') || [];
    if (!index.includes(token)) {
      index.push(token);
      await kv.put('groups:index', JSON.stringify(index));
    }

    // 保存组数据
    return kv.put(`group:${token}`, JSON.stringify(groupData));
  }

  static async deleteGroup(token) {
    const kv = this.#getKV();
    
    // 更新索引
    let index = await kv.get('groups:index', 'json') || [];
    index = index.filter(t => t !== token);
    await kv.put('groups:index', JSON.stringify(index));

    // 删除组数据
    return kv.delete(`group:${token}`);
  }
}