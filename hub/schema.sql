-- Server chỉ giữ dữ liệu đã mã hoá; nó không đọc được nội dung ghi chú.

-- Một két duy nhất: salt để dẫn khoá, hash của khoá xác thực, và khoá dữ liệu đã bọc.
CREATE TABLE IF NOT EXISTS vault (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  salt        TEXT    NOT NULL,
  iterations  INTEGER NOT NULL,
  auth_hash   TEXT    NOT NULL,
  wrapped_key TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Phiên đăng nhập. Chỉ lưu hash của token.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  trusted    INTEGER NOT NULL DEFAULT 0,
  ip         TEXT,
  ua         TEXT
);

-- Mọi tiện ích dùng chung bảng này. data là ciphertext; server không biết bên trong là gì.
-- seq tăng dần trên mỗi lần ghi để máy khác kéo phần thay đổi.
CREATE TABLE IF NOT EXISTS records (
  id         TEXT    PRIMARY KEY,
  data       TEXT    NOT NULL,
  version    INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_seq ON records(seq);

-- File đính kèm (nội dung đã mã hoá nằm trong R2).
CREATE TABLE IF NOT EXISTS files (
  id         TEXT    PRIMARY KEY,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Nhật ký đăng nhập, cũng dùng để chặn đoán mã.
CREATE TABLE IF NOT EXISTS logins (
  at      INTEGER NOT NULL,
  ip      TEXT,
  country TEXT,
  ua      TEXT,
  ok      INTEGER NOT NULL,
  reason  TEXT
);
CREATE INDEX IF NOT EXISTS logins_at ON logins(at);
