// Mã hoá đầu cuối. Mật khẩu chính không bao giờ rời khỏi trình duyệt.
//
// mật khẩu ──PBKDF2 (600k vòng)──▶ khoá gốc ──HKDF──┬─▶ auth  (gửi server để chứng minh là chủ)
//                                                 └─▶ KEK   (chỉ ở trên máy, dùng để mở DEK)
// DEK: khoá ngẫu nhiên mã hoá mọi bản ghi và file. Server chỉ giữ DEK đã bọc bằng KEK,
// nên đổi mật khẩu chỉ cần bọc lại DEK, không phải mã hoá lại toàn bộ dữ liệu.

export const ITERATIONS = 600_000;

const te = new TextEncoder();
const td = new TextDecoder();

export function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromB64u(str) {
  const s = atob(str.replaceAll('-', '+').replaceAll('_', '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomId() {
  return b64u(randomBytes(12));
}

export async function deriveKeys(passphrase, saltB64, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(saltB64), iterations },
    base,
    256,
  );
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdf = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) });
  const auth = new Uint8Array(await crypto.subtle.deriveBits(hkdf('for-me-hub/auth'), hk, 256));
  const kek = await crypto.subtle.deriveKey(hkdf('for-me-hub/kek'), hk, { name: 'AES-GCM', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
  return { auth: b64u(auth), kek };
}

export async function newDataKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapDataKey(dek, kek) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv, additionalData: te.encode('dek') });
  return `v1.${b64u(iv)}.${b64u(new Uint8Array(ct))}`;
}

// extractable chỉ bật khi cần bọc lại (đổi mật khẩu); bình thường DEK không lấy ra được.
export async function unwrapDataKey(wrapped, kek, extractable = false) {
  const [v, iv, ct] = wrapped.split('.');
  if (v !== 'v1') throw new Error('Định dạng khoá lạ');
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      fromB64u(ct),
      kek,
      { name: 'AES-GCM', iv: fromB64u(iv), additionalData: te.encode('dek') },
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new Error('Sai mật khẩu');
  }
}

// Gắn id vào phần xác thực để không ai tráo nội dung giữa hai bản ghi được.
export async function encryptRecord(dek, id, value) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(`rec:${id}`) },
    dek,
    te.encode(JSON.stringify(value)),
  );
  return `v1.${b64u(iv)}.${b64u(new Uint8Array(ct))}`;
}

export async function decryptRecord(dek, id, data) {
  const [v, iv, ct] = data.split('.');
  if (v !== 'v1') throw new Error('Định dạng bản ghi lạ');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64u(iv), additionalData: te.encode(`rec:${id}`) },
    dek,
    fromB64u(ct),
  );
  return JSON.parse(td.decode(pt));
}

// File: 12 byte IV nối với ciphertext.
export async function encryptBytes(dek, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('file') }, dek, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(dek, buf) {
  const all = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: te.encode('file') }, dek, all.subarray(12));
}
