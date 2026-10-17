import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Lock, ShieldCheck, Smartphone } from "lucide-react";
import type { Paged, Photo, ShareAccess } from "@/types";
import { shareService } from "@/services/shareService";
import { describeError, isUnreachableError, ShareAccessError } from "@/services/errors";
import { sourceFromResponse } from "@/services/originalSource";
import { toastError } from "@/components/ui/Toast";
import { isArchiveMode } from "@/services/backend";
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
  // Lượt ký theo lô ĐANG chạy: thẻ ảnh chờ chung một promise thay vì mỗi thẻ
  // xin một lượt riêng — 351 lượt riêng sẽ vượt rate limit 60 lời gọi/phút của
  // Edge Function khiến ảnh "treo" giữa chừng.
  const sharedUrlPending = useRef(new Map<string, Promise<string | null>>());
  // URL ảnh gốc đã ký sẵn cho phiên tải xuống (signed URL có hạn 1 giờ).
  const originalUrlCache = useRef(new Map<string, string>());
  // Trang ảnh đầu tiên được xin SONG SONG với bước kiểm tra liên kết: khi quyền
  // được xác nhận, dữ liệu đã sẵn sàng — lưới chỉ còn chờ vẽ.
  const firstPageRef = useRef<Promise<Paged<Photo> | null> | null>(null);
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
    sharedUrlPending.current.clear();
    originalUrlCache.current.clear();
    // Xin trang ảnh đầu NGAY (mật khẩu bỏ trống): liên kết công khai thường
    // không có mật khẩu nên hai lời gọi chạy song song; nếu liên kết có mật
    // khẩu, lời gọi này thất bại vô hại và fetchPage sẽ tự xin lại khi mở khoá.
    firstPageRef.current = shareService
      .listPhotos(shareToken, null, { cursor: null, limit: 400 })
      .catch(() => null);
    void resolveAccess(null);
  }, [resolveAccess, shareToken]);

  useEffect(
    () => () => {
      // Thu hồi mọi object URL cục bộ khi rời trang chia sẻ.
      for (const url of sharedUrlCache.current.values()) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      sharedUrlCache.current.clear();
      sharedUrlPending.current.clear();
      originalUrlCache.current.clear();
    },
    [],
  );

  /**
   * Ký URL hiển thị cho cả TRANG ảnh theo lô — không chờ từng thẻ xin.
   *
   * Kho lưu trữ riêng tư ký mỗi ảnh một lượt; nếu để 351 thẻ cùng xin một lúc
   * thì vượt rate limit 60 lời gọi/phút của Edge Function và phần lớn ảnh bị
   * 429, lưới đứng lại giữa chừng. Kho (archive) ký từng ảnh ở phía Worker nên
   * giữ lô 1 để vẫn chạy song song như trước.
   */
  const prefetchSharedThumbnails = useCallback(
    (photos: Photo[]) => {
      const cache = sharedUrlCache.current;
      const pending = sharedUrlPending.current;
      const chunkSize = isArchiveMode() ? 1 : 100;
      const missing = photos.filter(
        (photo) => !cache.has(`thumbnail:${photo.id}`) && !pending.has(`thumbnail:${photo.id}`),
      );
      for (let index = 0; index < missing.length; index += chunkSize) {
        const chunk = missing.slice(index, index + chunkSize);
        const batch = shareService
          .resolveUrls(shareToken, password || null, chunk, "thumbnail")
          .catch(() => ({}) as Record<string, string>);
        for (const photo of chunk) {
          const key = `thumbnail:${photo.id}`;
          pending.set(key, batch.then((urls) => urls[photo.id] ?? null));
        }
        void batch.then((urls) => {
          for (const photo of chunk) {
            const key = `thumbnail:${photo.id}`;
            const url = urls[photo.id];
            pending.delete(key);
            if (url) cache.set(key, url);
          }
        });
      }
    },
    [password, shareToken],
  );

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      let page: Paged<Photo>;
      if (cursor === null && firstPageRef.current) {
        // Trang đầu đã được xin song song với bước kiểm tra liên kết.
        const preloaded = await firstPageRef.current;
        firstPageRef.current = null;
        page =
          preloaded ??
          (await shareService.listPhotos(shareToken, password || null, {
            cursor: null,
            limit: 400,
          }));
      } else {
        page = await shareService.listPhotos(shareToken, password || null, {
          cursor,
          limit: 400,
        });
      }
      // Ký URL theo lô NGAY khi có metadata; các thẻ ảnh chờ qua sharedUrlPending.
      prefetchSharedThumbnails(page.items);
      return { items: page.items, nextCursor: page.nextCursor, total: page.total };
    },
    [password, prefetchSharedThumbnails, shareToken],
  );

  const feed = usePhotoFeed({
    albumId: access?.album.id ?? "",
    sort: "uploaded-desc",
    enabled: Boolean(access),
    fetchPage: access ? fetchPage : undefined,
  });

  /**
   * Tải TOÀN BỘ danh sách ảnh ngay khi vào trang: cứ hết trang này sang trang
   * khác cho tới khi hết — không cần người dùng kéo xuống tận đáy mới thấy đủ
   * ảnh. Nhờ vậy lưới luôn có đủ dữ liệu và nút "Tải tất cả" không thiếu tệp.
   */
  useEffect(() => {
    if (!access || !feed.hasMore || feed.loading || feed.loadingMore) return;
    feed.loadMore();
  }, [access, feed.hasMore, feed.loading, feed.loadingMore, feed.loadMore]);

  const selection = useSelection(feed.photos);
  const canDownload = access?.share.allowDownload ?? false;

  const downloadFlow = useDownloadFlow({
    title: access?.album.title ?? "cloude-album",
    sourceFor: async (photo) => {
      // Ưu tiên URL ảnh gốc đã ký trước theo lô: không tốn thêm một lời gọi
      // Edge Function cho từng tệp (rate limit 60 lời gọi/phút).
      const cached = originalUrlCache.current.get(photo.id);
      if (cached) {
        try {
          const response = await fetch(cached);
          if (response.ok) return await sourceFromResponse(response, photo.fileSize);
        } catch {
          // URL hết hạn hoặc mạng lỗi: rơi xuống cách ký lại từng ảnh bên dưới.
        }
      }
      return shareService.getOriginalSource(shareToken, password || null, photo);
    },
  });

  const [gathering, setGathering] = useState(false);

  /**
   * Ký trước URL ảnh GỐC theo lô (100 ảnh/lời gọi) cho phiên tải xuống.
   * Không ký trước thì mỗi tệp lại gọi Edge Function riêng và 351 tệp sẽ vượt
   * rate limit 60 lời gọi/phút — phần lớn tệp lỗi giữa chừng.
   */
  const warmOriginalUrls = useCallback(
    async (photos: Photo[]) => {
      const cache = originalUrlCache.current;
      const missing = photos.filter((photo) => !cache.has(photo.id));
      for (let index = 0; index < missing.length; index += 100) {
        const chunk = missing.slice(index, index + 100);
        try {
          const urls = await shareService.resolveUrls(
            shareToken,
            password || null,
            chunk,
            "original",
          );
          for (const [photoId, url] of Object.entries(urls)) cache.set(photoId, url);
        } catch {
          // Ký trước lỗi không được chặn luồng tải: từng ảnh sẽ ký lại khi cần.
        }
      }
    },
    [password, shareToken],
  );

  /**
   * Bấm "Tải tất cả ảnh": gom ĐẦY ĐỦ danh sách (kể cả phần trang chưa tải về
   * trang), ký trước URL ảnh gốc, rồi mở hộp thoại — không phụ thuộc việc người
   * dùng có kéo tới cuối lưới hay không.
   */
  const handleDownloadAll = useCallback(async () => {
    setGathering(true);
    try {
      const byId = new Map<string, Photo>();
      for (const photo of feed.photos) byId.set(photo.id, photo);
      // Con trỏ trỏ tới phần CHƯA tải: tải tiếp cho tới khi hết.
      let cursor = feed.nextCursor;
      while (cursor) {
        const page = await shareService.listPhotos(shareToken, password || null, {
          cursor,
          limit: 400,
        });
        for (const photo of page.items) byId.set(photo.id, photo);
        cursor = page.nextCursor;
      }
      const photos = [...byId.values()];
      await warmOriginalUrls(photos);
      downloadFlow.start(photos);
    } catch (caught) {
      toastError(caught);
    } finally {
      setGathering(false);
    }
  }, [downloadFlow, feed.nextCursor, feed.photos, password, shareToken, warmOriginalUrls]);

  /** Tải nhóm ảnh đang chọn (thanh công cụ chọn ảnh) — cũng ký trước theo lô. */
  const handleDownloadSelection = useCallback(async () => {
    await warmOriginalUrls(selection.selectedPhotos);
    downloadFlow.start(selection.selectedPhotos);
  }, [downloadFlow, selection, warmOriginalUrls]);

  const handleSelectionFolder = useCallback(async () => {
    await warmOriginalUrls(selection.selectedPhotos);
    await downloadFlow.pickFolderFor(selection.selectedPhotos);
  }, [downloadFlow, selection, warmOriginalUrls]);

  /** Lấy URL hiển thị có chữ ký cho ảnh của khách (có cache trong phiên). */
  const sharedResolver: SrcResolver = useCallback(
    async (photo, purpose) => {
      const key = `${purpose}:${photo.id}`;
      const cached = sharedUrlCache.current.get(key);
      if (cached) return { url: cached, release: () => undefined };
      // Đang có lượt ký theo lô cho ảnh này: chờ chung, đừng xin thêm lượt riêng.
      const pending = sharedUrlPending.current.get(key);
      if (pending) {
        const url = await pending;
        if (url) return { url, release: () => undefined };
      }
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
        <Link to="/" className="mx-auto mb-6" aria-label="Cloudey">
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
            Về trang chủ Cloudey
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
                onClick={() => void handleDownloadAll()}
                loading={gathering}
                disabled={feed.photos.length === 0 || gathering}
              >
                Tải tất cả ảnh
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
          onDownload={() => void handleDownloadSelection()}
          onChooseFolder={() => void handleSelectionFolder()}
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
        Ảnh được tải ở chất lượng gốc — Cloudey không nén lại hay thay đổi dữ liệu ảnh.{" "}
        <Link to="/signup" className="text-rose-text underline underline-offset-2">
          Tạo thư viện riêng của bạn
        </Link>
      </p>
    </div>
  );
}
