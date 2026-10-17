import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  Check,
  Copy,
  Download,
  Link2,
  Lock,
  LockOpen,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import type { Album, AlbumShare } from "@/types";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { SelectField, Switch, TextField } from "@/components/ui/Field";
import { shareService, buildShareUrl } from "@/services/shareService";
import { describeError } from "@/services/errors";
import { toastError, toastSuccess } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

const EXPIRY_OPTIONS = [
  { value: "0", label: "Không hết hạn" },
  { value: "1", label: "1 ngày" },
  { value: "7", label: "7 ngày" },
  { value: "30", label: "30 ngày" },
  { value: "90", label: "90 ngày" },
];

/**
 * Hộp thoại chia sẻ album.
 *
 * Bảo mật: token do backend sinh, chỉ hiển thị MỘT LẦN khi tạo; mật khẩu được
 * xác minh ở phía server (Edge Function hoặc backend cục bộ), không bao giờ
 * được nhúng vào trang hay so sánh ở client.
 */
export function ShareAlbumDialog({
  open,
  onClose,
  album,
}: {
  open: boolean;
  onClose: () => void;
  album: Album;
}) {
  const [shares, setShares] = useState<AlbumShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [allowDownload, setAllowDownload] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState("0");

  const loadShares = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setShares(await shareService.listForAlbum(album.id));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [album.id]);

  useEffect(() => {
    if (!open) return;
    setNewToken(null);
    setCopied(false);
    void loadShares();
  }, [loadShares, open]);

  const activeShares = shares.filter((share) => !share.revokedAt);

  const createShare = async () => {
    setCreating(true);
    setError(null);
    try {
      const share = await shareService.create({
        albumId: album.id,
        allowDownload,
        password: usePassword && password.trim() ? password.trim() : null,
        expiresInDays: Number(expiresInDays) || null,
      });
      setNewToken(share.token ?? null);
      setPassword("");
      setUsePassword(false);
      await loadShares();
      toastSuccess(
        "Đã tạo liên kết chia sẻ",
        "Hãy sao chép liên kết ngay — vì lý do bảo mật, liên kết chỉ hiển thị đầy đủ một lần.",
      );
    } catch (caught) {
      setError(describeError(caught));
      toastError(caught);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (token: string) => {
    const url = buildShareUrl(token);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Phương án dự phòng cho trình duyệt cũ hoặc ngữ cảnh không bảo mật.
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(true);
      toastSuccess("Đã sao chép liên kết chia sẻ");
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      toastError("Không sao chép được. Hãy sao chép thủ công từ ô bên dưới.");
    }
  };

  const updateShare = async (share: AlbumShare, patch: { allowDownload?: boolean }) => {
    try {
      await shareService.update(share.id, patch);
      await loadShares();
    } catch (caught) {
      toastError(caught);
    }
  };

  const revokeShare = async (share: AlbumShare) => {
    try {
      await shareService.revoke(share.id);
      await loadShares();
      toastSuccess("Đã thu hồi liên kết", "Người nhận liên kết này sẽ không mở được album nữa.");
    } catch (caught) {
      toastError(caught);
    }
  };

  const shareNow = async (token: string) => {
    const url = buildShareUrl(token);
    const data = { title: album.title, text: `Album “${album.title}” trên Cloudé`, url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await copyLink(token);
    } catch (caught) {
      // Người dùng huỷ share sheet không phải là lỗi.
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      toastError(caught);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Chia sẻ album"
      description={`“${album.title}” · ${album.photoCount} ảnh`}
      variant="sheet"
      size="lg"
      footer={<Button onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-5">
        {error ? (
          <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 px-3.5 py-3 text-[12.5px] text-danger">
            {error}
          </p>
        ) : null}

        {/* Tạo liên kết mới */}
        <section className="space-y-3 rounded-3xl border border-line bg-warm/70 p-4">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            <Link2 className="size-4 text-rose-text" aria-hidden />
            Tạo liên kết mới
          </h3>

          <div className="space-y-2">
            <Switch
              label="Cho phép tải ảnh gốc"
              description="Tắt để chỉ cho xem và duyệt ảnh, không tải xuống."
              checked={allowDownload}
              onChange={setAllowDownload}
            />
            <Switch
              label="Bảo vệ bằng mật khẩu"
              description="Mật khẩu được xác minh ở phía máy chủ, không lưu trong trang."
              checked={usePassword}
              onChange={setUsePassword}
            />
            {usePassword ? (
              <TextField
                label="Mật khẩu của liên kết"
                type="password"
                autoComplete="new-password"
                placeholder="Tối thiểu 6 ký tự"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                hint="Hãy gửi mật khẩu qua một kênh khác với liên kết."
              />
            ) : null}
            <SelectField
              label="Thời hạn liên kết"
              value={expiresInDays}
              onChange={setExpiresInDays}
              options={EXPIRY_OPTIONS}
            />
          </div>

          <Button
            onClick={() => void createShare()}
            loading={creating}
            icon={<Share2 className="size-4" aria-hidden />}
            className="w-full sm:w-auto"
          >
            Tạo liên kết chia sẻ
          </Button>
        </section>

        {/* Liên kết vừa tạo */}
        {newToken ? (
          <section className="space-y-3 rounded-3xl border border-rose/40 bg-pastel/40 p-4">
            <h3 className="text-[14px] font-semibold">Liên kết vừa tạo</h3>
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              Vì lý do bảo mật, hệ thống chỉ lưu bản băm của token. Hãy sao chép liên kết ngay bây
              giờ; nếu mất, bạn cần tạo liên kết mới.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <output className="min-w-0 flex-1 truncate rounded-2xl border border-line bg-warm px-3.5 py-2.5 text-[12.5px]">
                {buildShareUrl(newToken)}
              </output>
              <Button
                onClick={() => void copyLink(newToken)}
                icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                variant="secondary"
              >
                {copied ? "Đã sao chép" : "Sao chép"}
              </Button>
              {typeof navigator !== "undefined" && "share" in navigator ? (
                <Button variant="ghost" onClick={() => void shareNow(newToken)}>
                  Chia sẻ…
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Danh sách liên kết hiện có */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Liên kết đang hoạt động</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadShares()}
              icon={<RefreshCw className="size-3.5" aria-hidden />}
            >
              Làm mới
            </Button>
          </div>

          {loading ? (
            <p className="text-[12.5px] text-ink-soft">Đang tải danh sách liên kết…</p>
          ) : activeShares.length === 0 ? (
            <p className="rounded-2xl border border-line bg-warm/60 px-3.5 py-3 text-[12.5px] text-ink-soft">
              Album này chưa có liên kết chia sẻ nào. Chỉ bạn mới xem được ảnh cho tới khi bạn tạo
              liên kết.
            </p>
          ) : (
            <ul className="space-y-2">
              {activeShares.map((share) => (
                <li
                  key={share.id}
                  className="rounded-2xl border border-line bg-warm/70 px-3.5 py-3 text-[12.5px]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        share.allowDownload
                          ? "bg-success/15 text-success"
                          : "bg-beige/70 text-ink-soft",
                      )}
                    >
                      <Download className="size-3" aria-hidden />
                      {share.allowDownload ? "Cho tải xuống" : "Chỉ xem"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blush/70 px-2 py-0.5 text-[11px] text-rose-text">
                      {share.hasPassword ? (
                        <>
                          <Lock className="size-3" aria-hidden /> Có mật khẩu
                        </>
                      ) : (
                        <>
                          <LockOpen className="size-3" aria-hidden /> Không mật khẩu
                        </>
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-soft">
                      <CalendarClock className="size-3" aria-hidden />
                      {share.expiresAt ? `Hết hạn ${formatDateTime(share.expiresAt)}` : "Không hết hạn"}
                    </span>
                    <span className="ml-auto text-[11.5px] text-ink-soft">
                      Tạo {formatRelative(share.createdAt)} · {share.accessCount} lượt mở
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void updateShare(share, { allowDownload: !share.allowDownload })
                      }
                    >
                      {share.allowDownload ? "Tắt tải xuống" : "Cho phép tải xuống"}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void revokeShare(share)}
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                    >
                      Thu hồi
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[11.5px] leading-relaxed text-ink-soft">
          Liên kết chia sẻ chỉ cấp quyền xem và tải — người nhận không thể tải lên, sửa, đổi tên
          hay xoá ảnh. Mọi kiểm tra quyền đều được thực hiện ở phía máy chủ.
        </p>
      </div>
    </Dialog>
  );
}
