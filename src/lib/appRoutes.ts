/**
 * Phân loại tuyến đường — module LÁ, không import gì.
 *
 * Cố ý để riêng: `app/router.tsx` import `AppShell`, mà `AppShell` lại cần biết
 * đâu là trang của khách. Nếu để hàm này trong `router.tsx` thì hai module import
 * vòng nhau; chạy được nhưng phụ thuộc vào thứ tự đánh giá của bundler.
 */

/**
 * Tuyến đường dành riêng cho KHÁCH — người chỉ có một liên kết chia sẻ.
 *
 * Trên những tuyến này người xem KHÔNG cần đăng nhập và KHÔNG cần kết nối kho
 * lưu trữ: quyền nằm trong chính token của liên kết, do máy chủ kiểm tra. Vì vậy
 * khung ứng dụng phải ẩn hết những gì thuộc về chủ kho. Nếu không, khách sẽ thấy
 * lời nhắc "chưa kết nối kho lưu trữ" và tưởng rằng phải đăng nhập mới xem được
 * album — trong khi yêu cầu là chỉ cần mở liên kết là xem và tải được.
 */
export function isGuestPath(pathname: string): boolean {
  return pathname === "/share" || pathname.startsWith("/share/");
}
