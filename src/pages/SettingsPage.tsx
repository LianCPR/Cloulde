import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Database,
  Download,
  HardDrive,
  Info as InfoIcon,
  LogOut,
  Share2,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Album, StorageUsage } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { albumService } from "@/services/albumService";
import { getBackend } from "@/services/backend";
import { wipeLocalDatabase } from "@/services/local/localDb";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Field";
import { ShareAlbumDialog } from "@/components/sharing/ShareAlbumDialog";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  readDownloadPreferences,
  writeDownloadPreferences,
  type DownloadPreferences,
  detectCapabilities,
} from "@/lib/capabilities";
import { formatBytes, formatCount, formatDate, photoCountLabel } from "@/lib/format";
import { toastError, toastSuccess } from "@/components/ui/Toast";
import { uploadLimitBytes } from "@/config/env";
import { ArchiveHealthPanel } from "@/components/system/ArchiveHealthPanel";
import { archiveConnection } from "@/services/archive/archiveBackend";

/** Trang cài đặt: tài khoản, dung lượng, hành vi tải xuống, chia sẻ, quyền riêng tư. */
export function SettingsPage() {
  const { user, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const backend = getBackend();
  const capabilities = detectCapabilities();
  const archiveMode = backend.mode === "archive";
  const connection = archiveMode ? archiveConnection.current() : null;

  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<DownloadPreferences>(() =>
    readDownloadPreferences(),
  );
  const [shareAlbum, setShareAlbum] = useState<Album | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [usageResult, albumPage] = await Promise.all([
        backend.usage.getUsage().catch(() => null),
        albumService.list({ sort: "newest", limit: 50 }).catch(() => null),
      ]);
      setUsage(usageResult);
      setAlbums(albumPage?.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [backend, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePreference = (patch: Partial<DownloadPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    writeDownloadPreferences(next);
  };

  const wipeDemoData = async () => {
    setWiping(true);
    try {
      await wipeLocalDatabase();
      toastSuccess("Đã xoá dữ liệu demo", "Trình duyệt này đã trở về trạng thái trống.");
      setWipeOpen(false);
      await signOut();
      navigate("/");
    } catch (caught) {
      toastError(caught);
    } finally {
      setWiping(false);
    }
  };

  if (!user) {
    return (
      <EmptyState
        title="Bạn chưa đăng nhập"
        description="Hãy đăng nhập để xem thông tin tài khoản, dung lượng và cài đặt tải xuống."
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="font-display text-[26px] leading-tight sm:text-3xl">Cài đặt</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">
          Quản lý tài khoản, dung lượng lưu trữ và cách Cloudey tải ảnh gốc về máy bạn.
        </p>
      </header>

      {/* Tài khoản */}
      <Section icon={<UserRound className="size-4" aria-hidden />} title="Tài khoản">
        <dl className="grid gap-3 sm:grid-cols-2">
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Tên hiển thị" value={user.displayName || "Chưa đặt"} />
          <InfoRow label="Ngày tạo tài khoản" value={formatDate(user.createdAt)} />
          <InfoRow
            label="Phương thức xác thực"
            value={
              backend.mode === "supabase"
                ? "Supabase Auth"
                : backend.mode === "archive"
                  ? connection?.token
                    ? "Token chủ kho (lưu cục bộ)"
                    : "Cloudflare Access"
                  : "Cục bộ (demo)"
            }
          />
          {archiveMode ? (
            <InfoRow
              label="Kho lưu trữ"
              value={connection?.baseUrl ? connection.baseUrl : "Cùng origin (Worker phục vụ luôn trang này)"}
            />
          ) : null}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<LogOut className="size-4" aria-hidden />}
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
          >
            Đăng xuất
          </Button>
          {archiveMode ? (
            <Button
              variant="ghost"
              icon={<ShieldCheck className="size-4" aria-hidden />}
              onClick={() => navigate("/connect")}
            >
              Đổi kết nối kho lưu trữ
            </Button>
          ) : null}
          {archiveMode ? (
            <Button
              variant="ghost"
              icon={<Database className="size-4" aria-hidden />}
              onClick={async () => {
                archiveConnection.refresh();
                await refresh();
                toastSuccess("Đã đọc lại danh tính chủ kho");
              }}
            >
              Kiểm tra lại kết nối
            </Button>
          ) : null}
        </div>
      </Section>

      {/* Dung lượng */}
      <Section icon={<HardDrive className="size-4" aria-hidden />} title="Dung lượng lưu trữ">
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : usage ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-2xl font-semibold">
                {formatBytes(usage.usedBytes)}
                {usage.quotaBytes ? (
                  <span className="ml-1 text-[13px] font-normal text-ink-soft">
                    / {formatBytes(usage.quotaBytes)}
                  </span>
                ) : null}
              </p>
              <p className="text-[12.5px] text-ink-soft">
                {photoCountLabel(usage.photoCount)} · {formatCount(usage.albumCount, "album")}
              </p>
            </div>
            {usage.quotaBytes ? (
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-rose transition-[width] duration-500"
                  style={{
                    width: `${Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100).toFixed(1)}%`,
                  }}
                />
              </div>
            ) : null}
            <p className="text-[12px] leading-relaxed text-ink-soft">
              {backend.mode === "archive"
                ? "Số liệu đo trực tiếp từ cơ sở dữ liệu của kho lưu trữ. KHÔNG có hạn mức dung lượng hay số ảnh do ứng dụng đặt: trần thực tế là gói Cloudflare, trạng thái tài khoản và phương thức thanh toán của bạn."
                : backend.mode === "supabase"
                  ? "Hạn mức hiển thị 5 GB do chủ kho đặt. Giới hạn thật theo gói Supabase đang dùng (Free: tổng dung lượng project và 50 MB mỗi tệp — nâng ở Dashboard khi cần)."
                  : "Chế độ demo cục bộ: dung lượng thực tế bị giới hạn bởi hạn mức IndexedDB của trình duyệt (thường vài GB)."}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-ink-soft">Không đọc được thông tin dung lượng.</p>
        )}
        {/* Bảng điều khiển sức khoẻ & chi phí — chỉ có ở chế độ kho lưu trữ. */}
        {archiveMode && !loading ? <ArchiveHealthPanel /> : null}
      </Section>

      {/* Hành vi tải xuống */}
      <Section icon={<Download className="size-4" aria-hidden />} title="Hành vi tải xuống">
        <div className="space-y-3">
          <Switch
            label="Hỏi trước khi tải hàng loạt"
            description="Hiện ước lượng số tệp và dung lượng trước khi tạo gói ZIP lớn."
            checked={preferences.askBeforeBulkDownload}
            onChange={(value) => updatePreference({ askBeforeBulkDownload: value })}
          />
          <Switch
            label="Kiểm tra SHA-256 sau khi tải (tệp ≤ 10MB)"
            description="So sánh mã băm của tệp nhận được với mã băm của ảnh gốc đã lưu để xác nhận nguyên vẹn."
            checked={preferences.verifyChecksums}
            onChange={(value) => updatePreference({ verifyChecksums: value })}
          />
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <InfoRow
            label="Chọn thư mục đích"
            value={
              capabilities.fileSystemAccess
                ? "Được hỗ trợ — ghi trực tiếp từng ảnh gốc"
                : "Không được hỗ trợ — dùng ZIP hoặc tải từng ảnh"
            }
          />
          <InfoRow
            label="ZIP ghi ra đĩa (OPFS)"
            value={capabilities.opfs ? "Có — phù hợp album dung lượng lớn" : "Không — ZIP giữ trong RAM"}
          />
          <InfoRow
            label={archiveMode ? "Trần mỗi tệp (theo giới hạn R2)" : "Giới hạn mỗi ảnh tải lên"}
            value={formatBytes(uploadLimitBytes)}
          />
          <InfoRow
            label="Share sheet hệ điều hành"
            value={capabilities.shareFiles ? "Được hỗ trợ" : "Không được hỗ trợ"}
          />
        </dl>
      </Section>

      {/* Liên kết chia sẻ */}
      <Section icon={<Share2 className="size-4" aria-hidden />} title="Quản lý liên kết chia sẻ">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : albums.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Bạn chưa có album nào để chia sẻ.</p>
        ) : (
          <ul className="divide-y divide-line">
            {albums.slice(0, 12).map((album) => (
              <li key={album.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{album.title}</p>
                  <p className="text-[12px] text-ink-soft">
                    {photoCountLabel(album.photoCount)} · {formatBytes(album.totalBytes)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShareAlbum(album)}>
                  Quản lý liên kết
                </Button>
                <Link
                  to={`/albums/${album.id}`}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-rose-text"
                >
                  Mở album
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-ink-soft">
          Mỗi liên kết có thể bật/tắt tải xuống, đặt mật khẩu, hẹn ngày hết hạn và thu hồi bất cứ
          lúc nào. Cloudey chỉ lưu bản băm của token nên liên kết chỉ hiển thị đầy đủ một lần khi tạo.
        </p>
      </Section>

      {/* Quyền riêng tư */}
      <Section icon={<ShieldCheck className="size-4" aria-hidden />} title="Quyền riêng tư & an toàn">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-ink-soft">
          <li>
            • Mọi truy vấn album và ảnh đều bị giới hạn bởi <strong className="text-ink">Row Level Security</strong>{" "}
            theo người dùng đang đăng nhập. Frontend không phải là nơi duy nhất kiểm tra quyền.
          </li>
          <li>
            • Ảnh gốc nằm trong bucket <strong className="text-ink">riêng tư</strong>. Để xem hoặc tải,
            hệ thống cấp signed URL ngắn hạn; không có bucket công khai nào cho ảnh riêng tư.
          </li>
          <li>
            • Mật khẩu chia sẻ được băm ở phía máy chủ (pgcrypto/bcrypt). Token chia sẻ được lưu dưới
            dạng SHA-256.
          </li>
          <li>
            • Khoá <code className="rounded bg-blush px-1">service_role</code> chỉ tồn tại trong Edge
            Function, không bao giờ có trong mã trình duyệt.
          </li>
          <li>
            • Ảnh gốc được lưu nguyên byte: không nén lại, không đổi định dạng, không sửa EXIF.
          </li>
        </ul>
      </Section>

      {/* Chế độ demo */}
      {backend.mode === "local" ? (
        <Section icon={<Database className="size-4" aria-hidden />} title="Dữ liệu demo cục bộ">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            Bạn đang chạy không có Supabase, nên toàn bộ album, ảnh và liên kết chia sẻ chỉ nằm
            trong IndexedDB của trình duyệt này. Sao lưu bằng cách tải ảnh về máy; xoá dữ liệu demo
            sẽ không thể khôi phục.
          </p>
          <Button
            variant="danger"
            className="mt-3"
            icon={<Trash2 className="size-4" aria-hidden />}
            onClick={() => setWipeOpen(true)}
          >
            Xoá toàn bộ dữ liệu demo
          </Button>
        </Section>
      ) : null}

      {/* Giới hạn đã biết */}
      <Section icon={<InfoIcon className="size-4" aria-hidden />} title="Giới hạn cần biết">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-ink-soft">
          <li>
            • Trình duyệt không thể ghi trực tiếp vào Thư viện ảnh trên iOS. Trên iPhone, ảnh tải về
            sẽ nằm trong ứng dụng Tệp và cần người dùng lưu vào Ảnh thủ công (hoặc dùng share sheet).
          </li>
          <li>
            • Xem trước trong trình duyệt không hỗ trợ mọi định dạng. RAW (DNG, CR3, NEF, ARW…), TIFF
            và HEIC trên một số trình duyệt sẽ hiển thị dạng thẻ định dạng thay vì ảnh — nhưng tệp
            gốc vẫn nguyên vẹn và tải xuống được.
          </li>
          <li>
            • Gói ZIP do trình duyệt tạo có giới hạn số tệp và dung lượng. Với album rất lớn, hãy
            chọn thư mục đích (Chrome/Edge) hoặc chia nhỏ album.
          </li>
          <li>
            • Cloudey không tự sao lưu ảnh gốc. Hãy giữ thêm một bản sao độc lập cho kho ảnh của bạn.
          </li>
        </ul>
      </Section>

      {shareAlbum ? (
        <ShareAlbumDialog
          open={Boolean(shareAlbum)}
          onClose={() => setShareAlbum(null)}
          album={shareAlbum}
        />
      ) : null}

      <Dialog
        open={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title="Xoá toàn bộ dữ liệu demo?"
        description="Không thể hoàn tác."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWipeOpen(false)}>
              Giữ lại
            </Button>
            <Button variant="danger" loading={wiping} onClick={() => void wipeDemoData()}>
              Xoá hết
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-ink-soft">
          Toàn bộ album, ảnh gốc, ảnh thu nhỏ, liên kết chia sẻ và tài khoản cục bộ sẽ bị xoá khỏi
          trình duyệt này. Nếu chưa tải ảnh về máy, bạn sẽ mất chúng vĩnh viễn.
        </p>
      </Dialog>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-line bg-warm/80 p-5">
      <h2 className="flex items-center gap-2 text-[14.5px] font-semibold">
        <span className="grid size-7 place-items-center rounded-full bg-pastel/80 text-rose-text">
          {icon}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-blush/40 px-3.5 py-2.5">
      <dt className="text-[11.5px] uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px]">{value}</dd>
    </div>
  );
}
