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
