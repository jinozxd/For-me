// Cài đặt: thiết bị, phiên đăng nhập, nhật ký, đổi mật khẩu, sao lưu.

import { hasToken } from '../api.js';
import { clear, confirmBox, formatTime, h, toast } from '../ui.js';

export default {
  id: 'settings',
  name: 'Cài đặt',
  icon: '⚙️',
  mount,
};

function shortUa(ua = '') {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 40) || 'không rõ';
}

function section(title, ...children) {
  return h('section', { class: 'card' }, h('h2', {}, title), ...children);
}

function mount(root, ctx) {
  const { store, api } = ctx;
  const deviceBox = h('div');
  const sessionsBox = h('div', {}, h('p', { class: 'muted' }, 'Đang tải…'));
  const loginsBox = h('div', {}, h('p', { class: 'muted' }, 'Đang tải…'));

  root.append(
    h(
      'div',
      { class: 'settings' },
      section('Thiết bị này', deviceBox),
      section('Máy đang đăng nhập', sessionsBox),
      section('Nhật ký đăng nhập', h('p', { class: 'muted small' }, 'Thấy lần đăng nhập lạ thì đổi mật khẩu chính và bấm "Đăng xuất mọi máy khác".'), loginsBox),
      section('Đổi mật khẩu chính', passwordForm()),
      section('Sao lưu', backup()),
      section(
        'Cách tính mã 6 số',
        h('p', {}, '4 số đầu (đổi mỗi ngày): lấy 4 chữ số cuối của K × (ngày + tháng).'),
        h('p', {}, '2 số cuối (đổi mỗi giờ): lấy 2 chữ số cuối của giờ + P (giờ 0–23, giờ Việt Nam).'),
        h('p', { class: 'muted small' }, 'Ví dụ K = 5831, P = 37, 14:20 ngày 5/10 → 5831 × 15 = 87465 → 7465; 14 + 37 = 51 → mã 746551.'),
      ),
    ),
  );

  function renderDevice() {
    clear(
      deviceBox,
      ctx.trusted
        ? [
            h('p', {}, 'Máy riêng: ghi chú được lưu ở dạng đã khoá để xem khi mất mạng.'),
            h(
              'button',
              {
                class: 'btn danger',
                onclick: async () => {
                  if (store.pending) return toast('Còn thay đổi chưa gửi lên server. Đợi đồng bộ xong rồi thử lại.', 'error');
                  if (!(await confirmBox('Xoá bản lưu offline trên máy này? Dữ liệu trên server không bị ảnh hưởng.', 'Xoá bản lưu'))) return;
                  await ctx.forgetDevice();
                  toast('Đã xoá bản lưu trên máy này');
                  renderDevice();
                },
              },
              'Quên máy này',
            ),
          ]
        : h('p', {}, 'Máy lạ: không lưu gì lại trên máy. Khoá hoặc tải lại trang là xoá sạch khỏi bộ nhớ.'),
    );
  }
  renderDevice();

  async function loadSessions() {
    if (!hasToken()) return clear(sessionsBox, h('p', { class: 'muted' }, 'Cần có mạng và đã nhập mã.'));
    try {
      const { sessions } = await api('/sessions');
      clear(
        sessionsBox,
        h(
          'ul',
          { class: 'plain-list' },
          sessions.map((s) =>
            h(
              'li',
              {},
              h('strong', {}, shortUa(s.ua)),
              s.current ? h('span', { class: 'badge' }, 'máy này') : null,
              s.trusted ? h('span', { class: 'badge muted-badge' }, 'máy riêng') : h('span', { class: 'badge muted-badge' }, 'máy lạ'),
              h('div', { class: 'muted small' }, `IP ${s.ip} · vào lúc ${formatTime(s.created_at)} · hoạt động ${formatTime(s.last_seen)}`),
            ),
          ),
        ),
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!(await confirmBox('Đăng xuất mọi máy khác ngay bây giờ?', 'Đăng xuất'))) return;
              try {
                await api('/sessions/revoke-others', { method: 'POST' });
                toast('Đã đăng xuất mọi máy khác');
                loadSessions();
              } catch (e) {
                toast(e.message, 'error');
              }
            },
          },
          'Đăng xuất mọi máy khác',
        ),
      );
    } catch (e) {
      clear(sessionsBox, h('p', { class: 'error' }, e.message));
    }
  }

  async function loadLogins() {
    if (!hasToken()) return clear(loginsBox, h('p', { class: 'muted' }, 'Cần có mạng và đã nhập mã.'));
    try {
      const { logins } = await api('/logins');
      clear(
        loginsBox,
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'log' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Lúc'), h('th', {}, ''), h('th', {}, 'Ghi chú'), h('th', {}, 'IP'), h('th', {}, 'Máy'))),
            h(
              'tbody',
              {},
              logins.map((l) =>
                h(
                  'tr',
                  { class: l.ok ? '' : 'fail' },
                  h('td', {}, formatTime(l.at)),
                  h('td', {}, l.ok ? '✓' : '✗'),
                  h('td', {}, l.reason ?? ''),
                  h('td', {}, [l.ip, l.country].filter(Boolean).join(' · ')),
                  h('td', {}, shortUa(l.ua)),
                ),
              ),
            ),
          ),
        ),
      );
    } catch (e) {
      clear(loginsBox, h('p', { class: 'error' }, e.message));
    }
  }

  function passwordForm() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '12' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Đổi mật khẩu');
    return h(
      'form',
      {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault();
          if (!hasToken()) return toast('Cần có mạng và đã nhập mã.', 'error');
          if (p1.value.length < 12) return toast('Mật khẩu mới cần ít nhất 12 ký tự.', 'error');
          if (p1.value !== p2.value) return toast('Hai lần nhập mật khẩu mới không khớp.', 'error');
          btn.disabled = true;
          btn.textContent = 'Đang đổi…';
          try {
            await ctx.changePassphrase(cur.value, p1.value);
            cur.value = p1.value = p2.value = '';
            toast('Đã đổi mật khẩu. Các máy khác đã bị đăng xuất.');
            loadSessions();
          } catch (ex) {
            toast(ex.message, 'error');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Đổi mật khẩu';
          }
        },
      },
      h('label', { class: 'field' }, h('span', {}, 'Mật khẩu hiện tại'), cur),
      h('label', { class: 'field' }, h('span', {}, 'Mật khẩu mới (ít nhất 12 ký tự)'), p1),
      h('label', { class: 'field' }, h('span', {}, 'Nhập lại mật khẩu mới'), p2),
      btn,
    );
  }

  function backup() {
    return [
      h('p', { class: 'muted small' }, 'File tải về ở dạng đọc được (chưa mã hoá) và không gồm nội dung file đính kèm. Cất nó ở nơi an toàn; đừng tải trên máy lạ.'),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            const records = [];
            for (const r of store.records.values()) if (!r.deleted && r.value) records.push({ id: r.id, ...r.value });
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `for-me-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
        },
        'Tải bản sao lưu (.json)',
      ),
    ];
  }

  loadSessions();
  loadLogins();
}
