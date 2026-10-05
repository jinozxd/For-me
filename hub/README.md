# For-me Hub — sổ ghi chú riêng, mã hoá đầu cuối

Trang web ghi chú chỉ mình chủ dùng được, mở được trên nhiều máy (kể cả máy lạ), chạy miễn phí trên Cloudflare.

- Ghi chú Markdown, checklist (`- [ ] việc`), thư mục, thẻ, ghim, tìm kiếm không cần dấu.
- Đính kèm ảnh/file (tối đa 50 MB mỗi file), mã hoá trước khi tải lên.
- Đồng bộ nhiều máy; sửa cùng lúc trên hai máy thì giữ cả hai bản, không mất chữ.
- Máy riêng: lưu bản đã khoá để xem khi mất mạng. Máy lạ: không lưu gì.
- Mỗi lần mở hoặc tải lại trang phải nhập mật khẩu chính + mã 6 số.
- Tự khoá sau 30 phút không thao tác. Máy lạ còn tự khoá khi mất kết nối 30 phút.
- Nhật ký đăng nhập, xem các máy đang đăng nhập, đăng xuất mọi máy khác, đổi mật khẩu, xuất bản sao lưu.

## Bảo mật hoạt động thế nào

```
mật khẩu chính ──PBKDF2 600.000 vòng──▶ khoá gốc ─┬─▶ khoá xác thực (gửi server, server chỉ lưu hash)
                                                 └─▶ khoá mở két (không rời khỏi trình duyệt)
```

- Server (Cloudflare) chỉ giữ dữ liệu đã mã hoá AES-256-GCM. Không có mật khẩu chính thì kể cả Cloudflare cũng không đọc được.
- Muốn lấy dữ liệu về phải qua cả hai lớp: mật khẩu chính **và** mã 6 số.
- Sai 5 lần trong 15 phút thì bị chặn 15 phút.
- Trang không tải bất kỳ script, font hay thư viện nào từ bên ngoài.

**Quên mật khẩu chính là mất toàn bộ ghi chú.** Không ai khôi phục được, đó là cái giá của mã hoá đầu cuối.

## Mã 6 số

| Phần | Đổi khi nào | Cách tính |
|---|---|---|
| 4 số đầu | mỗi ngày | 4 chữ số cuối của **K × (ngày + tháng)** |
| 2 số cuối | mỗi giờ | 2 chữ số cuối của **giờ + P** (giờ 0–23, giờ Việt Nam) |

K (4 chữ số) và P (1–2 chữ số) là hai số bí mật cậu tự chọn.

Ví dụ với K = 5831, P = 37, lúc 14:20 ngày 5/10:

- 5831 × (5 + 10) = 87465 → **7465**
- 14 + 37 = 51 → **51**
- Mã: **746551**

Vừa qua giờ mới (hoặc qua nửa đêm) thì mã cũ vẫn dùng được thêm 5 phút. Muốn đổi công thức thì sửa hàm `codeAt` trong `src/code.js`.

> **Đừng dùng K = 5831, P = 37 trong ví dụ.** Repo này công khai nên ai cũng đọc được công thức. Thứ giữ bí mật là hai số K, P. Công thức tính nhẩm có điểm yếu: ai nhìn thấy một mã kèm giờ nhập có thể tính ngược ra K và P. Vì vậy lớp chắn chính vẫn là mật khẩu chính. Thấy lần đăng nhập lạ trong nhật ký thì đổi K, P (lệnh ở bước 5 bên dưới) và đổi mật khẩu chính.

## Đưa lên mạng (làm một lần, trên máy tính)

Cần: tài khoản [Cloudflare](https://dash.cloudflare.com/sign-up) miễn phí và Node.js 20 trở lên.

```sh
cd hub
npm install
npx wrangler login                      # mở trình duyệt để đăng nhập Cloudflare
```

1. **Tạo cơ sở dữ liệu:**
   ```sh
   npx wrangler d1 create hub-db
   ```
   Lệnh in ra một `database_id`. Dán nó vào `wrangler.jsonc`, thay cho dãy `00000000-...`.

2. **Tạo chỗ chứa file:**
   ```sh
   npx wrangler r2 bucket create hub-files
   ```
   Lần đầu dùng R2, Cloudflare bắt thêm thẻ thanh toán để xác minh. Dưới 10 GB thì không mất tiền.

3. **Tạo bảng:**
   ```sh
   npm run db:init
   ```

4. **Đưa web lên:**
   ```sh
   npm run deploy
   ```
   Lệnh in ra địa chỉ dạng `https://for-me-hub.<tên-cậu>.workers.dev`.

5. **Đặt hai số bí mật** (gõ số khi được hỏi; không lưu vào file nào):
   ```sh
   npx wrangler secret put CODE_K          # 4 chữ số, vd 0427
   npx wrangler secret put CODE_P          # 1–2 chữ số, vd 58
   ```

6. **Tạo két:** mở địa chỉ ở bước 4 trên máy riêng, đặt mật khẩu chính (ít nhất 12 ký tự), nhập mã 6 số.

Muốn cập nhật code sau này, chỉ cần chạy lại `npm run deploy`.

## Dùng hằng ngày

- **Máy lạ:** mở bằng cửa sổ ẩn danh, **bỏ chọn** "Đây là máy riêng của tớ". Không bấm "Lưu mật khẩu" khi trình duyệt hỏi. Xong việc thì bấm **Khoá**.
- **Máy riêng:** để chọn "máy riêng". Trên điện thoại, chọn "Thêm vào màn hình chính" để mở như app. Khi mất mạng vẫn mở được bằng mật khẩu chính; có mạng lại thì nhập mã để đồng bộ.
- Thỉnh thoảng vào **Cài đặt → Nhật ký đăng nhập** xem có lần nào lạ không.

## Miễn phí tới đâu

Gói miễn phí của Cloudflare:
- D1 (cơ sở dữ liệu): 5 GB, 5 triệu dòng đọc và 100 nghìn dòng ghi mỗi ngày.
- R2 (chứa file): 10 GB.
- Workers: 100 nghìn lượt gọi mỗi ngày.

Một người ghi chú khó chạm tới các mức này. Cloudflare có thể đổi hạn mức, nên xem lại trang giá của họ khi cần.

## Thêm tiện ích mới

Tạo một file trong `public/js/tools/`, rồi thêm nó vào mảng trong `public/js/tools/index.js`. File đó có ghi chú về những gì mỗi tiện ích nhận được.

Mỗi tiện ích lưu bản ghi với một `type` riêng, ví dụ `'habit'`. Kho bản ghi tự mã hoá và đồng bộ, nên **không phải sửa server**.

## Chạy thử trên máy

```sh
cd hub
npm install
printf 'CODE_K=1234\nCODE_P=56\n' > .dev.vars   # số bí mật chỉ dùng khi chạy thử
npm run db:init:local
npm run dev                                       # mở http://localhost:8787
npm test                                          # kiểm tra công thức mã
```

## Cấu trúc

```
hub/
  wrangler.jsonc        cấu hình Cloudflare (D1, R2, file tĩnh)
  schema.sql            bảng dữ liệu (chỉ chứa ciphertext)
  src/worker.js         API: đăng nhập, phiên, chặn đoán mã, bản ghi, file
  src/code.js           công thức mã 6 số
  public/
    index.html, app.css, sw.js (cho máy riêng dùng offline)
    js/crypto.js        mã hoá đầu cuối
    js/store.js         kho bản ghi + đồng bộ + xử lý xung đột
    js/main.js          màn hình khoá, phiên, tự khoá
    js/tools/           các tiện ích (ghi chú, cài đặt, ...)
```
