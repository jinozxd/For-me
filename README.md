# For-me

Web chạy trên máy để tự học, theo dõi tiến trình và quản lý file, làm theo kiểu game (XP, level, thanh tiến trình).

## Bản demo để duyệt ý tưởng

`demos/index.html` gom 5 bản demo trong một trang. Mở file này bằng trình duyệt là chạy, không cần cài gì.

| Bản | Cách chơi |
|---|---|
| A · Nhân vật RPG | Mỗi môn học là một chỉ số của nhân vật; file là đồ trong túi |
| B · Cây kỹ năng | Học xong một nút thì mở khóa nút sau, trùm cuối là dự án thật |
| C · Thị trấn học | Bấm giờ học để kiếm tài nguyên, xây và nâng cấp công trình; nhà kho là trình quản lý file |
| D · Thư mục = Bản đồ | Thư mục trên máy thành vùng đất, mỗi file là một ô sương mù (có nút quét thư mục thật) |
| E · Sư phụ & Đệ tử | Dạy lại cho đệ tử để có XP; đệ tử quên dần theo đường cong lãng quên kiểu FSRS |

Cả 5 bản dùng chung một lõi (`Core` trong file): công thức XP/level, thanh tiến trình, thông báo lên cấp. Màu và font nằm trong các biến CSS ở đầu file, nên đổi theme sau này chỉ cần sửa một chỗ.

Đây mới là bản demo: dữ liệu là mẫu, chưa lưu lại, chưa mở được file thật. Bản D chỉ đọc tên và dung lượng file trong trình duyệt, không gửi đi đâu.

## Rainbow Rush: Opus vs Sonnet (`demos/rainbow-race.html`)

Animation pixel 16-bit tự chạy: Opus 5.5 Max đua solo với Sonnet 5.5 Max trên đường cầu vồng giữa vũ trụ, né thiên thạch và chùm tia, cuối cùng Opus thắng sát nút. Mở file bằng trình duyệt là chạy, không cần mạng, không thư viện.

- `rainbow-race.html`: góc nhìn thứ nhất, nhìn qua mắt Opus. Thấy hai tay mình ở mép dưới, tên mình ở mép trên, Sonnet chạy phía trước có tên trên đầu. Khi Sonnet tụt ra sau thì hiện trong gương chiếu hậu.
- `rainbow-race-side.html`: cùng cuộc đua nhưng nhìn ngang.

Hai bản dùng chung một mô phỏng tất định (lặp lại y hệt mỗi vòng khoảng 27 giây), chỉ khác phần vẽ. Mỗi vòng có 0 lần va chạm và 12 lần né sát nút.

## Sổ ghi chú riêng (`hub/`)

Trang ghi chú mã hoá đầu cuối, dùng được trên nhiều máy, chạy miễn phí trên Cloudflare. Mỗi lần mở phải nhập mật khẩu chính và mã 6 số; tự khoá sau 30 phút không thao tác. Sau này các tiện ích khác (kể cả phần theo dõi học tập ở trên) sẽ gắn vào đây.

Cách đưa lên mạng và dùng: xem [`hub/README.md`](hub/README.md).
