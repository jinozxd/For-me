// Khung app: màn hình khoá, phiên làm việc, tự khoá sau 30 phút, và nạp các tiện ích.

import { api, hasToken, lastServerContact, logoutOnLeave, onSessionExpired, setToken } from './api.js';
import { ITERATIONS, b64u, deriveKeys, newDataKey, randomBytes, unwrapDataKey, wrapDataKey } from './crypto.js';
import { Files } from './files.js';
import { local } from './idb.js';
import { Store } from './store.js';
import { tools } from './tools/index.js';
import { clear, confirmBox, h, toast } from './ui.js';

const IDLE_MS = 30 * 60 * 1000;
const WARN_MS = 5 * 60 * 1000;
const PING_EVERY_MS = 4 * 60 * 1000;
const SYNC_EVERY_MS = 30 * 1000;

const LOCK_REASONS = {
  idle: 'Đã tự khoá vì 30 phút không thao tác.',
  offline: 'Đã tự khoá vì mất kết nối quá 30 phút.',
  expired: 'Phiên đã hết hạn hoặc bị đăng xuất từ máy khác.',
  manual: 'Đã khoá.',
};

const root = document.getElementById('app');
const session = { store: null, files: null, trusted: false, meta: null, offlineAuth: null };
let locking = false;

boot();

async function boot() {
  const reason = location.hash.match(/^#locked:(\w+)$/)?.[1];
  if (reason) history.replaceState(null, '', location.pathname);
  let status = null;
  try {
    status = await api('/status');
  } catch {
    // mất mạng: máy riêng vẫn mở được bản lưu
  }
  const localVault = await local.getMeta('vault').catch(() => null);
  if (status && !status.setup) return showSetup(status);
  if (!status && !localVault) return showNoConnection();
  showLogin(status, localVault, LOCK_REASONS[reason]);
}

// ---------- Màn hình khoá ----------

function lockShell(title, ...content) {
  clear(
    root,
    h('div', { class: 'lock' }, h('div', { class: 'lock-card' }, h('div', { class: 'lock-logo', 'aria-hidden': 'true' }, '🔐'), h('h1', {}, title), ...content)),
  );
}

function vnClock() {
  const el = h('p', { class: 'muted small clock' });
  const tick = () => {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    el.textContent = `Giờ Việt Nam (theo đồng hồ máy này): ${hh}:${mm} · ngày ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  };
  tick();
  const t = setInterval(() => (el.isConnected ? tick() : clearInterval(t)), 15000);
  return el;
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
}

function codeInput(required) {
  return h('input', {
    type: 'text',
    inputmode: 'numeric',
    pattern: '\\d{6}',
    maxlength: '6',
    autocomplete: 'one-time-code',
    placeholder: '6 số',
    required,
    class: 'code',
  });
}

function showNoConnection() {
  lockShell(
    'Không kết nối được',
    h('p', { class: 'muted' }, 'Không tới được server và máy này chưa lưu bản offline nào.'),
    h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Thử lại'),
  );
}

function showLogin(status, localVault, notice) {
  const online = !!status;
  const pass = h('input', { type: 'password', autocomplete: 'off', required: true, placeholder: 'Mật khẩu chính' });
  const code = codeInput(online);
  const trusted = h('input', { type: 'checkbox', checked: !!localVault });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, online ? 'Mở khoá' : 'Mở bản lưu trên máy');

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Đang mở khoá…';
        try {
          if (online) await unlockOnline(pass.value, code.value.trim(), trusted.checked, status, localVault);
          else await unlockOffline(pass.value, localVault);
        } catch (ex) {
          err.textContent = ex.message;
          code.value = '';
          btn.disabled = false;
          btn.textContent = online ? 'Mở khoá' : 'Mở bản lưu trên máy';
        }
      },
    },
    notice ? h('p', { class: 'notice' }, notice) : null,
    online ? null : h('p', { class: 'notice' }, 'Không có mạng. Mở bản đã lưu trên máy này; có mạng lại thì nhập mã để đồng bộ.'),
    field('Mật khẩu chính', pass),
    online ? field('Mã 6 số', code, '4 số theo ngày + 2 số theo giờ') : null,
    online ? vnClock() : null,
    online
      ? h(
          'label',
          { class: 'check' },
          trusted,
          h('span', {}, 'Đây là máy riêng của tớ', h('small', { class: 'muted block' }, 'Lưu bản đã khoá để xem khi mất mạng. Máy lạ thì bỏ chọn: không lưu gì lại.')),
        )
      : null,
    err,
    btn,
  );
  lockShell('For-me', form);
  pass.focus();
}

function showSetup(status) {
  if (!status.code_configured) {
    return lockShell(
      'Chưa cấu hình mã',
      h('p', {}, 'Server chưa có hai số bí mật CODE_K và CODE_P. Làm theo bước "Đặt số bí mật" trong hướng dẫn rồi tải lại trang.'),
    );
  }
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '12' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const code = codeInput(true);
  const trusted = h('input', { type: 'checkbox', checked: true });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Tạo két');

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (p1.value.length < 12) return (err.textContent = 'Mật khẩu chính cần ít nhất 12 ký tự.');
        if (p1.value !== p2.value) return (err.textContent = 'Hai lần nhập không khớp.');
        btn.disabled = true;
        btn.textContent = 'Đang tạo…';
        try {
          await createVault(p1.value, code.value.trim(), trusted.checked);
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
          btn.textContent = 'Tạo két';
        }
      },
    },
    h(
      'p',
      { class: 'notice warn' },
      'Mật khẩu chính khoá toàn bộ ghi chú ngay trên máy. Quên nó là mất hết, không ai khôi phục được, kể cả server.',
    ),
    field('Mật khẩu chính', p1, 'Ít nhất 12 ký tự. Dễ nhớ mà khó đoán: vd 4 từ ngẫu nhiên ghép lại.'),
    field('Nhập lại mật khẩu chính', p2),
    field('Mã 6 số', code, '4 số theo ngày + 2 số theo giờ'),
    vnClock(),
    h('label', { class: 'check' }, trusted, h('span', {}, 'Đây là máy riêng của tớ')),
    err,
    btn,
  );
  lockShell('Tạo két mới', form);
  p1.focus();
}

// ---------- Mở khoá ----------

async function createVault(passphrase, code, trusted) {
  const salt = b64u(randomBytes(16));
  const { auth, kek } = await deriveKeys(passphrase, salt, ITERATIONS);
  const wrapped_key = await wrapDataKey(await newDataKey(), kek);
  await api('/setup', { method: 'POST', body: { code, salt, iterations: ITERATIONS, auth, wrapped_key } });
  const res = await api('/login', { method: 'POST', body: { auth, code, trusted } });
  const dek = await unwrapDataKey(res.wrapped_key, kek);
  setToken(res.token);
  await startSession({ dek, trusted, meta: { salt, iterations: ITERATIONS, wrapped_key: res.wrapped_key } });
}

async function unlockOnline(passphrase, code, trusted, status, localVault) {
  const { auth, kek } = await deriveKeys(passphrase, status.salt, status.iterations);
  const res = await api('/login', { method: 'POST', body: { auth, code, trusted } });
  const dek = await unwrapDataKey(res.wrapped_key, kek);
  setToken(res.token);
  if (!trusted && localVault) {
    // Bỏ chọn "máy riêng" trên máy đang lưu bản offline: gửi nốt thay đổi chờ rồi xoá sạch.
    const old = new Store(dek, { persist: true });
    await old.load();
    if (old.pending) await old.sync().catch(() => {});
  }
  await startSession({ dek, trusted, meta: { salt: status.salt, iterations: status.iterations, wrapped_key: res.wrapped_key } });
}

async function unlockOffline(passphrase, localVault) {
  const { auth, kek } = await deriveKeys(passphrase, localVault.salt, localVault.iterations);
  const dek = await unwrapDataKey(localVault.wrapped_key, kek);
  await startSession({ dek, trusted: true, meta: localVault, offlineAuth: auth });
}

async function startSession({ dek, trusted, meta, offlineAuth = null }) {
  session.trusted = trusted;
  session.meta = meta;
  session.offlineAuth = offlineAuth;
  if (trusted) {
    await local.setMeta('vault', meta);
    registerServiceWorker();
  } else {
    await local.wipe();
    await unregisterServiceWorker();
  }
  session.store = new Store(dek, { persist: trusted });
  session.files = new Files(dek);
  await session.store.load();
  if (hasToken()) await session.store.sync().catch((e) => toast(e.message, 'error'));
  startApp();
}

// Đăng nhập lại khi đang mở bản offline và vừa có mạng.
async function reconnect(code) {
  const res = await api('/login', { method: 'POST', body: { auth: session.offlineAuth, code, trusted: true } });
  setToken(res.token);
  session.offlineAuth = null;
  if (res.wrapped_key !== session.meta.wrapped_key) {
    session.meta = { ...session.meta, wrapped_key: res.wrapped_key };
    await local.setMeta('vault', session.meta);
  }
  await session.store.sync();
}

// ---------- Khoá ----------

// Khoá = đăng xuất rồi tải lại trang, để khoá và nội dung đã giải mã bị xoá khỏi bộ nhớ.
async function lock(reason = 'manual') {
  if (locking) return;
  locking = true;
  if (hasToken()) {
    await Promise.race([api('/logout', { method: 'POST' }).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  }
  setToken(null);
  session.files?.revokeAll();
  location.replace(`${location.pathname}#locked:${reason}`);
  location.reload();
}

onSessionExpired(() => lock('expired'));

window.addEventListener('beforeunload', (e) => {
  if (!locking && session.store && !session.trusted && session.store.pending) e.preventDefault();
});
window.addEventListener('pagehide', logoutOnLeave);

// ---------- Service worker (chỉ máy riêng) ----------

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

async function unregisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  }
  if (self.caches) for (const key of await caches.keys()) await caches.delete(key);
}

async function forgetDevice() {
  await local.wipe();
  await unregisterServiceWorker();
  session.trusted = false;
  session.store.persist = false;
}

async function changePassphrase(current, next) {
  const { salt, iterations, wrapped_key } = session.meta;
  const oldKeys = await deriveKeys(current, salt, iterations);
  const dek = await unwrapDataKey(wrapped_key, oldKeys.kek, true);
  const newKeys = await deriveKeys(next, salt, iterations);
  const newWrapped = await wrapDataKey(dek, newKeys.kek);
  await api('/rekey', { method: 'POST', body: { current_auth: oldKeys.auth, auth: newKeys.auth, wrapped_key: newWrapped } });
  session.meta = { ...session.meta, wrapped_key: newWrapped };
  if (session.trusted) await local.setMeta('vault', session.meta);
}

// ---------- App ----------

function startApp() {
  const syncEl = h('span', { class: 'sync' });
  const idleEl = h('span', { class: 'idle-timer' });
  const banner = h('div', { class: 'banner', hidden: true });
  const main = h('main', { class: 'tool' });
  const tabs = tools.map((t) => h('a', { href: `#${t.id}`, class: 'tab', dataset: { tool: t.id } }, h('span', { 'aria-hidden': 'true' }, t.icon), ' ', t.name));

  clear(
    root,
    h(
      'header',
      { class: 'topbar' },
      h('strong', { class: 'brand' }, 'For-me'),
      h('nav', { class: 'tabs' }, tabs),
      h('div', { class: 'top-right' }, syncEl, idleEl, h('button', { class: 'btn', onclick: () => lockClicked() }, 'Khoá')),
    ),
    banner,
    main,
  );

  const ctx = {
    store: session.store,
    files: session.files,
    api,
    get trusted() {
      return session.trusted;
    },
    forgetDevice,
    changePassphrase,
    lock,
  };

  let unmount = null;
  function route() {
    const id = location.hash.slice(1);
    const tool = tools.find((t) => t.id === id) ?? tools[0];
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tool === tool.id);
    unmount?.();
    clear(main);
    unmount = tool.mount(main, ctx) ?? null;
  }
  window.addEventListener('hashchange', route);
  route();

  function renderSync() {
    const s = session.store;
    const n = s.pending;
    let text;
    if (!hasToken()) text = n ? `Bản trên máy · ${n} thay đổi chờ gửi` : 'Bản trên máy';
    else if (s.state === 'syncing') text = 'Đang đồng bộ…';
    else if (s.state === 'offline') text = n ? `Mất mạng · ${n} thay đổi chờ gửi` : 'Mất mạng';
    else if (s.state === 'error') text = 'Lỗi đồng bộ';
    else text = n ? `${n} thay đổi chờ gửi` : 'Đã đồng bộ';
    syncEl.textContent = text;
    syncEl.className = `sync sync-${hasToken() ? s.state : 'offline'}`;
    syncEl.title = s.lastError?.message ?? '';
    renderBanner();
  }
  session.store.on(renderSync);

  function renderBanner() {
    if (hasToken() || !session.offlineAuth) {
      banner.hidden = true;
      return;
    }
    if (banner.childElementCount) {
      banner.hidden = false;
      return;
    }
    const code = codeInput(true);
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Đồng bộ');
    clear(
      banner,
      h(
        'form',
        {
          class: 'row wrap',
          onsubmit: async (e) => {
            e.preventDefault();
            btn.disabled = true;
            try {
              await reconnect(code.value.trim());
              clear(banner);
              toast('Đã đồng bộ');
            } catch (ex) {
              toast(ex.message, 'error');
              code.value = '';
            } finally {
              btn.disabled = false;
              renderSync();
            }
          },
        },
        h('span', {}, 'Đang dùng bản lưu trên máy. Có mạng thì nhập mã để đồng bộ:'),
        code,
        btn,
      ),
    );
    banner.hidden = false;
  }
  renderSync();

  // Tự khoá khi 30 phút không thao tác; máy lạ còn khoá khi mất liên lạc với server 30 phút.
  let lastActivity = Date.now();
  let lastPing = Date.now();
  const mark = () => {
    lastActivity = Date.now();
    if (hasToken() && lastActivity - lastPing > PING_EVERY_MS) {
      lastPing = lastActivity;
      api('/ping', { method: 'POST' }).catch(() => {});
    }
  };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  }
  function checkIdle() {
    const now = Date.now();
    if (now - lastActivity > IDLE_MS) return lock('idle');
    if (!session.trusted && hasToken() && now - lastServerContact() > IDLE_MS) return lock('offline');
    const left = IDLE_MS - (now - lastActivity);
    idleEl.textContent = left < WARN_MS ? `Tự khoá sau ${Math.ceil(left / 60000)} phút` : '';
  }
  document.addEventListener('visibilitychange', checkIdle);
  setInterval(checkIdle, 5000);

  const syncNow = () => {
    if (hasToken()) session.store.sync().catch(() => {});
  };
  setInterval(syncNow, SYNC_EVERY_MS);
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());

  async function lockClicked() {
    if (!session.trusted && session.store.pending) {
      const ok = await confirmBox(`Còn ${session.store.pending} thay đổi chưa gửi lên server và sẽ mất nếu khoá bây giờ. Vẫn khoá?`, 'Khoá');
      if (!ok) return;
    }
    lock('manual');
  }
}
