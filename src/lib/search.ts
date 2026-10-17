/**
 * Chuẩn hoá chuỗi tìm kiếm để so khớp không phân biệt hoa/thường và dấu tiếng Việt.
 * Nhờ vậy "ky yeu" vẫn tìm thấy "Kỷ yếu", và chỉ mục tìm kiếm trong cơ sở dữ
 * liệu cũng được ghi ở dạng đã chuẩn hoá.
 */
export function normalizeSearchKey(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
