import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Lock, ShieldCheck, Smartphone } from "lucide-react";
import type { Photo, ShareAccess } from "@/types";
import { shareService } from "@/services/shareService";
import { describeError, isUnreachableError, ShareAccessError } from "@/services/errors";
import { useSelection } from "@/hooks/useSelection";
import { useDownloadFlow } from "@/hooks/useDownloadFlow";
import { PhotoGrid } from "@/components/photos/PhotoGrid";
import { PhotoViewer } from "@/components/photos/PhotoViewer";
import { PhotoSelectionToolbar } from "@/components/photos/PhotoSelectionToolbar";
import { DownloadDialog } from "@/components/downloads/DownloadDialog";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Wordmark } from "@/components/layout/Wordmark";
import { formatBytes, formatDate, photoCountLabel } from "@/lib/format";
import { detectCapabilities } from "@/lib/capabilities";
import { usePhotoFeed } from "@/hooks/usePhotoFeed";
import { useNoIndex } from "@/hooks/useNoIndex";
import type { SrcResolver } from "@/hooks/useMediaSrc";

/**
 * Trang album được chia sẻ.
 *
 * Toàn bộ việc kiểm tra quyền do backend quyết định: trang chỉ hiển thị những gì
 * backend trả về. Nếu token sai, hết hạn hoặc đã thu hồi, không có dữ liệu nào
 * của album được gửi xuống trình duyệt.
 */
export function SharedAlbumPage() {
  // Token trong URL là quyền truy cập album, nên trang này KHÔNG BAO GIỜ được
  // đánh chỉ mục. Đặt trước mọi nhánh trả sớm để hiệu lực ngay cả khi liên kết
  // sai, hết hạn hoặc bị thu hồi.
  useNoIndex();

  const { shareToken = "" } = useParams();
  const [access, setAccess] = useState<ShareAccess | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Bộ nhớ đệm signed URL cho khách: cùng ảnh không bị ký lại nhiều lần.
  const sharedUrlCache = useRef(new Map<string, string>());
  const capabilities = useMemo(() => detectCapabilities(), []);

  const resolveAccess = useCallback(
    async (candidatePassword: string | null) => {
      setLoading(true);
      setError(null);
      setPasswordError(null);
      try {
        const result = await shareService.resolveAccess(shareToken, candidatePassword);
        setAccess(result);
        setNeedsPassword(false);
        return true;
      } catch (caught) {
        if (caught instanceof ShareAccessError) {
          if (caught.reason === "password-required" || caught.reason === "password-wrong") {
            setNeedsPassword(true);
            if (caught.reason === "password-wrong") setPasswordError(caught.message);
            return false;
          }
        }
        // Khách không cấu hình gì cả — họ không có "địa chỉ Worker" để kiểm tra.
        // Nói theo góc nhìn của họ: album không mở được, thử lại hoặc xin liên kết mới.
        setError(
          isUnreachableError(caught)
            ? "Không liên lạc được với kho ảnh đang phục vụ album này. Có thể máy chủ tạm thời không phản hồi, hoặc liên kết đã hết hiệu lực. Hãy thử lại, hoặc xin chủ album gửi liên kết mới."
            : describeError(caught),
        );
        return false;
      } finally {
        setLoading(false);
      }
    },
    [shareToken],
  );

  useEffect(() => {
    sharedUrlCache.current.clear();
    void resolveAccess(null);
  }, [resolveAccess]);

  useEffect(
    () => () => {
      // Thu hồi mọi object URL cục bộ khi rời trang chia sẻ.
      for (const url of sharedUrlCache.current.values()) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      sharedUrlCache.current.clear();
    },
    [],
  );

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const page = await shareService.listPhotos(shareToken, password || null, {
        cursor,
        limit: 60,
      });
      return { items: page.items, nextCursor: page.nextCursor, total: page.total };
    },
    [password, shareToken],
  );

  const feed = usePhotoFeed({
    albumId: access?.album.id ?? "",
    sort: "uploaded-desc",
    enabled: Boolean(access),
    fetchPage: access ? fetchPage : undefined,
  });

  const selection = useSelection(feed.photos);
  const canDownload = access?.share.allowDownload ?? false;

  const downloadFlow = useDownloadFlow({
    title: access?.album.title ?? "cloude-album",
    sourceFor: (photo) => shareService.getOriginalSource(shareToken, password || null, photo),
  });

  /** Lấy URL hiển thị có chữ ký cho ảnh của khách (có cache trong phiên). */
  const sharedResolver: SrcResolver = useCallback(
    async (photo, purpose) => {
      const key = `${purpose}:${photo.id}`;
      const cached = sharedUrlCache.current.get(key);
      if (cached) return { url: cached, release: () => undefined };
      const urls = await shareService.resolveUrls(
        shareToken,
        password || null,
        [photo],
        purpose,
      );
      const url = urls[photo.id];
      if (!url) throw new Error("no-preview");
      sharedUrlCache.current.set(key, url);
      return { url, release: () => undefined };
    },
    [password, shareToken],
  );

  const viewerUrlResolver = useCallback(
    async (photo: Photo) => {
      const urls = await shareService.resolveUrls(shareToken, password || null, [photo], "original");
      const url = urls[photo.id];
      if (!url) throw new Error("Ảnh này không xem trước được trong trình duyệt.");
      return url;
    },
    [password, shareToken],
  );

  if (loading && !access && !needsPassword) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <span className="mx-auto mb-4 grid size-10 place-items-center rounded-full border-2 border-pastel border-t-rose" />
        <p className="text-[13.5px] text-ink-soft">Đang kiểm tra liên kết chia sẻ…</p>
      </div>
    );
  }

  if (needsPassword && !access) {
    return (
      <div className="mx-auto flex max-w-md flex-col justify-center py-8 sm:py-16">
        <Link to="/" className="mx-auto mb-6" aria-label="Cloudé">
          <Wordmark />
        </Link>
        <form
          className="space-y-4 rounded-3xl border border-line bg-warm/90 px-5 py-7 shadow-soft"
          onSubmit={(event) => {
            event.preventDefault();
            void resolveAccess(password);
          }}
        >
          <div className="grid size-11 place-items-center rounded-full bg-pastel/80 text-rose-text">
            <Lock className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl leading-tight">Album được bảo vệ</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
              Chủ album đã đặt mật khẩu cho liên kết này. Hãy nhập mật khẩu họ đã gửi cho bạn.
            </p>
          </div>
          <TextField
            label="Mật khẩu album"
            type="password"
            autoComplete="off"
            required
            data-autofocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={passwordError}
            hint="Mật khẩu được xác minh ở phía máy chủ, không nằm trong trang web này."
          />
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Mở album
          </Button>
          {error ? (
            <p role="alert" className="text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    );
  }

  if (error || !access) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <ErrorState
          title="Không mở được liên kết này"
          description={
            error ??
            "Liên kết có thể đã hết hạn, đã bị thu hồi, hoặc không tồn tại. Hãy liên hệ chủ album để xin liên kết mới."
          }
        />
        <div className="mt-5 text-center">
          <Link to="/" className="text-[13px] font-medium text-rose-text underline underline-offset-2">
            Về trang chủ Cloudé
          </Link>
        </div>
      </div>
    );
  }

  const album = access.album;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-3 rounded-3xl border border-line bg-warm/80 px-5 py-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] uppercase tracking-wider text-ink-soft">
              Album được chia sẻ bởi {album.ownerLabel}
            </p>
            <h1 className="mt-1 font-display text-[26px] leading-tight sm:text-3xl">{album.title}</h1>
            <p className="mt-1 text-[13px] text-ink-soft">
              {photoCountLabel(album.photoCount)} · {formatBytes(album.totalBytes)} · Tạo{" "}
              {formatDate(album.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canDownload ? (
              <Button
                onClick={() => downloadFlow.start(feed.photos)}
                disabled={feed.photos.length === 0}
              >
                Tải ảnh đang xem
              </Button>
            ) : (
              <span className="rounded-full bg-beige/70 px-3.5 py-2 text-[12.5px] text-ink-soft">
                Chủ album chỉ cho xem, không cho tải
              </span>
            )}
          </div>
        </div>

        {album.description ? (
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-ink-soft">{album.description}</p>
        ) : null}

        <p className="flex items-start gap-2 rounded-2xl bg-blush/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-soft">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-rose-text" aria-hidden />
          Bạn chỉ có quyền xem{canDownload ? " và tải ảnh gốc" : ""}. Bạn không thể tải lên, sửa,
          đổi tên hay xoá ảnh — quyền này được máy chủ kiểm tra, không phải chỉ ẩn trên giao diện.
        </p>

        {capabilities.ios && canDownload ? (
          <p className="flex items-start gap-2 rounded-2xl bg-beige/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink">
            <Smartphone className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            Để lưu ảnh vào Thư viện ảnh trên iPhone: tải ảnh về (vào ứng dụng Tệp) rồi mở tệp và
            chọn <em>Lưu vào Ảnh</em>. Trình duyệt không thể tự ghi vào Thư viện ảnh — hãy xem hướng
            dẫn chi tiết trong hộp thoại tải xuống.
          </p>
        ) : null}
      </header>

      {feed.error ? (
        <ErrorState description={feed.error} onRetry={() => void feed.refresh()} />
      ) : feed.photos.length === 0 && !feed.loading ? (
        <EmptyState
          title="Album này chưa có ảnh"
          description="Chủ album chưa tải ảnh nào lên. Hãy quay lại sau nhé."
        />
      ) : (
        <PhotoGrid
          photos={feed.photos}
          loading={feed.loading}
          loadingMore={feed.loadingMore}
          hasMore={feed.hasMore}
          onLoadMore={feed.loadMore}
          selectedIds={selection.selectedIds}
          onToggle={selection.toggle}
          onOpen={(_, index) => setViewerIndex(index)}
          resolver={sharedResolver}
        />
      )}

      {canDownload ? (
        <PhotoSelectionToolbar
          count={selection.count}
          totalBytes={selection.totalBytes}
          isAllSelected={selection.isAllSelected}
          onSelectAll={selection.selectAll}
          onDeselectAll={selection.deselectAll}
          onDownload={() => downloadFlow.start(selection.selectedPhotos)}
          onChooseFolder={() => void downloadFlow.pickFolderFor(selection.selectedPhotos)}
          canChooseFolder={downloadFlow.canChooseFolder}
        />
      ) : null}

      <PhotoViewer
        photos={feed.photos}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onIndexChange={setViewerIndex}
        resolveViewerUrl={viewerUrlResolver}
        onDownload={(photo) => void downloadFlow.downloadSingle(photo)}
        readOnly={!canDownload}
      />

      <DownloadDialog
        open={downloadFlow.open}
        onClose={downloadFlow.close}
        photos={downloadFlow.photos}
        title={album.title}
        job={downloadFlow.job}
        sourceFor={downloadFlow.sourceFor}
        onPickFolder={() => void downloadFlow.pickFolder()}
        onRun={(strategy) => void downloadFlow.run(strategy)}
        readOnlyNote={
          access.share.hasPassword
            ? "Liên kết này được bảo vệ bằng mật khẩu. Bạn có thể tải ảnh gốc nhưng không thể sửa nội dung album."
            : undefined
        }
      />

      <p className="pb-6 text-center text-[11.5px] text-ink-soft">
        Ảnh được tải ở chất lượng gốc — Cloudé không nén lại hay thay đổi dữ liệu ảnh.{" "}
        <Link to="/signup" className="text-rose-text underline underline-offset-2">
          Tạo thư viện riêng của bạn
        </Link>
      </p>
    </div>
  );
}
