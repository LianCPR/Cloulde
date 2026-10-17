import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Search, Sparkles, X } from "lucide-react";
import type { Album, AlbumSort } from "@/types";
import { albumService } from "@/services/albumService";
import { describeError } from "@/services/errors";
import { useAuth } from "@/context/AuthContext";
import { AlbumGrid } from "@/components/albums/AlbumGrid";
import { AlbumDialog } from "@/components/albums/AlbumDialog";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Button, LinkButton } from "@/components/ui/Button";
import { formatBytes, formatCount, photoCountLabel } from "@/lib/format";
import { toastError, toastSuccess } from "@/components/ui/Toast";
import { getBackend } from "@/services/backend";
import type { StorageUsage } from "@/types";

const PAGE_SIZE = 12;

/** Trang chủ: lưới album của người dùng, có tìm kiếm, sắp xếp và tạo album. */
export function HomePage() {
  const { user, initializing } = useAuth();
  const navigate = useNavigate();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AlbumSort>("newest");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const requestId = useRef(0);

  // Gõ tới đâu tìm tới đó, nhưng chờ 300ms để không dội truy vấn vào máy chủ.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadFirstPage = useCallback(async () => {
    if (!user) {
      setAlbums([]);
      setLoading(false);
      return;
    }
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await albumService.list({ search, sort, limit: PAGE_SIZE });
      if (current !== requestId.current) return;
      setAlbums(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total ?? null);
    } catch (caught) {
      if (current !== requestId.current) return;
      setError(describeError(caught));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [search, sort, user]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    if (!user) return;
    void getBackend()
      .usage.getUsage()
      .then(setUsage)
      .catch(() => undefined);
  }, [user, albums.length]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const current = requestId.current;
    setLoadingMore(true);
    try {
      const page = await albumService.list({ search, sort, cursor: nextCursor, limit: PAGE_SIZE });
      if (current !== requestId.current) return;
      setAlbums((previous) => {
        const seen = new Set(previous.map((album) => album.id));
        return [...previous, ...page.items.filter((album) => !seen.has(album.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (caught) {
      toastError(caught);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, search, sort]);

  const createAlbum = async (values: { title: string; description: string | null }) => {
    setCreating(true);
    try {
      const album = await albumService.create(values);
      setCreateOpen(false);
      toastSuccess("Đã tạo album", `“${album.title}” đã sẵn sàng để nhận ảnh.`);
      navigate(`/albums/${album.id}`);
    } catch (caught) {
      toastError(caught);
    } finally {
      setCreating(false);
    }
  };

  const summary = useMemo(() => {
    if (!usage) return null;
    return `${formatCount(usage.albumCount, "album")} · ${photoCountLabel(usage.photoCount)} · ${formatBytes(usage.usedBytes)}`;
  }, [usage]);

  if (initializing) {
    return <AlbumGrid albums={[]} loading skeletonCount={8} />;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-4xl border border-line bg-warm/80 px-6 py-14 text-center sm:px-12">
          <span className="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-pastel text-rose-text">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">
            Kho ảnh gốc của bạn, đẹp như một cuốn album
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-soft">
            Cloudé lưu ảnh ở chất lượng nguyên bản — không nén lại, không đổi định dạng, không mất
            metadata. Bạn sắp xếp theo album, chia sẻ bằng liên kết riêng tư, và tải về đúng tệp gốc
            bất cứ lúc nào.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LinkButton
              to="/signup"
              size="lg"
              icon={<ArrowRight className="size-4" aria-hidden />}
            >
              Bắt đầu lưu ảnh
            </LinkButton>
            <LinkButton to="/login" size="lg" variant="secondary">
              Tôi đã có tài khoản
            </LinkButton>
          </div>
          <ul className="mx-auto mt-9 grid max-w-2xl gap-3 text-left text-[13px] leading-relaxed text-ink-soft sm:grid-cols-2">
            <li className="rounded-2xl bg-blush/50 px-4 py-3">
              <strong className="block text-ink">Ảnh gốc nguyên vẹn</strong>
              SHA-256 được tính cho từng tệp để phát hiện trùng lặp và kiểm tra toàn vẹn.
            </li>
            <li className="rounded-2xl bg-beige/50 px-4 py-3">
              <strong className="block text-ink">Tải xuống đúng tệp đã lưu</strong>
              Ghi trực tiếp vào thư mục bạn chọn, hoặc gói ZIP không nén lại.
            </li>
            <li className="rounded-2xl bg-pastel/40 px-4 py-3">
              <strong className="block text-ink">Chia sẻ có kiểm soát</strong>
              Mật khẩu, ngày hết hạn, bật/tắt tải xuống — và thu hồi được bất cứ lúc nào.
            </li>
            <li className="rounded-2xl bg-blush/50 px-4 py-3">
              <strong className="block text-ink">Hỗ trợ định dạng lớn</strong>
              JPEG, PNG, WebP, HEIC, TIFF và cả RAW (DNG, CR3, NEF, ARW…). RAW không bị chuyển sang
              JPEG.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-[26px] leading-tight sm:text-4xl">
          Thư viện của {user.displayName || user.email.split("@")[0]}
        </h1>
        <p className="text-[13.5px] text-ink-soft">
          {summary ?? "Đang tính dung lượng…"}
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Tìm album theo tên hoặc mô tả…"
            aria-label="Tìm album"
            className="h-11 w-full rounded-2xl border border-line bg-warm pl-10 pr-10 text-[14px] placeholder:text-ink-soft/70 focus:border-rose/60 focus:outline-none focus:ring-4 focus:ring-pastel/60"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Xoá từ khoá tìm kiếm"
              className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-soft transition-colors hover:bg-blush hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="sort-albums">
            Sắp xếp album
          </label>
          <select
            id="sort-albums"
            value={sort}
            onChange={(event) => setSort(event.target.value as AlbumSort)}
            className="h-11 rounded-2xl border border-line bg-warm px-3.5 text-[13.5px] focus:border-rose/60 focus:outline-none focus:ring-4 focus:ring-pastel/60"
          >
            {Object.entries(albumService.sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button
            onClick={() => setCreateOpen(true)}
            icon={<Plus className="size-4" aria-hidden />}
            className="shrink-0"
          >
            <span className="hidden sm:inline">Tạo album</span>
            <span className="sm:hidden">Tạo</span>
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={() => void loadFirstPage()} />
      ) : loading ? (
        <AlbumGrid albums={[]} loading skeletonCount={8} />
      ) : albums.length === 0 ? (
        search ? (
          <EmptyState
            title={`Không tìm thấy album nào khớp “${search}”`}
            description="Thử một từ khoá ngắn hơn, hoặc xoá bộ lọc để xem toàn bộ thư viện."
            showIllustration={false}
            action={
              <Button variant="secondary" onClick={() => setSearchInput("")}>
                Xoá bộ lọc
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Thư viện còn trống"
            description="Hãy tạo album đầu tiên rồi kéo thả ảnh vào. Cloudé giữ nguyên tệp gốc, kể cả ảnh RAW và HEIC."
            action={
              <Button
                onClick={() => setCreateOpen(true)}
                icon={<Plus className="size-4" aria-hidden />}
              >
                Tạo album đầu tiên
              </Button>
            }
          />
        )
      ) : (
        <>
          <AlbumGrid albums={albums} />
          {nextCursor ? (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Tải thêm album
              </Button>
            </div>
          ) : total !== null && total > PAGE_SIZE ? (
            <p className="text-center text-[12.5px] text-ink-soft">
              Đã hiển thị toàn bộ {formatCount(total, "album")}.
            </p>
          ) : null}
        </>
      )}

      <section className="rounded-3xl border border-line bg-warm/70 px-5 py-4">
        <h2 className="text-[13.5px] font-semibold">Mẹo nhỏ</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
          Trong album, nhấn giữ <kbd className="rounded bg-blush px-1">Ctrl</kbd> /{" "}
          <kbd className="rounded bg-blush px-1">⌘</kbd> khi chọn ảnh để chọn nhanh nhiều ảnh. Trên
          máy tính, tuỳ chọn “Lưu vào thư mục tôi chọn” sẽ ghi từng ảnh gốc thẳng xuống đĩa — nhanh
          nhất với album lớn.{" "}
          <Link to="/settings" className="text-rose-text underline decoration-rose/40 underline-offset-2">
            Xem cài đặt tải xuống
          </Link>
          .
        </p>
      </section>

      <AlbumDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={createAlbum}
        submitting={creating}
      />
    </div>
  );
}
