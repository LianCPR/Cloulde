import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  FolderDown,
  ImageDown,
  Info,
  Layers,
  Share2,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import type { DownloadStrategy, Photo } from "@/types";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { DownloadProgressView } from "./DownloadProgress";
import { DesktopSaveGuide } from "./DesktopSaveGuide";
import { IosPhotosSaver } from "./IosPhotosSaver";
import { estimateArchive } from "@/services/downloadService";
import {
  detectCapabilities,
  readDownloadPreferences,
  writeDownloadPreferences,
  type DeviceCapabilities,
  type DownloadPreferences,
} from "@/lib/capabilities";
import type { OriginalSource } from "@/services/originalSource";
import { formatBytes, formatCount } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DownloadJobState } from "@/hooks/useDownloadJob";

export interface DownloadDialogProps {
  open: boolean;
  onClose: () => void;
  photos: Photo[];
  title: string;
  job: DownloadJobState;
  /** Lấy nguồn byte gốc — cần cho luồng lưu vào Thư viện ảnh trên iOS. */
  sourceFor: (photo: Photo) => Promise<OriginalSource>;
  /** Chọn thư mục đích rồi chạy chiến lược `folder`. */
  onPickFolder: () => void;
  /** Chạy với chiến lược ZIP / từng tệp / share sheet. */
  onRun: (strategy: DownloadStrategy) => void;
  /** Nội dung nhắc thêm cho khách xem liên kết chia sẻ. */
  readOnlyNote?: string;
}

/**
 * Bước đang hiển thị trong hộp thoại.
 * - `desktop-guide`  — máy tính: hướng dẫn lưu trước khi tải (ưu tiên Desktop).
 * - `photos-consent` — iOS: hỏi trước có muốn lưu vào Thư viện ảnh không.
 * - `photos-saver`   — iOS: từng đợt qua share sheet.
 * - `options`        — danh sách chiến lược như cũ.
 */
type Step = "desktop-guide" | "photos-consent" | "photos-saver" | "options";

function initialStep(capabilities: DeviceCapabilities, preferences: DownloadPreferences): Step {
  if (capabilities.ios && capabilities.shareFiles) {
    if (preferences.saveToPhotosLibrary === null) return "photos-consent";
    if (preferences.saveToPhotosLibrary) return "photos-saver";
    return "options";
  }
  if (capabilities.desktop) return "desktop-guide";
  return "options";
}

/**
 * Hộp thoại tải xuống.
 *
 * Đây là nơi minh bạch nhất về giới hạn của trình duyệt: nói rõ trình duyệt
 * nào làm được gì, ước lượng số tệp và dung lượng trước khi bắt đầu, và giải
 * thích đường đi trên iPhone để lưu ảnh vào Thư viện ảnh.
 *
 * Thứ tự ưu tiên được chọn theo tiêu chí "ít bước nhất, dễ tìm lại ảnh nhất":
 * trên máy tính là lưu thẳng vào Desktop (không cần giải nén), trên iOS là lưu
 * vào Thư viện ảnh theo từng đợt.
 */
export function DownloadDialog({
  open,
  onClose,
  photos,
  title,
  job,
  sourceFor,
  onPickFolder,
  onRun,
  readOnlyNote,
}: DownloadDialogProps) {
  const capabilities = useMemo(() => detectCapabilities(), []);
  const estimate = useMemo(() => estimateArchive(photos), [photos]);
  const [confirmedLarge, setConfirmedLarge] = useState(false);
  const [preferences, setPreferences] = useState<DownloadPreferences>(() =>
    readDownloadPreferences(),
  );
  const [step, setStep] = useState<Step>(() => initialStep(capabilities, preferences));
  const { progress, summary, isRunning } = job;
  const finished = progress.status === "completed" || progress.status === "failed";

  // Mỗi lần mở lại hộp thoại, bắt đầu lại từ bước đề xuất — nếu không, người
  // dùng sẽ bỏ lỡ màn hình hướng dẫn ở những lần lưu sau.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStep(initialStep(detectCapabilities(), readDownloadPreferences()));
      setConfirmedLarge(false);
    }
    wasOpen.current = open;
  }, [open]);

  const updatePreferences = useCallback(
    (patch: Partial<DownloadPreferences>) => {
      const next = { ...preferences, ...patch };
      setPreferences(next);
      writeDownloadPreferences(next);
    },
    [preferences],
  );

  const needsConfirm =
    estimate.needsWarning && !confirmedLarge && progress.status === "idle" && !isRunning;

  return (
    <Dialog
      open={open}
      onClose={isRunning ? () => undefined : onClose}
      title={photos.length > 1 ? "Tải xuống ảnh gốc" : "Tải ảnh gốc"}
      description={`${formatCount(photos.length)} tệp · khoảng ${formatBytes(estimate.totalBytes)} ảnh gốc`}
      variant="sheet"
      size="md"
      footer={
        isRunning ? (
          <>
            <Button variant="ghost" onClick={job.cancel}>
              Huỷ tải xuống
            </Button>
            <Button variant="secondary" disabled>
              Đang xử lý…
            </Button>
          </>
        ) : finished ? (
          <>
            <Button variant="ghost" onClick={job.reset}>
              Làm lại
            </Button>
            <Button onClick={onClose}>Đóng</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {readOnlyNote ? (
          <p className="flex gap-2 rounded-2xl bg-blush/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink">
            <Info className="mt-0.5 size-4 shrink-0 text-rose-text" aria-hidden />
            {readOnlyNote}
          </p>
        ) : null}

        {progress.status !== "idle" ? (
          <DownloadProgressView progress={progress} />
        ) : needsConfirm ? (
          <div className="space-y-3 rounded-2xl border border-warning/40 bg-beige/60 p-3.5">
            <p className="flex gap-2 text-[12.5px] leading-relaxed text-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              Đây là lượt tải lớn ({estimate.estimateText}). Gói ZIP được ghi ra bộ nhớ tạm của
              trình duyệt và cần thời gian cùng dung lượng trống. Trên máy tính, chọn
              <strong className="mx-1">thư mục đích</strong> sẽ nhanh và an toàn hơn.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setConfirmedLarge(true)}>
              Tôi hiểu, tiếp tục
            </Button>
          </div>
        ) : step === "photos-consent" ? (
          <PhotosConsent
            fileCount={photos.length}
            onAccept={() => {
              updatePreferences({ saveToPhotosLibrary: true });
              setStep("photos-saver");
            }}
            onDecline={() => {
              updatePreferences({ saveToPhotosLibrary: false });
              setStep("options");
            }}
          />
        ) : step === "photos-saver" ? (
          <IosPhotosSaver
            photos={photos}
            title={title}
            sourceFor={sourceFor}
            onUseOtherOptions={() => setStep("options")}
            onForgetConsent={() => {
              updatePreferences({ saveToPhotosLibrary: null });
              setStep("photos-consent");
            }}
          />
        ) : step === "desktop-guide" ? (
          <DesktopSaveGuide
            fileCount={photos.length}
            totalBytes={estimate.totalBytes}
            canChooseFolder={capabilities.fileSystemAccess}
            zipExceedsLimit={estimate.exceedsBrowserLimit}
            onPickFolder={onPickFolder}
            onUseZip={() => onRun("zip")}
            onUseIndividual={() => onRun("individual")}
          />
        ) : (
          <div className="space-y-2">
            {capabilities.fileSystemAccess ? (
              <StrategyOption
                recommended
                icon={<FolderDown className="size-4" aria-hidden />}
                title="Lưu vào thư mục tôi chọn"
                description="Ghi từng ảnh gốc thẳng xuống đĩa theo luồng — nhanh nhất và không giới hạn dung lượng. Hộp thoại mở sẵn tại Desktop. Tên tệp trùng sẽ được đổi thành “tên (2).ext”, không ghi đè."
                onClick={onPickFolder}
              />
            ) : null}

            <StrategyOption
              icon={<Archive className="size-4" aria-hidden />}
              title="Tải về một gói ZIP"
              description={
                estimate.exceedsBrowserLimit
                  ? `Lượt tải này vượt giới hạn tạo ZIP phía trình duyệt. Hãy chia nhỏ hoặc dùng tuỳ chọn tải từng ảnh.`
                  : "Ảnh gốc được gói nguyên byte, không nén lại. Giữ nguyên tên tệp và thư mục theo tên album."
              }
              disabled={estimate.exceedsBrowserLimit}
              onClick={() => onRun("zip")}
            />

            <StrategyOption
              icon={<Layers className="size-4" aria-hidden />}
              title="Tải từng ảnh một"
              description="Trình duyệt sẽ lần lượt tải từng tệp gốc. Phù hợp khi chỉ cần vài ảnh, hoặc khi ZIP quá lớn."
              onClick={() => onRun("individual")}
            />

            {capabilities.shareFiles && photos.length <= 10 ? (
              <StrategyOption
                icon={<Share2 className="size-4" aria-hidden />}
                title="Chia sẻ qua ứng dụng (share sheet)"
                description="Mở bảng chia sẻ của hệ điều hành để lưu ảnh gốc vào ứng dụng bạn muốn, ví dụ Thư viện ảnh."
                onClick={() => onRun("share-sheet")}
              />
            ) : null}
          </div>
        )}

        {capabilities.ios ? (
          <div className="rounded-2xl border border-line bg-warm/80 p-3.5">
            <p className="flex items-center gap-2 text-[13px] font-medium">
              <Smartphone className="size-4 text-rose-text" aria-hidden />
              Trên iPhone / iPad
            </p>
            <ul className="mt-2 space-y-1.5 pl-1 text-[12px] leading-relaxed text-ink-soft">
              <li>
                • <strong className="text-ink">Cả album:</strong> dùng “Lưu đợt … vào Thư viện ảnh”.
                Mỗi đợt mở bảng chia sẻ một lần, bạn chọn <em>Lưu vào Ảnh</em> ở đó.
              </li>
              <li>
                • <strong className="text-ink">Từng ảnh:</strong> chạm “Tải từng ảnh một”, tệp sẽ
                vào ứng dụng <em>Tệp</em> (Tải về). Mở tệp rồi chọn <em>Lưu vào Ảnh</em>.
              </li>
              <li>
                • Trang web <strong className="text-ink">không thể</strong> tự ghi vào Thư viện ảnh:
                iOS chỉ cấp quyền đó cho ứng dụng native, không cấp cho trình duyệt. Vì vậy bước
                chọn <em>Lưu vào Ảnh</em> là bắt buộc — không phải ứng dụng cố tình hỏi thêm.
              </li>
            </ul>
          </div>
        ) : null}

        {capabilities.android ? (
          <p className="rounded-2xl bg-blush/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-soft">
            Trên Android, ảnh tải về nằm trong thư mục <em>Tải về</em> của trình duyệt. Nếu chọn
            nhiều tệp, hãy cho phép “Tải nhiều tệp” khi Chrome hỏi.
          </p>
        ) : null}

        {summary ? (
          <div className="rounded-2xl bg-blush/50 px-3.5 py-3 text-[12.5px] leading-relaxed">
            <p className="font-medium text-ink">
              {summary.status === "completed"
                ? `Đã xử lý ${summary.completed}/${photos.length} ảnh`
                : summary.status === "cancelled"
                  ? "Đã huỷ theo yêu cầu"
                  : `Có lỗi ở ${summary.failed} tệp`}
            </p>
            {summary.totalBytes > 0 ? (
              <p className="mt-0.5 text-ink-soft">
                Tổng dung lượng: {formatBytes(summary.totalBytes)}
              </p>
            ) : null}
            {summary.checksum.checked > 0 ? (
              <p className="mt-1 text-ink-soft">
                Đã kiểm tra SHA-256 cho {summary.checksum.checked} tệp
                {summary.checksum.mismatched > 0
                  ? ` — ${summary.checksum.mismatched} tệp không khớp!`
                  : " — tất cả đều khớp với ảnh gốc đã lưu."}
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="text-[11.5px] leading-relaxed text-ink-soft">
          {title ? `Album: ${title}. ` : ""}
          Mọi ảnh đều được lấy trực tiếp từ kho lưu trữ dưới dạng tệp gốc — không dùng ảnh thu nhỏ,
          không mã hoá lại, không thay đổi EXIF.
        </p>
      </div>
    </Dialog>
  );
}

/**
 * Câu hỏi xin phép lưu vào Thư viện ảnh trên iOS.
 *
 * Cách diễn đạt ở đây được cân nhắc kỹ: đây là lựa chọn của người dùng trong
 * ứng dụng, KHÔNG phải hộp thoại xin quyền của iOS. Trình duyệt không có quyền
 * đó để xin. Nói thẳng như vậy để người dùng biết trước sẽ phải bấm chọn trong
 * bảng chia sẻ, thay vì tưởng ứng dụng lừa mình.
 */
function PhotosConsent({
  fileCount,
  onAccept,
  onDecline,
}: {
  fileCount: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="flex gap-2 rounded-2xl bg-blush/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-rose-text" aria-hidden />
        <span>
          Cho phép lưu thẳng <strong>{formatCount(fileCount)} ảnh</strong> vào Thư viện ảnh?
        </span>
      </p>

      <div className="rounded-2xl border border-line bg-warm/80 p-3.5 text-[12px] leading-relaxed text-ink-soft">
        <p className="font-medium text-ink">Điều cần biết trước</p>
        <ul className="mt-1.5 space-y-1">
          <li>
            • Trang web <strong className="text-ink">không thể</strong> tự ghi vào Thư viện ảnh —
            iOS không cho phép. Không có hộp thoại xin quyền nào để bấm cả.
          </li>
          <li>
            • Nếu đồng ý, ứng dụng sẽ đưa ảnh qua <strong className="text-ink">bảng chia sẻ</strong>{" "}
            theo từng đợt, và bạn chọn <em>Lưu vào Ảnh</em> ở đó.
          </li>
          <li>
            • Số ảnh nhiều thì cần vài lần bấm — mỗi đợt một lần, vì iOS chỉ cho một lần chia sẻ
            trong mỗi thao tác.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={onAccept} icon={<ImageDown className="size-4" aria-hidden />} className="w-full">
          Đồng ý — lưu vào Thư viện ảnh
        </Button>
        <Button variant="secondary" onClick={onDecline} className="w-full">
          Không — dùng cách khác
        </Button>
      </div>
    </div>
  );
}

function StrategyOption({
  icon,
  title,
  description,
  onClick,
  disabled,
  recommended,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all duration-200",
        disabled
          ? "cursor-not-allowed border-line bg-warm/50 opacity-60"
          : "border-line bg-warm hover:-translate-y-0.5 hover:border-rose/45 hover:shadow-soft",
      )}
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-pastel/80 text-rose-text">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[13.5px] font-medium">
          {title}
          {recommended ? (
            <span className="rounded-full bg-pastel px-2 py-0.5 text-[10.5px] font-medium text-rose-text">
              Nên dùng
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-soft">{description}</span>
      </span>
    </button>
  );
}
