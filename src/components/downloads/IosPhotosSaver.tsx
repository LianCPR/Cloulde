import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FolderOpen, ImageDown, Loader2, Smartphone, TriangleAlert } from "lucide-react";
import type { Photo } from "@/types";
import type { OriginalSource } from "@/services/originalSource";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatCount } from "@/lib/format";
import { planPhotoBatches } from "@/lib/photoBatches";
import {
  canShareFiles,
  prepareShareBatch,
  shareFilesToDevice,
  type PreparedShareBatch,
} from "@/services/downloadService";
import { describeError } from "@/services/errors";
import { announce } from "@/components/ui/LiveRegion";

export interface IosPhotosSaverProps {
  photos: Photo[];
  title: string;
  sourceFor: (photo: Photo) => Promise<OriginalSource>;
  /** Chuyển sang các cách lưu khác (từng ảnh, gói ZIP) khi share sheet không dùng được. */
  onUseOtherOptions: () => void;
  /** Xoá lựa chọn đã lưu để lần sau hỏi lại từ đầu. */
  onForgetConsent: () => void;
}

/**
 * Lưu ảnh vào Thư viện ảnh trên iOS theo TỪNG ĐỢT.
 *
 * Vì sao phải bấm từng đợt thay vì một nút "lưu tất cả" tự chạy:
 * Safari yêu cầu "transient user activation" cho `navigator.share`. Sau một lần
 * `await` dài (đang tải ảnh từ mạng), quyền kích hoạt đó hết hiệu lực và lệnh
 * share tiếp theo sẽ bị từ chối. Một vòng lặp tự động vì thế hỏng ngay ở đợt
 * thứ hai. Mỗi đợt một lần bấm là cách duy nhất chạy được ổn định.
 *
 * Bù lại, đợt hiện tại được TẢI TRƯỚC khi người dùng bấm, nên lúc bấm thì tệp
 * đã nằm sẵn trong bộ nhớ: share sheet mở ra gần như tức thì, không kịp mất
 * quyền kích hoạt.
 */
export function IosPhotosSaver({
  photos,
  title,
  sourceFor,
  onUseOtherOptions,
  onForgetConsent,
}: IosPhotosSaverProps) {
  const batches = useMemo(() => planPhotoBatches(photos), [photos]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [prepared, setPrepared] = useState<PreparedShareBatch | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  const sourceForRef = useRef(sourceFor);
  sourceForRef.current = sourceFor;

  const batch = batches[batchIndex];
  const sentPhotos = batches
    .slice(0, batchIndex)
    .reduce((sum, item) => sum + item.photos.length, 0);
  const finished = batchIndex >= batches.length && batches.length > 0;

  // Tải trước đợt hiện tại. Chỉ một đợt nằm trong RAM tại mỗi thời điểm.
  useEffect(() => {
    if (!batch) return;
    let cancelled = false;
    const controller = new AbortController();
    setPrepared(null);
    setPreparing(true);
    setError(null);
    prepareShareBatch(batch.photos, (photo) => sourceForRef.current(photo), controller.signal)
      .then((result) => {
        if (!cancelled) setPrepared(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(describeError(caught));
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [batch]);

  const shareCurrentBatch = useCallback(async () => {
    if (!prepared || !batch) return;
    setError(null);
    setStopped(false);
    try {
      const outcome = await shareFilesToDevice(prepared.files, title || "Ảnh gốc");
      if (outcome === "dismissed") {
        // Người dùng tự đóng share sheet — không phải lỗi, chỉ là dừng lại.
        setStopped(true);
        announce("Đã dừng chia sẻ.");
        return;
      }
      const nextSent = sentPhotos + prepared.files.length;
      setBatchIndex((index) => index + 1);
      announce(`Đã gửi ${nextSent}/${photos.length} ảnh qua share sheet.`);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [batch, photos.length, prepared, sentPhotos, title]);

  const shareable = prepared ? canShareFiles(prepared.files, title || "Ảnh gốc") : true;

  if (finished) {
    return (
      <div className="space-y-3">
        <p className="flex gap-2 rounded-2xl border border-success/35 bg-success/10 px-3.5 py-3 text-[12.5px] leading-relaxed">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>
            Đã gửi toàn bộ {formatCount(photos.length)} ảnh qua share sheet
            {batches.length > 1 ? ` trong ${batches.length} đợt` : ""}. Nếu bảng chia sẻ chưa lưu
            hết, mở ứng dụng <strong>Tệp</strong> rồi chọn ảnh và bấm <em>Lưu vào Ảnh</em>.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<FolderOpen className="size-4" aria-hidden />} onClick={onUseOtherOptions}>
            Cách lưu khác
          </Button>
          <Button variant="ghost" size="sm" onClick={onForgetConsent}>
            Hỏi lại lựa chọn này lần sau
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex gap-2 rounded-2xl bg-blush/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-rose-text" aria-hidden />
        <span>
          Ảnh sẽ được đưa qua <strong>bảng chia sẻ của iOS</strong>. Ở bảng đó, chọn{" "}
          <em>Lưu vào Ảnh</em> (Save Image) để đưa ảnh gốc vào Thư viện ảnh. Nếu không thấy mục
          này, chọn <em>Lưu vào Tệp</em> rồi tự lưu sau.
        </span>
      </p>

      <div className="rounded-2xl border border-line bg-warm/80 p-3.5">
        <p className="text-[12.5px] font-medium text-ink">
          Đợt {batchIndex + 1}/{batches.length}
          {batch ? ` · ${formatCount(batch.photos.length)} ảnh · ${formatBytes(batch.bytes)}` : ""}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          Đã gửi {formatCount(sentPhotos)}/{formatCount(photos.length)} ảnh.
          {batches.length > 1
            ? " iPhone giới hạn mỗi lần chia sẻ một lượng nhỏ tệp, nên cần bấm lần lượt từng đợt."
            : ""}
        </p>
      </div>

      {error ? (
        <p className="flex gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {stopped ? (
        <p className="rounded-2xl bg-blush/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
          Bạn đã đóng bảng chia sẻ. Ảnh của đợt này chưa được gửi — bấm bên dưới để thử lại.
        </p>
      ) : null}

      {prepared && !shareable ? (
        <p className="flex gap-2 rounded-2xl border border-warning/40 bg-beige/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          Thiết bị này không hỗ trợ chia sẻ đúng tập tệp như vậy. Hãy dùng “Tải từng ảnh một” hoặc
          gói ZIP.
        </p>
      ) : null}

      <Button
        onClick={shareCurrentBatch}
        disabled={!prepared || preparing || !shareable}
        loading={preparing}
        icon={<ImageDown className="size-4" aria-hidden />}
        className="w-full"
      >
        {preparing
          ? `Đang chuẩn bị đợt ${batchIndex + 1}/${batches.length}…`
          : stopped
            ? `Thử lại đợt ${batchIndex + 1}/${batches.length}`
            : `Lưu đợt ${batchIndex + 1}/${batches.length} vào Thư viện ảnh`}
      </Button>

      {preparing ? (
        <p className="flex items-center gap-2 text-[11.5px] text-ink-soft">
          <Loader2 className="size-3.5 animate-spin-slow" aria-hidden />
          Đang tải ảnh gốc về máy để bấm là gửi được ngay.
        </p>
      ) : null}
    </div>
  );
}
