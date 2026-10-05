// Kho bản ghi dùng chung cho mọi tiện ích, kèm đồng bộ.
//
// Mỗi bản ghi là một object JSON có field `type` (vd 'note'); tiện ích mới chỉ cần dùng type mới,
// server không phải sửa gì. Mọi thứ được mã hoá trước khi rời khỏi bộ nhớ.
//
// Xung đột (sửa cùng lúc trên hai máy): bản trên server giữ nguyên chỗ cũ, bản của máy này được
// lưu thành bản sao có `conflictOf`, nên không mất chữ nào.

import { api, hasToken } from './api.js';
import { decryptRecord, encryptRecord, randomId } from './crypto.js';
import { local } from './idb.js';

export class Store {
  constructor(dek, { persist }) {
    this.dek = dek;
    this.persist = persist; // máy riêng: lưu ciphertext vào IndexedDB
    this.records = new Map(); // id -> { id, version, deleted, value }
    this.outbox = new Map(); // id -> { id, data, deleted, base_version }
    this.cursor = 0;
    this.state = 'idle'; // idle | syncing | offline | error
    this.lastError = null;
    this.listeners = new Set();
    this.running = null;
    this.again = false;
    this.pushTimer = null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ids, extra = {}) {
    for (const fn of this.listeners) fn({ ids, ...extra });
  }

  setState(state, err = null) {
    this.state = state;
    this.lastError = err;
    this.emit([]);
  }

  get pending() {
    return this.outbox.size;
  }

  get(id) {
    const r = this.records.get(id);
    return r && !r.deleted ? r.value : null;
  }

  list(type) {
    const out = [];
    for (const r of this.records.values()) if (!r.deleted && r.value?.type === type) out.push({ id: r.id, ...r.value });
    return out;
  }

  async load() {
    if (!this.persist) return;
    this.cursor = (await local.getMeta('cursor')) ?? 0;
    for (const row of await local.all('records')) await this.applyServerRow(row, { save: false, notify: false });
    for (const entry of await local.all('outbox')) {
      this.outbox.set(entry.id, entry);
      const rec = this.records.get(entry.id);
      const value = entry.deleted ? null : await this.tryDecrypt(entry.id, entry.data);
      this.records.set(entry.id, { id: entry.id, version: rec?.version ?? 0, deleted: entry.deleted, value });
    }
  }

  async tryDecrypt(id, data) {
    try {
      return await decryptRecord(this.dek, id, data);
    } catch (e) {
      console.warn('Không giải mã được bản ghi', id, e);
      return null;
    }
  }

  async put(id, value) {
    const data = await encryptRecord(this.dek, id, value);
    const rec = this.records.get(id);
    const prev = this.outbox.get(id);
    // Giữ base_version của lần sửa đầu tiên chưa đồng bộ, để server nhận ra xung đột.
    const entry = { id, data, deleted: false, base_version: prev ? prev.base_version : rec?.version ?? 0 };
    this.outbox.set(id, entry);
    this.records.set(id, { id, version: rec?.version ?? 0, deleted: false, value });
    if (this.persist) await local.write({ puts: { outbox: [entry] } });
    this.emit([id]);
    this.schedule();
  }

  async remove(id) {
    const rec = this.records.get(id);
    const prev = this.outbox.get(id);
    const entry = { id, data: '', deleted: true, base_version: prev ? prev.base_version : rec?.version ?? 0 };
    this.outbox.set(id, entry);
    this.records.set(id, { id, version: rec?.version ?? 0, deleted: true, value: null });
    if (this.persist) await local.write({ puts: { outbox: [entry] } });
    this.emit([id]);
    this.schedule();
  }

  schedule(delay = 800) {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.sync().catch(() => {}), delay);
  }

  // Chạy lần lượt; gọi chồng thì gộp thành một lượt chạy thêm sau đó.
  sync() {
    if (!hasToken()) {
      this.setState('offline');
      return Promise.resolve();
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          this.setState('syncing');
          await this.push();
          await this.pull();
          if (this.outbox.size) await this.push(); // bản sao xung đột vừa tạo
        } while (this.again);
        this.setState('idle');
      } catch (err) {
        this.setState(err.status === 0 ? 'offline' : 'error', err);
        throw err;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  async push() {
    for (const entry of [...this.outbox.values()]) {
      let res;
      try {
        res = entry.deleted
          ? await api(`/records/${entry.id}?base_version=${entry.base_version}`, { method: 'DELETE' })
          : await api(`/records/${entry.id}`, { method: 'PUT', body: { data: entry.data, base_version: entry.base_version } });
      } catch (err) {
        if (err.status === 409) {
          await this.resolveConflict(entry.id, err.data.current);
          continue;
        }
        throw err;
      }
      const latest = this.outbox.get(entry.id);
      const rec = this.records.get(entry.id);
      if (rec) rec.version = res.version;
      const confirmed = { id: entry.id, data: entry.data, version: res.version, deleted: entry.deleted ? 1 : 0 };
      if (latest === entry) {
        this.outbox.delete(entry.id);
        if (this.persist) await local.write({ puts: { records: [confirmed] }, deletes: { outbox: [entry.id] } });
      } else if (latest) {
        // Đã sửa tiếp trong lúc đang gửi: lần sau gửi tiếp dựa trên phiên bản vừa ghi.
        latest.base_version = res.version;
        if (this.persist) await local.write({ puts: { records: [confirmed], outbox: [latest] } });
        this.again = true;
      }
    }
  }

  async resolveConflict(id, current) {
    const entry = this.outbox.get(id);
    this.outbox.delete(id);
    const mine = entry && !entry.deleted ? await this.tryDecrypt(id, entry.data) : null;
    if (this.persist) await local.write({ deletes: { outbox: [id] } });
    if (current) await this.applyServerRow(current, { save: true, notify: false });
    else this.records.delete(id);
    if (!mine) return this.emit([id]);
    const copyId = randomId();
    await this.put(copyId, { ...mine, conflictOf: id, updatedAt: Date.now() });
    // Tiện ích đang mở bản gốc phải chuyển sang bản sao, nếu không gõ tiếp sẽ đè lên bản của máy kia.
    this.emit([id, copyId], { conflict: { id, copyId } });
  }

  async pull() {
    let more = true;
    while (more) {
      const res = await api(`/records?since=${this.cursor}`);
      const changed = [];
      for (const row of res.records) {
        // Đang có bản sửa chưa gửi thì giữ bản của máy này; lúc gửi server sẽ báo xung đột.
        if (this.outbox.has(row.id)) continue;
        await this.applyServerRow(row, { save: false, notify: false });
        changed.push(row.id);
      }
      this.cursor = res.cursor;
      more = res.more;
      if (this.persist) {
        await local.write({
          puts: { records: res.records.map(({ id, data, version, deleted }) => ({ id, data, version, deleted })) },
          meta: { cursor: this.cursor },
        });
      }
      if (changed.length) this.emit(changed);
    }
  }

  async applyServerRow(row, { save, notify }) {
    const deleted = !!row.deleted;
    const value = deleted ? null : await this.tryDecrypt(row.id, row.data);
    this.records.set(row.id, { id: row.id, version: row.version, deleted: deleted || value === null, value });
    if (save && this.persist) {
      await local.write({ puts: { records: [{ id: row.id, data: row.data, version: row.version, deleted: row.deleted }] } });
    }
    if (notify) this.emit([row.id]);
  }
}
