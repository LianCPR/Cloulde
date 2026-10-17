import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Pencil,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import type { Album, Photo, PhotoSort } from "@/types";
import { albumService } from "@/services/albumService";
import { photoService } from "@/services/photoService";
import { describeError } from "@/services/errors";
import { useAuth } from "@/context/AuthContext";
import { usePhotoFeed } from "@/hooks/usePhotoFeed";
import { useSelection } from "@/hooks/useSelection";
import { useDownloadFlow } from "@/hooks/useDownloadFlow";
import { PhotoGrid } from "@/components/photos/PhotoGrid";
import { PhotoViewer } from "@/components/photos/PhotoViewer";
import { PhotoSelectionToolbar } from "@/components/photos/PhotoSelectionToolbar";
import { UploadPanel } from "@/components/upload/UploadPanel";
import { DownloadDialog } from "@/components/downloads/DownloadDialog";
import { ShareAlbumDialog } from "@/components/sharing/ShareAlbumDialog";
import { AlbumEditDialog } from "@/components/albums/AlbumDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatBytes, formatDate, photoCountLabel } from "@/lib/format";
import { toastError, toastInfo, toastSuccess } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

/** Trang chi tiết album: tải ảnh lên, chọn, tải xuống, chia sẻ, chỉnh sửa. */
export function AlbumPage() {
  const { albumId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [album, setAlbum] = useState<Album | null>(null);
  const [albumError, setAlbumError] = useState<string | null>(null);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [sort, setSort] = useState<PhotoSort>("uploaded-desc");
  const [showDescription, setShowDescription] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const feed = usePhotoFeed({ albumId, sort, enabled: Boolean(albumId) });
  const selection = useSelection(feed.photos);

  const downloadFlow = useDownloadFlow({
    title: album?.title ?? "cloude-album",
    sourceFor: (photo) => photoService.getOriginalSource(photo),
  });

  const loadAlbum = useCallback(async () => {
    setAlbumLoading(true);
    setAlbumError(null);
    try {
      setAlbum(await albumService.get(albumId));
    } catch (caught) {
      setAlbumError(describeError(caught));
    } finally {
      setAlbumLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    void loadAlbum();
  }, [loadAlbum]);

  // Đổi sắp xếp thì quay lại đầu danh sách và bỏ lựa chọn cũ.
  useEffect(() => {
    selection.deselectAll();
    setViewerIndex(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, albumId]);

  const handlePhotoUploaded = useCallback(
    (photo: Photo) => {
      feed.append([photo]);
      setAlbum((previous) =>
        previous
          ? {
              ...previous,
              photoCount: previous.photoCount + 1,
              totalBytes: previous.totalBytes + photo.fileSize,
              coverPhotoId: previous.coverPhotoId ?? photo.id,
              updatedAt: new Date().toISOString(),
            }
          : previous,
      );
    },
    [feed],
  );

  const deleteSelected = async () => {
    const ids = [...selection.selectedIds];
    if (ids.length === 0) return;
    const bytes = selection.totalBytes;
    try {
      await photoService.remove(ids);
      feed.removeLocal(ids);
      selection.deselectAll();
      setAlbum((previous) =>
        previous
          ? {
              ...previous,
              photoCount: Math.max(0, previous.photoCount - ids.length),
              totalBytes: Math.max(0, previous.totalBytes - bytes),
            }
          : previous,
      );
      toastSuccess(`Đã xoá ${ids.length} ảnh`, "Ảnh gốc và ảnh thu nhỏ đã được xoá khỏi kho lưu trữ.");
    } catch (caught) {
      toastError(caught);
      // Đồng bộ lại với máy chủ nếu thao tác thất bại giữa chừng.
      await feed.refresh();
    }
  };

  const downloadAll = async () => {
    if (!album) return;
    setLoadingAll(true);
    try {
      // Chỉ lấy metadata (không có byte ảnh), nên album vài nghìn ảnh vẫn an toàn.
      const all = await photoService.listAllMetadata(album.id);
      if (all.length === 0) {
        toastInfo("Album này chưa có ảnh nào.");
        return;
      }
      downloadFlow.start(all);
    } catch (caught) {
      toastError(caught);
    } finally {
      setLoadingAll(false);
    }
  };

  const saveAlbum = async (values: {
    title: string;
    description: string | null;
    coverPhotoId: string | null;
  }) => {
    if (!album) return;
    setSaving(true);
    try {
      const updated = await albumService.update(album.id, values);
      setAlbum(updated);
      setEditOpen(false);
      toastSuccess("Đã lưu thay đổi");
    } catch (caught) {
      toastError(caught);
    } finally {
      setSaving(false);
    }
  };

  const deleteAlbum = async () => {
    if (!album) return;
    setDeleting(true);
    try {
      await albumService.remove(album.id);
      toastSuccess("Đã xoá album", `“${album.title}” cùng toàn bộ ảnh bên trong đã bị xoá.`);
      navigate("/");
    } catch (caught) {
      toastError(caught);
    } finally {
      setDeleting(false);
    }
  };

  const viewerUrlResolver = useCallback(
    (photo: Photo) => photoService.getViewerUrl(photo),
    [],
  );

  const stats = useMemo(() => {
    if (!album) return null;
    return [photoCountLabel(album.photoCount), formatBytes(album.totalBytes), `Tạo ${formatDate(album.createdAt)}`];
  }, [album]);

  if (!user) {
    return (
      <EmptyState
        title="Bạn cần đăng nhập"
        description="Album riêng tư chỉ hiển thị cho chủ sở hữu. Hãy đăng nhập để tiếp tục."
        action={
          <Link
            to="/login"
            className="rounded-full bg-pastel px-5 py-2.5 text-sm font-medium text-rose-text"
          >
            Đăng nhập
          </Link>
        }
      />
    );
  }

  if (albumLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56 rounded-full" />
        <Skeleton className="h-4 w-80 rounded-full" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="aspect-square rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (albumError || !album) {
    return (
      <ErrorState
        title="Không mở được album"
        description={albumError ?? "Album không tồn tại hoặc bạn không có quyền xem."}
        onRetry={() => void loadAlbum()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Đường dẫn" className="text-[12.5px] text-ink-soft">
        <Link to="/" className="inline-flex items-center gap-1.5 hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden />
          Thư viện
        </Link>
      </nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[26px] leading-tight sm:text-4xl">{album.title}</h1>
            {stats ? (
              <p className="mt-1 text-[13px] text-ink-soft">{stats.join(" · ")}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setUploadOpen((value) => !value)}
              icon={<Upload className="size-4" aria-hidden />}
            >
              Tải ảnh lên
            </Button>
            <Button
              variant="soft"
              size="sm"
              onClick={() => setShareOpen(true)}
              icon={<Share2 className="size-4" aria-hidden />}
            >
              Chia sẻ
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditOpen(true)}
              icon={<Pencil className="size-4" aria-hidden />}
              aria-label="Chỉnh sửa album"
            >
              <span className="hidden sm:inline">Sửa</span>
            </Button>
            <Button
              size="sm"
              onClick={() => void downloadAll()}
              loading={loadingAll}
              icon={<Download className="size-4" aria-hidden />}
            >
              Tải cả album
            </Button>
          </div>
        </div>

        {album.description ? (
          <div>
            <p
              className={cn(
                "max-w-3xl text-[13.5px] leading-relaxed text-ink-soft",
                !showDescription && "line-clamp-2",
              )}
            >
              {album.description}
            </p>
            {album.description.length > 140 ? (
              <button
                type="button"
                onClick={() => setShowDescription((value) => !value)}
                aria-expanded={showDescription}
                className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-rose-text"
              >
                {showDescription ? "Thu gọn" : "Xem thêm"}
                <motion.span animate={{ rotate: showDescription ? 180 : 0 }}>
                  <ChevronDown className="size-3.5" aria-hidden />
                </motion.span>
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {uploadOpen ? (
        <UploadPanel albumId={album.id} onPhotoUploaded={handlePhotoUploaded} />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="sort-photos">
          Sắp xếp ảnh
        </label>
        <select
          id="sort-photos"
          value={sort}
          onChange={(event) => setSort(event.target.value as PhotoSort)}
          className="h-10 rounded-2xl border border-line bg-warm px-3.5 text-[13px] focus:border-rose/60 focus:outline-none focus:ring-4 focus:ring-pastel/60"
        >
          {Object.entries(photoService.sortLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={selection.selectAll} disabled={feed.photos.length === 0}>
          Chọn tất cả {feed.photos.length > 0 ? `(${feed.photos.length})` : ""}
        </Button>
        {feed.photos.length > 0 ? (
          <p className="text-[12.5px] text-ink-soft">
            Đang hiển thị {feed.photos.length}
            {feed.total ? ` / ${feed.total}` : ""} ảnh
          </p>
        ) : null}
      </div>

      {feed.error ? (
        <ErrorState description={feed.error} onRetry={() => void feed.refresh()} />
      ) : feed.photos.length === 0 && !feed.loading ? (
        <EmptyState
          title="Album này chưa có ảnh"
          description="Kéo thả ảnh vào khu vực tải lên phía trên, hoặc bấm “Tải ảnh lên”. Ảnh gốc sẽ được lưu nguyên byte."
          action={
            <Button
              onClick={() => setUploadOpen(true)}
              icon={<Upload className="size-4" aria-hidden />}
            >
              Tải ảnh lên
            </Button>
          }
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
        />
      )}

      <PhotoSelectionToolbar
        count={selection.count}
        totalBytes={selection.totalBytes}
        isAllSelected={selection.isAllSelected}
        onSelectAll={selection.selectAll}
        onDeselectAll={selection.deselectAll}
        onDownload={() => downloadFlow.start(selection.selectedPhotos)}
        onChooseFolder={() => void downloadFlow.pickFolderFor(selection.selectedPhotos)}
        canChooseFolder={downloadFlow.canChooseFolder}
        onDelete={() => void deleteSelected()}
      />

      <PhotoViewer
        photos={feed.photos}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onIndexChange={setViewerIndex}
        resolveViewerUrl={viewerUrlResolver}
        onDownload={(photo) => void downloadFlow.downloadSingle(photo)}
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
      />

      <ShareAlbumDialog open={shareOpen} onClose={() => setShareOpen(false)} album={album} />

      <AlbumEditDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        album={album}
        photos={feed.photos}
        onSave={saveAlbum}
        onDelete={() => {
          setEditOpen(false);
          setDeleteOpen(true);
        }}
        saving={saving}
        deleting={deleting}
      />

      <Dialog
        open={deleteOpen}
        onClose={deleting ? () => undefined : () => setDeleteOpen(false)}
        title="Xoá album này?"
        description="Thao tác này không thể hoàn tác."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Giữ lại
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={() => void deleteAlbum()}
              icon={<Trash2 className="size-4" aria-hidden />}
            >
              Xoá vĩnh viễn
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-ink-soft">
          Album <strong className="text-ink">“{album.title}”</strong> cùng{" "}
          {photoCountLabel(album.photoCount)} bên trong ({formatBytes(album.totalBytes)}) sẽ bị xoá
          khỏi kho lưu trữ. Chỉ các tệp thuộc album này bị xoá — không ảnh hưởng album khác.
        </p>
        <p className="mt-3 rounded-2xl bg-beige/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
          Nếu bạn chưa có bản sao nào ở nơi khác, hãy tải album về trước khi xoá. Cloudé không tự
          động sao lưu ảnh gốc.
        </p>
      </Dialog>

      {selection.count > 0 ? (
        <p className="sr-only" aria-live="polite">
          Đã chọn {selection.count} ảnh, tổng {formatBytes(selection.totalBytes)}.
        </p>
      ) : null}
    </div>
  );
}
