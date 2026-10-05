// Gọi API. Token chỉ nằm trong bộ nhớ: tải lại trang là mất, phải đăng nhập lại.

let token = null;
let onExpired = () => {};
let lastContact = 0;

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function setToken(t) {
  token = t;
  if (t) lastContact = Date.now();
}

export function hasToken() {
  return !!token;
}

// Rời trang hoặc tải lại: token trong bộ nhớ mất luôn, nên huỷ phiên trên server cho gọn.
export function logoutOnLeave() {
  if (!token) return;
  fetch('/api/logout', { method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  token = null;
}

export function onSessionExpired(fn) {
  onExpired = fn;
}

// Lần cuối nói chuyện được với server (máy lạ mất mạng quá lâu thì tự khoá).
export function lastServerContact() {
  return lastContact;
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, cache: 'no-store' };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (raw !== undefined) {
    init.body = raw;
    init.headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, 'Không kết nối được server');
  }
  lastContact = Date.now();
  const isJson = (res.headers.get('Content-Type') ?? '').includes('application/json');
  if (!res.ok) {
    const data = isJson ? await res.json().catch(() => ({})) : {};
    if (res.status === 401 && token) {
      token = null;
      onExpired();
    }
    throw new ApiError(res.status, data.error ?? `Lỗi ${res.status}`, data);
  }
  return isJson ? res.json() : res.arrayBuffer();
}
