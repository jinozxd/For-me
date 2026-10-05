// API của hub. Server chỉ giữ ciphertext: nó kiểm tra "có phải chủ không" rồi trả hộp đã khoá,
// còn mở hộp là việc của trình duyệt.

import { codeMatches, parseSecrets } from './code.js';

const IDLE_MS = 30 * 60 * 1000;        // không gọi API quá 30 phút là phiên hết hạn
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;      // giảm số lần ghi last_seen
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 20;
const MAX_RECORD_CHARS = 1_500_000;    // D1 giới hạn 2 MB mỗi dòng
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PULL_LIMIT = 500;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const B64_RE = /^[A-Za-z0-9_-]+$/;
const WRAPPED_RE = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{40,120}$/;

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let res;
    if (url.pathname.startsWith('/api/')) {
      try {
        res = await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) res = json({ error: err.message }, err.status);
        else {
          console.error(err);
          res = json({ error: 'Lỗi server' }, 500);
        }
      }
      res.headers.set('Cache-Control', 'no-store');
    } else {
      res = await env.ASSETS.fetch(request);
    }
    return withSecurityHeaders(res, url);
  },
};

function withSecurityHeaders(res, url) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (url.protocol === 'https:') out.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return out;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ');
  }
}

async function handleApi(request, env, url) {
  const path = url.pathname.slice('/api'.length);
  const method = request.method;

  if (path === '/status' && method === 'GET') return status(env);
  if (path === '/setup' && method === 'POST') return setup(request, env);
  if (path === '/login' && method === 'POST') return login(request, env);

  const session = await requireSession(request, env);

  if (path === '/ping' && method === 'POST') return json({ ok: true, idle_ms: IDLE_MS });
  if (path === '/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.token_hash).run();
    return json({ ok: true });
  }
  if (path === '/records' && method === 'GET') return pullRecords(env, url);
  let m = path.match(/^\/records\/([^/]+)$/);
  if (m && method === 'PUT') return putRecord(request, env, m[1]);
  if (m && method === 'DELETE') return deleteRecord(env, m[1], url);

  if (path === '/files' && method === 'POST') return uploadFile(request, env);
  m = path.match(/^\/files\/([^/]+)$/);
  if (m && method === 'GET') return downloadFile(env, m[1]);
  if (m && method === 'DELETE') return deleteFile(env, m[1]);

  if (path === '/logins' && method === 'GET') return listLogins(env);
  if (path === '/sessions' && method === 'GET') return listSessions(env, session);
  if (path === '/sessions/revoke-others' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash != ?').bind(session.token_hash).run();
    return json({ ok: true });
  }
  if (path === '/rekey' && method === 'POST') return rekey(request, env, session);

  throw new HttpError(404, 'Không có API này');
}

// ---------- Két và đăng nhập ----------

async function getVault(env) {
  return env.DB.prepare('SELECT * FROM vault WHERE id = 1').first();
}

async function status(env) {
  const vault = await getVault(env);
  return json({
    setup: !!vault,
    salt: vault?.salt ?? null,
    iterations: vault?.iterations ?? null,
    code_configured: !!parseSecrets(env),
  });
}

function clientInfo(request) {
  return {
    ip: request.headers.get('CF-Connecting-IP') ?? 'local',
    country: request.cf?.country ?? null,
    ua: (request.headers.get('User-Agent') ?? '').slice(0, 300),
  };
}

async function checkRateLimit(env, ip, now) {
  const since = now - FAIL_WINDOW_MS;
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN ip = ?1 THEN 1 ELSE 0 END) AS by_ip,
       COUNT(*) AS total
     FROM logins WHERE ok = 0 AND at > ?2`,
  ).bind(ip, since).first();
  if ((row?.by_ip ?? 0) >= MAX_FAILS_PER_IP || (row?.total ?? 0) >= MAX_FAILS_GLOBAL) {
    throw new HttpError(429, 'Sai quá nhiều lần. Đợi 15 phút rồi thử lại.');
  }
}

async function logLogin(env, info, now, ok, reason) {
  await env.DB.prepare('INSERT INTO logins (at, ip, country, ua, ok, reason) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(now, info.ip, info.country, info.ua, ok ? 1 : 0, reason ?? null)
    .run();
}

function validB64(s, min, max) {
  return typeof s === 'string' && s.length >= min && s.length <= max && B64_RE.test(s);
}

function validWrapped(s) {
  return typeof s === 'string' && WRAPPED_RE.test(s);
}

async function setup(request, env) {
  const now = Date.now();
  const info = clientInfo(request);
  const secrets = parseSecrets(env);
  if (!secrets) throw new HttpError(503, 'Chưa đặt CODE_K / CODE_P trên Cloudflare');
  await checkRateLimit(env, info.ip, now);
  if (await getVault(env)) throw new HttpError(409, 'Két đã được tạo rồi');

  const body = await readJson(request);
  if (!codeMatches(body.code, now, secrets)) {
    await logLogin(env, info, now, false, 'setup: sai mã');
    throw new HttpError(401, 'Sai mã');
  }
  const iterations = Number(body.iterations);
  if (!validB64(body.salt, 16, 64) || !validB64(body.auth, 40, 64) || !validWrapped(body.wrapped_key)
      || !Number.isInteger(iterations) || iterations < 300_000 || iterations > 5_000_000) {
    throw new HttpError(400, 'Dữ liệu tạo két không hợp lệ');
  }
  const authHash = await sha256b64(body.auth);
  const res = await env.DB.prepare(
    `INSERT INTO vault (id, salt, iterations, auth_hash, wrapped_key, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  ).bind(body.salt, iterations, authHash, body.wrapped_key, now, now).run();
  if (!res.meta.changes) throw new HttpError(409, 'Két đã được tạo rồi');
  await logLogin(env, info, now, true, 'setup');
  return json({ ok: true });
}

async function login(request, env) {
  const now = Date.now();
  const info = clientInfo(request);
  const secrets = parseSecrets(env);
  if (!secrets) throw new HttpError(503, 'Chưa đặt CODE_K / CODE_P trên Cloudflare');
  await checkRateLimit(env, info.ip, now);
  const vault = await getVault(env);
  if (!vault) throw new HttpError(409, 'Chưa tạo két');

  const body = await readJson(request);
  // Kiểm tra cả hai, rồi mới báo lỗi chung, để không lộ cái nào sai.
  const codeOk = codeMatches(body.code, now, secrets);
  const authOk = validB64(body.auth, 40, 64) && timingSafeEqualStr(await sha256b64(body.auth), vault.auth_hash);
  if (!codeOk || !authOk) {
    await logLogin(env, info, now, false, !codeOk && !authOk ? 'sai mã và mật khẩu' : !codeOk ? 'sai mã' : 'sai mật khẩu');
    throw new HttpError(401, 'Sai mật khẩu hoặc mã');
  }

  const token = randomB64(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?').bind(now - IDLE_MS, now - MAX_SESSION_MS),
    env.DB.prepare('DELETE FROM logins WHERE at < ?').bind(now - 180 * 24 * 60 * 60 * 1000),
    env.DB.prepare('INSERT INTO sessions (token_hash, created_at, last_seen, trusted, ip, ua) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256b64(token), now, now, body.trusted ? 1 : 0, info.ip, info.ua),
  ]);
  await logLogin(env, info, now, true, body.trusted ? 'máy riêng' : 'máy lạ');
  return json({ token, wrapped_key: vault.wrapped_key, idle_ms: IDLE_MS });
}

async function requireSession(request, env) {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!validB64(token, 40, 64)) throw new HttpError(401, 'Chưa đăng nhập');
  const now = Date.now();
  const tokenHash = await sha256b64(token);
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(tokenHash).first();
  if (!session || now - session.last_seen > IDLE_MS || now - session.created_at > MAX_SESSION_MS) {
    if (session) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    throw new HttpError(401, 'Phiên đã hết hạn');
  }
  if (now - session.last_seen > TOUCH_EVERY_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  }
  return session;
}

async function rekey(request, env, session) {
  const body = await readJson(request);
  const vault = await getVault(env);
  if (!validB64(body.current_auth, 40, 64) || !timingSafeEqualStr(await sha256b64(body.current_auth), vault.auth_hash)) {
    throw new HttpError(401, 'Mật khẩu hiện tại không đúng');
  }
  if (!validB64(body.auth, 40, 64) || !validWrapped(body.wrapped_key)) {
    throw new HttpError(400, 'Dữ liệu không hợp lệ');
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE vault SET auth_hash = ?, wrapped_key = ?, updated_at = ? WHERE id = 1')
      .bind(await sha256b64(body.auth), body.wrapped_key, now),
    // Đổi mật khẩu thì đá mọi máy khác ra.
    env.DB.prepare('DELETE FROM sessions WHERE token_hash != ?').bind(session.token_hash),
  ]);
  return json({ ok: true });
}

async function listLogins(env) {
  const { results } = await env.DB.prepare('SELECT at, ip, country, ua, ok, reason FROM logins ORDER BY at DESC LIMIT 50').all();
  return json({ logins: results });
}

async function listSessions(env, current) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    'SELECT token_hash, created_at, last_seen, trusted, ip, ua FROM sessions WHERE last_seen > ? ORDER BY last_seen DESC',
  ).bind(now - IDLE_MS).all();
  return json({
    sessions: results.map(({ token_hash, ...s }) => ({ ...s, current: token_hash === current.token_hash })),
  });
}

// ---------- Bản ghi (dùng chung cho mọi tiện ích) ----------

async function pullRecords(env, url) {
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
  const { results } = await env.DB.prepare(
    'SELECT id, data, version, seq, deleted, updated_at FROM records WHERE seq > ? ORDER BY seq LIMIT ?',
  ).bind(since, PULL_LIMIT + 1).all();
  const more = results.length > PULL_LIMIT;
  const records = more ? results.slice(0, PULL_LIMIT) : results;
  const cursor = records.length ? records[records.length - 1].seq : since;
  return json({ records, cursor, more });
}

async function currentRecord(env, id) {
  return env.DB.prepare('SELECT id, data, version, seq, deleted, updated_at FROM records WHERE id = ?').bind(id).first();
}

async function putRecord(request, env, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'id không hợp lệ');
  const body = await readJson(request);
  const base = Number(body.base_version);
  if (typeof body.data !== 'string' || !body.data || body.data.length > MAX_RECORD_CHARS) {
    throw new HttpError(413, 'Bản ghi quá lớn hoặc rỗng');
  }
  if (!Number.isInteger(base) || base < 0) throw new HttpError(400, 'base_version không hợp lệ');
  const now = Date.now();
  // Chỉ ghi khi bản trên server đúng là bản máy này đã thấy; nếu không thì báo xung đột.
  const row = await env.DB.prepare(
    `INSERT INTO records (id, data, version, seq, deleted, updated_at)
     VALUES (?1, ?2, 1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records), 0, ?3)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data, version = records.version + 1, seq = excluded.seq,
       deleted = 0, updated_at = excluded.updated_at
     WHERE records.version = ?4
     RETURNING version, seq`,
  ).bind(id, body.data, now, base).first();
  if (!row) return json({ error: 'conflict', current: await currentRecord(env, id) }, 409);
  return json({ version: row.version, seq: row.seq, updated_at: now });
}

async function deleteRecord(env, id, url) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'id không hợp lệ');
  const base = Number(url.searchParams.get('base_version'));
  const now = Date.now();
  // Giữ lại "bia mộ" để máy khác biết bản ghi đã bị xoá.
  const row = await env.DB.prepare(
    `UPDATE records SET data = '', deleted = 1, version = version + 1,
       seq = (SELECT MAX(seq) + 1 FROM records), updated_at = ?1
     WHERE id = ?2 AND version = ?3
     RETURNING version, seq`,
  ).bind(now, id, base).first();
  if (!row) {
    const current = await currentRecord(env, id);
    if (!current) return json({ version: 0, seq: 0, updated_at: now });
    return json({ error: 'conflict', current }, 409);
  }
  return json({ version: row.version, seq: row.seq, updated_at: now });
}

// ---------- File đính kèm (R2) ----------

async function uploadFile(request, env) {
  const len = Number(request.headers.get('Content-Length'));
  if (!len) throw new HttpError(411, 'Thiếu Content-Length');
  if (len > MAX_FILE_BYTES) throw new HttpError(413, 'File tối đa 50 MB');
  const id = randomB64(18);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_FILE_BYTES) throw new HttpError(413, 'File tối đa 50 MB');
  await env.FILES.put(`f/${id}`, body);
  await env.DB.prepare('INSERT INTO files (id, size, created_at) VALUES (?, ?, ?)').bind(id, body.byteLength, Date.now()).run();
  return json({ id, size: body.byteLength });
}

async function downloadFile(env, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'id không hợp lệ');
  const obj = await env.FILES.get(`f/${id}`);
  if (!obj) throw new HttpError(404, 'Không có file');
  return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream' } });
}

async function deleteFile(env, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'id không hợp lệ');
  await env.FILES.delete(`f/${id}`);
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ---------- Tiện ích mã hoá ----------

function toB64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function randomB64(n) {
  return toB64Url(crypto.getRandomValues(new Uint8Array(n)));
}

async function sha256b64(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return toB64Url(new Uint8Array(digest));
}

function timingSafeEqualStr(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}
