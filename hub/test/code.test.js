import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeAt, codeMatches, parseSecrets } from '../src/code.js';

const secrets = { k: 5831, p: 37 };
// 14:20 ngày 5/10/2026 giờ Việt Nam = 07:20 UTC
const vn = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 7, mi);

test('ví dụ trong hướng dẫn', () => {
  assert.equal(codeAt(vn(2026, 10, 5, 14, 20), secrets.k, secrets.p), '746551');
});

test('dùng giờ Việt Nam, không dùng UTC', () => {
  // 01:30 ngày 6/10 ở VN vẫn là 18:30 ngày 5/10 theo UTC
  const t = vn(2026, 10, 6, 1, 30);
  assert.equal(codeAt(t, 5831, 37), String((5831 * 16) % 10000).padStart(4, '0') + '38');
});

test('đệm số 0 ở đầu', () => {
  assert.equal(codeAt(vn(2026, 1, 1, 0, 5), 5000, 0), '000000'); // 5000 × 2 = 10000 → 0000; 0 + 0 → 00
  assert.equal(codeAt(vn(2026, 1, 1, 23, 0), 1, 99), '000222'); // 1 × 2 = 0002; 23 + 99 = 122 → 22
});

test('chấp nhận mã của 5 phút trước khi vừa qua giờ', () => {
  const before = codeAt(vn(2026, 10, 5, 14, 59), 5831, 37);
  assert.equal(codeMatches(before, vn(2026, 10, 5, 15, 3), secrets), true);
  assert.equal(codeMatches(before, vn(2026, 10, 5, 15, 6), secrets), false);
});

test('qua nửa đêm: mã hôm trước còn hiệu lực 5 phút', () => {
  const lastNight = codeAt(vn(2026, 10, 5, 23, 58), 5831, 37);
  assert.equal(codeMatches(lastNight, vn(2026, 10, 6, 0, 2), secrets), true);
});

test('từ chối mã sai định dạng', () => {
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, 746551]) {
    assert.equal(codeMatches(bad, vn(2026, 10, 5, 14, 20), secrets), bad === 746551);
  }
});

test('thiếu hoặc sai secret thì không cấu hình', () => {
  assert.equal(parseSecrets({}), null);
  assert.equal(parseSecrets({ CODE_K: '123', CODE_P: '37' }), null);
  assert.deepEqual(parseSecrets({ CODE_K: '0042', CODE_P: '7' }), { k: 42, p: 7 });
});
