/**
 * Trạng thái "Đã đọc và xác nhận" khi gửi ảnh lên.
 *
 * Người dùng chỉ cần xác nhận MỘT lần mỗi trình duyệt. Đã xác nhận thì nhớ
 * vĩnh viễn trong localStorage — không quay lên hỏi lại, không làm đường tải
 * ảnh of người dùng quen mặt chậm một nhịp.
 */
const KEY = "cloude-upload-ack-v1";

export function isUploadAckValid(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markUploadAck(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // LocalStorage chặn (chế độ riêng tư) — cứ cho phép luồng tiếp diễn,
    // lần sau lại xác nhận: đánh đổi nhỏ, không kẹt người dùng.
  }
}
