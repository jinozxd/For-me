// Mã đăng nhập 6 số, tính bằng máy tính điện thoại.
//
//   4 số đầu (đổi mỗi ngày) = 4 chữ số cuối của  K × (ngày + tháng)
//   2 số cuối (đổi mỗi giờ) = 2 chữ số cuối của  giờ + P
//
// K (4 chữ số) và P (2 chữ số) là hai số bí mật, đặt bằng `wrangler secret put CODE_K` / `CODE_P`.
// Giờ và ngày tính theo giờ Việt Nam (UTC+7), giờ dạng 0–23.
//
// Ví dụ K = 5831, P = 37, lúc 14:20 ngày 5/10:
//   5831 × (5 + 10) = 87465  → 7465
//   14 + 37         = 51     → 51
//   Mã: 746551
//
// Muốn đổi công thức thì sửa hàm codeAt bên dưới, giữ nguyên đầu vào/đầu ra.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
// Gõ mã sát lúc đổi giờ (hoặc qua nửa đêm) thì mã của 5 phút trước vẫn được nhận.
const GRACE_MS = 5 * 60 * 1000;

export function vnParts(ms) {
  const d = new Date(ms + VN_OFFSET_MS);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, hour: d.getUTCHours() };
}

export function codeAt(ms, k, p) {
  const { day, month, hour } = vnParts(ms);
  const daily = String((k * (day + month)) % 10000).padStart(4, '0');
  const hourly = String((hour + p) % 100).padStart(2, '0');
  return daily + hourly;
}

export function parseSecrets(env) {
  const k = Number(env.CODE_K);
  const p = Number(env.CODE_P);
  if (!/^\d{4}$/.test(String(env.CODE_K ?? '')) || !/^\d{1,2}$/.test(String(env.CODE_P ?? ''))) return null;
  return { k, p };
}

export function codeMatches(input, nowMs, secrets) {
  if (!secrets || !/^\d{6}$/.test(String(input))) return false;
  const accepted = new Set([codeAt(nowMs, secrets.k, secrets.p), codeAt(nowMs - GRACE_MS, secrets.k, secrets.p)]);
  return accepted.has(String(input));
}
