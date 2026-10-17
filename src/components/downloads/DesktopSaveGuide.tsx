import { Archive, FolderDown, Monitor, PackageOpen, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatCount } from "@/lib/format";

export interface DesktopSaveGuideProps {
  fileCount: number;
  totalBytes: number;
  /** Trình duyệt có hỗ trợ ghi thẳng vào thư mục (File System Access API) không. */
  canChooseFolder: boolean;
  /** Gói ZIP có vượt giới hạn tạo ZIP phía trình duyệt không. */
  zipExceedsLimit: boolean;
  onPickFolder: () => void;
  onUseZip: () => void;
  onUseIndividual: () => void;
}

/**
 * Màn hình hướng dẫn trước khi lưu trên máy tính.
 *
 * Nguyên tắc: đường nào ít bước nhất và dễ tìm lại ảnh nhất thì đứng trước.
 * Vì vậy "chọn thư mục, mở sẵn tại Desktop" được ưu tiên — không cần giải nén,
 * và ảnh nằm ngay trên màn hình chính. Gói ZIP chỉ là phương án hai, kèm hướng
 * dẫn giải nén rõ ràng vì đó là chỗ người dùng hay bị mắc nhất.
 */
export function DesktopSaveGuide({
  fileCount,
  totalBytes,
  canChooseFolder,
  zipExceedsLimit,
  onPickFolder,
  onUseZip,
  onUseIndividual,
}: DesktopSaveGuideProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-warm/80 p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <Monitor className="size-4 text-rose-text" aria-hidden />
          Lưu {formatCount(fileCount)} ảnh gốc về máy tính
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
          Khoảng {formatBytes(totalBytes)}. Ảnh được lấy nguyên byte — không nén lại, không đổi EXIF.
        </p>
      </div>

      {canChooseFolder ? (
        <div className="space-y-2 rounded-2xl border border-rose/35 bg-blush/40 p-3.5">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <FolderDown className="size-4 text-rose-text" aria-hidden />
            Cách 1 — Lưu thẳng, không cần giải nén
          </p>
          <ol className="space-y-1 pl-1 text-[12px] leading-relaxed text-ink-soft">
            <li>
              <strong className="text-ink">1.</strong> Bấm nút bên dưới — hộp thoại chọn thư mục mở
              sẵn tại <strong className="text-ink">Desktop (màn hình chính)</strong>.
            </li>
            <li>
              <strong className="text-ink">2.</strong> Chọn Desktop (hoặc bấm “Thư mục mới” để tạo
              một thư mục riêng cho album), rồi xác nhận.
            </li>
            <li>
              <strong className="text-ink">3.</strong> Ảnh gốc được ghi thẳng xuống đó theo từng
              luồng. Tên trùng sẽ thành “tên (2).ext”, không ghi đè tệp cũ.
            </li>
          </ol>
          <p className="text-[11.5px] leading-relaxed text-ink-soft">
            Cách này nhanh nhất và không giới hạn dung lượng vì ảnh không bao giờ nằm trọn trong
            bộ nhớ trình duyệt.
          </p>
          <Button onClick={onPickFolder} icon={<FolderDown className="size-4" aria-hidden />} className="w-full">
            Chọn thư mục và lưu (mở sẵn tại Desktop)
          </Button>
        </div>
      ) : null}

      <div className="space-y-2 rounded-2xl border border-line bg-warm/70 p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <Archive className="size-4 text-rose-text" aria-hidden />
          {canChooseFolder ? "Cách 2 — " : ""}Tải gói ZIP rồi giải nén
        </p>
        <ol className="space-y-1 pl-1 text-[12px] leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">1.</strong> Gói ZIP được lưu vào thư mục{" "}
            <strong className="text-ink">Tải về / Downloads</strong>.
          </li>
          <li>
            <strong className="text-ink">2.</strong> Mở thư mục đó và giải nén gói ZIP:
            <span className="mt-0.5 block">
              • <strong className="text-ink">Windows:</strong> bấm chuột phải vào tệp ZIP →{" "}
              <em>Extract All…</em> → chọn <strong className="text-ink">Desktop</strong>.
            </span>
            <span className="block">
              • <strong className="text-ink">macOS:</strong> bấm đúp vào tệp ZIP; thư mục giải nén
              nằm ngay cạnh tệp — kéo ra <strong className="text-ink">Desktop</strong>.
            </span>
          </li>
          <li>
            <strong className="text-ink">3.</strong> Trong thư mục vừa giải nén có một thư mục mang
            tên album chứa toàn bộ ảnh gốc.
          </li>
        </ol>
        <p className="text-[11.5px] leading-relaxed text-ink-soft">
          Giải nén ra Desktop giúp tìm lại ảnh nhanh nhất — ảnh nằm ngay trên màn hình chính thay vì
          lẫn trong thư mục Tải về.
        </p>
        {zipExceedsLimit ? (
          <p className="flex gap-2 rounded-2xl border border-warning/40 bg-beige/60 px-3 py-2.5 text-[12px] leading-relaxed">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Lượt này vượt giới hạn tạo ZIP phía trình duyệt. Hãy chia nhỏ, hoặc dùng cách 1 / tải
            từng ảnh.
          </p>
        ) : (
          <Button
            variant="secondary"
            onClick={onUseZip}
            icon={<PackageOpen className="size-4" aria-hidden />}
            className="w-full"
          >
            Tải gói ZIP
          </Button>
        )}
      </div>

      <button
        type="button"
        onClick={onUseIndividual}
        className="w-full rounded-2xl px-3.5 py-2.5 text-left text-[12px] leading-relaxed text-ink-soft transition-colors hover:bg-blush/60 hover:text-ink"
      >
        Hoặc tải từng ảnh một — phù hợp khi chỉ cần vài ảnh.
      </button>
    </div>
  );
}
