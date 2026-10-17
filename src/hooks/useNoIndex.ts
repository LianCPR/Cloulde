import { useEffect } from "react";

const META_NAME = "robots";
const NO_INDEX = "noindex, nofollow, noarchive";

/**
 * Đặt `noindex` cho trang hiện tại trong lúc nó còn hiển thị.
 *
 * VÌ SAO CẦN: với liên kết chia sẻ, **token trong URL chính là quyền truy cập**.
 * Nếu máy tìm kiếm đánh chỉ mục `/share/<token>`, album riêng tư trở thành công
 * khai qua kết quả tìm kiếm — không cần đoán, không cần bẻ khoá.
 *
 * Chỉ dùng `robots.txt` là KHÔNG đủ và còn phản tác dụng: nếu `robots.txt` chặn
 * `/share/`, trình thu thập sẽ không bao giờ tải trang để đọc thẻ `noindex`, nên
 * URL vẫn có thể bị đánh chỉ mục nhờ liên kết từ nơi khác. Vì vậy ở đây phải cho
 * phép thu thập nhưng trả lời rõ "đừng đánh chỉ mục" — và máy chủ cũng gửi kèm
 * header `X-Robots-Tag` để có hai lớp độc lập.
 *
 * Khi rời trang, thẻ được trả về trạng thái trước đó (kể cả xoá đi nếu chính hook
 * này đã tạo ra nó), nên điều hướng trong cùng một phiên không để lại tác dụng phụ.
 */
export function useNoIndex(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const existing = document.head.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`);
    const previousContent = existing?.getAttribute("content") ?? null;
    const meta = existing ?? document.createElement("meta");
    if (!existing) {
      meta.setAttribute("name", META_NAME);
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", NO_INDEX);

    return () => {
      if (existing) {
        if (previousContent === null) existing.removeAttribute("content");
        else existing.setAttribute("content", previousContent);
      } else {
        meta.remove();
      }
    };
  }, [enabled]);
}
