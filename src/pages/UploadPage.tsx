import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FolderPlus, ImagePlus, Upload } from "lucide-react";
import type { ActiveUploadSession, Album } from "@/types";
import { albumService } from "@/services/albumService";
import { describeError } from "@/services/errors";
import { useAuth } from "@/context/AuthContext";
import { AlbumDialog } from "@/components/albums/AlbumDialog";
import { UploadPanel } from "@/components/upload/UploadPanel";
import { InterruptedUploadsPanel } from "@/components/upload/InterruptedUploadsPanel";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { SelectField } from "@/components/ui/Field";
import { toastError, toastSuccess } from "@/components/ui/Toast";

/**
 * Trang tải ảnh riêng (điểm vào từ điều hướng dưới trên mobile).
 * Cho phép chọn album đích hoặc tạo album mới ngay tại chỗ.
 */
export function UploadPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  // Yêu cầu nối tiếp phiên dở: hàng đợi nằm trong UploadPanel, nên tệp đã chọn
  // được chuyển xuống đó thay vì tạo hàng đợi thứ hai.
  const [resumeRequest, setResumeRequest] = useState<{
    session: ActiveUploadSession;
    file: File;
  } | null>(null);

  const selectedId = params.get("album") ?? "";

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await albumService.list({ sort: "newest", limit: 100 });
      setAlbums(page.items);
      if (!params.get("album") && page.items.length > 0) {
        setParams({ album: page.items[0].id }, { replace: true });
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const createAlbum = async (values: { title: string; description: string | null }) => {
    setCreating(true);
    try {
      const album = await albumService.create(values);
      setAlbums((previous) => [album, ...previous]);
      setParams({ album: album.id }, { replace: true });
      setCreateOpen(false);
      toastSuccess("Đã tạo album", `“${album.title}” sẵn sàng nhận ảnh.`);
    } catch (caught) {
      toastError(caught);
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <EmptyState
        title="Đăng nhập để tải ảnh lên"
        description="Cloudey cần biết ảnh thuộc về ai trước khi lưu trữ."
        action={
          <Link
            to="/login?next=/upload"
            className="rounded-full bg-pastel px-5 py-2.5 text-sm font-medium text-rose-text"
          >
            Đăng nhập
          </Link>
        }
      />
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    );
  }

  if (error) {
    return <ErrorState description={error} onRetry={() => void load()} />;
  }

  if (albums.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Cần một album trước đã"
          description="Ảnh luôn thuộc về một album để bạn dễ tìm lại sau này. Hãy tạo album đầu tiên."
          action={
            <Button
              onClick={() => setCreateOpen(true)}
              icon={<FolderPlus className="size-4" aria-hidden />}
            >
              Tạo album
            </Button>
          }
        />
        <AlbumDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSubmit={createAlbum}
          submitting={creating}
        />
      </div>
    );
  }

  const selectedAlbum = albums.find((album) => album.id === selectedId) ?? albums[0];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-[26px] leading-tight sm:text-3xl">Tải ảnh lên</h1>
        <p className="text-[13.5px] text-ink-soft">
          Ảnh gốc được lưu nguyên byte. Bạn có thể chọn hàng trăm tệp cùng lúc — Cloudey sẽ tải lên
          theo hàng đợi và tự thử lại khi mạng yếu.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-3xl border border-line bg-warm/80 p-4">
        <SelectField
          label="Tải vào album"
          className="min-w-[220px] flex-1"
          value={selectedAlbum.id}
          onChange={(value) => setParams({ album: value }, { replace: true })}
          options={albums.map((album) => ({
            value: album.id,
            label: `${album.title} (${album.photoCount} ảnh)`,
          }))}
        />
        <Button
          variant="secondary"
          onClick={() => setCreateOpen(true)}
          icon={<FolderPlus className="size-4" aria-hidden />}
        >
          Album mới
        </Button>
        <Button
          variant="ghost"
          onClick={() => navigate(`/albums/${selectedAlbum.id}`)}
          icon={<ImagePlus className="size-4" aria-hidden />}
        >
          Mở album
        </Button>
      </div>

      <InterruptedUploadsPanel
        refreshToken={uploadedCount}
        onResume={(session, file) => setResumeRequest({ session, file })}
      />

      <UploadPanel
        key={selectedAlbum.id}
        albumId={selectedAlbum.id}
        resumeRequest={resumeRequest}
        onPhotoUploaded={() => {
          setUploadedCount((value) => value + 1);
          setResumeRequest(null);
        }}
      />

      {uploadedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-line bg-pastel/40 px-4 py-3 text-[13px]">
          <Upload className="size-4 text-rose-text" aria-hidden />
          <span className="font-medium">Đã tải lên {uploadedCount} ảnh trong phiên này.</span>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => navigate(`/albums/${selectedAlbum.id}`)}
          >
            Đến album
          </Button>
        </div>
      ) : null}

      <p className="text-[12px] leading-relaxed text-ink-soft">
        Mẹo: nếu mạng chập chờn, hàng đợi sẽ tự thử lại với khoảng chờ tăng dần. Ảnh trùng nội dung
        (cùng SHA-256) trong album sẽ được đánh dấu và bỏ qua thay vì lưu hai bản. Với tệp lớn, từng
        phần được thử lại riêng — mất mạng ở phần thứ 40 thì chỉ phần đó được gửi lại.
      </p>

      <AlbumDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={createAlbum}
        submitting={creating}
      />
    </div>
  );
}
