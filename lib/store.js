import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOCAL_FILE = path.join(ROOT, 'data', 'local_store.json');

const EMPTY = () => ({ state: null, lists: {}, seen: {}, locks: {}, values: {} });

class LocalStore {
  constructor() {
    this.mode = 'local';
    this.data = EMPTY();
    try {
      if (fs.existsSync(LOCAL_FILE)) this.data = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    } catch {
      this.data = EMPTY();
    }
  }
  save() {
    fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(this.data));
  }
  async getState() {
    return this.data.state;
  }
  async setState(s) {
    this.data.state = s;
    this.save();
  }
  async append(key, obj) {
    if (!this.data.lists[key]) this.data.lists[key] = [];
    this.data.lists[key].push(obj);
    this.save();
  }
  async list(key, { limit = 0 } = {}) {
    const arr = this.data.lists[key] || [];
    return limit > 0 ? arr.slice(-limit) : arr.slice();
  }
  async len(key) {
    return (this.data.lists[key] || []).length;
  }
  async setNX(key, val, ttlSec = 0) {
    const now = Date.now();
    const rec = this.data.seen[key];
    if (rec && (!rec.exp || rec.exp > now)) return false;
    this.data.seen[key] = { val, exp: ttlSec > 0 ? now + ttlSec * 1000 : 0 };
    this.save();
    return true;
  }
  async setValue(key, val) {
    if (!this.data.values) this.data.values = {};
    this.data.values[key] = val;
    this.save();
  }
  async getValue(key) {
    return this.data.values?.[key] ?? null;
  }
  async del(key) {
    delete this.data.lists[key];
    delete this.data.seen[key];
    delete this.data.locks[key];
    this.save();
  }
  async lock(name, ttlSec = 260) {
    const now = Date.now();
    const cur = this.data.locks[name];
    if (cur && cur > now) return false;
    this.data.locks[name] = now + ttlSec * 1000;
    this.save();
    return true;
  }
  async unlock(name) {
    delete this.data.locks[name];
    this.save();
  }
}

class RedisStore {
  constructor(url, token) {
    this.mode = 'redis';
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }
  async cmd(args) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Redis ${res.status}: ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    if (j.error) throw new Error('Redis: ' + j.error);
    return j.result;
  }
  async getState() {
    const s = await this.cmd(['GET', 'finn:state']);
    return s ? JSON.parse(s) : null;
  }
  async setState(s) {
    await this.cmd(['SET', 'finn:state', JSON.stringify(s)]);
  }
  async append(key, obj) {
    await this.cmd(['RPUSH', key, JSON.stringify(obj)]);
  }
  async list(key, { limit = 0 } = {}) {
    const args = limit > 0 ? ['LRANGE', key, String(-limit), '-1'] : ['LRANGE', key, '0', '-1'];
    const arr = await this.cmd(args);
    return (arr || []).map((x) => JSON.parse(x));
  }
  async len(key) {
    return +(await this.cmd(['LLEN', key])) || 0;
  }
  async setNX(key, val, ttlSec = 0) {
    const args = ttlSec > 0 ? ['SET', key, val, 'NX', 'EX', String(ttlSec)] : ['SET', key, val, 'NX'];
    const r = await this.cmd(args);
    return r === 'OK';
  }
  async setValue(key, val) {
    await this.cmd(['SET', key, val]);
  }
  async getValue(key) {
    return await this.cmd(['GET', key]);
  }
  async del(key) {
    await this.cmd(['DEL', key]);
  }
  async lock(name, ttlSec = 260) {
    const r = await this.cmd(['SET', name, String(Date.now()), 'NX', 'EX', String(ttlSec)]);
    return r === 'OK';
  }
  async unlock(name) {
    await this.del(name);
  }
}

let singleton = null;

export function getStore() {
  if (singleton) return singleton;
  // Dua penamaan yang mungkin: Upstash langsung, atau integrasi Marketplace Vercel (KV_*).
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  singleton = url && token ? new RedisStore(url, token) : new LocalStore();
  return singleton;
}

export function resetStore() {
  singleton = null;
}
