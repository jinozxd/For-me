// File đính kèm: mã hoá trên máy rồi mới tải lên R2, tải về rồi mới giải mã.

import { api } from './api.js';
import { decryptBytes, encryptBytes } from './crypto.js';

export const MAX_FILE_BYTES = 50 * 1024 * 1024 - 1024;

// Chỉ ảnh dạng điểm ảnh mới được hiện trực tiếp; SVG/HTML luôn tải về như file thường.
const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

export function isInlineImage(att) {
  return INLINE_IMAGE.test(att.type ?? '');
}

export class Files {
  constructor(dek) {
    this.dek = dek;
    this.urls = new Map();
  }

  async upload(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" lớn hơn 50 MB`);
    const enc = await encryptBytes(this.dek, new Uint8Array(await file.arrayBuffer()));
    const res = await api('/files', { method: 'POST', raw: enc });
    return { id: res.id, name: file.name, type: file.type || 'application/octet-stream', size: file.size };
  }

  async url(att) {
    if (this.urls.has(att.id)) return this.urls.get(att.id);
    const buf = await api(`/files/${att.id}`);
    const plain = await decryptBytes(this.dek, buf);
    const type = isInlineImage(att) ? att.type : 'application/octet-stream';
    const url = URL.createObjectURL(new Blob([plain], { type }));
    this.urls.set(att.id, url);
    return url;
  }

  async download(att) {
    const a = document.createElement('a');
    a.href = await this.url(att);
    a.download = att.name || 'file';
    document.body.append(a);
    a.click();
    a.remove();
  }

  async remove(id) {
    await api(`/files/${id}`, { method: 'DELETE' });
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }

  revokeAll() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
