import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import type { ActiveUploadSession } from "@/types";
import { getBackend } from "@/services/backend";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatCount, formatDate, truncateMiddle } from "@/lib/format";
import { toastError, toastSuccess } from "@/components/ui/Toast";
import { announce } from "@/components/ui/LiveRegion";

/**
 * Phiên tải lên còn dở, đọc từ SERVER.
 *
 * Vì sao cần: một tệp 500 MB có thể bị ngắt ở phần thứ 40 vì mất mạng. Trạng
 * thái phiên nằm trên server, nên đóng tab, tắt máy hay đổi mạng đều không mất
 * tiến độ — chỉ cần chọn lại đúng tệp gốc để nối tiếp.
 *
 * Điều KHÔNG thể làm, và được nói rõ ở đây: trình duyệt không thể tự nhớ tệp
 * người dùng đã chọn qua lần tải lại trang. Vì vậy việc nối tiếp cần người dùng
 * chọn lại tệp, và hệ thống đối chiếu KÍCH THƯỚC trước khi cho phép nối — ghép
 * các phần của hai tệp khác nhau sẽ tạo ra tệp hỏng.
 */
export function InterruptedUploadsPanel({
  onResume,
  onChanged,
  refreshToken,
}: {
  /** Nhận tệp đã chọn cho một phiên cũ; lớp gọi sẽ đưa nó vào hàng đợi. */
  onResume: (session: ActiveUploadSession, file: File) => void;
  /** Gọi sau khi một phiên bị xoá để các bảng khác đọc lại số liệu. */
  onChanged?: () => void;
  /** Đổi giá trị để buộc đọc lại (ví dụ sau khi một phiên vừa hoàn tất). */
  refreshToken?: unknown;
}) {
  const backend = getBackend();
  const multipart = backend.multipart;
  const [sessions, setSessions] = useState<ActiveUploadSession[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSession = useRef<ActiveUploadSession | null>(null);

  const load = useCallback(async () => {
    if (!multipart) {
      setSessions([]);
      return;
    }
    try {
      setSessions(await multipart.listActiveSessions());
    } catch {
      // Chưa kết nối hoặc mạng lỗi: bảng này không làm phiền người dùng.
      setSessions([]);
    }
  }, [multipart]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  if (!multipart || !sessions || sessions.length === 0) return null;

  const pickFileFor = (session: ActiveUploadSession) => {
    pendingSession.current = session;
    setSizeWarning(null);
    inputRef.current?.click();
  };

  const onFileChosen = (files: FileList | null) => {
    const session = pendingSession.current;
    pendingSession.current = null;
    if (!session || !files || files.length === 0) return;
    const file = files[0];

    // Kiểm tra kích thước TRƯỚC khi cho nối tiếp. Nối nhầm tệp sẽ ghép các phần
    // của hai nội dung khác nhau, và checksum phía server sẽ phát hiện — nhưng
    // tốt hơn hết là chặn ngay tại đây.
    if (file.size !== session.totalBytes) {
      setSizeWarning(
        `Tệp bạn chọn có ${formatBytes(file.size)}, nhưng phiên cần đúng ${formatBytes(session.totalBytes)}. Hãy chọn lại tệp gốc.`,
      );
      announce("Tệp không khớp kích thước với phiên đã dở.", "assertive");
      return;
    }

    announce(`Sẽ nối tiếp phiên cho ${session.originalFilename}.`);
    onResume(session, file);
  };

  const abort = async (session: ActiveUploadSession) => {
    setBusyId(session.id);
    try {
      await multipart.abortSession(session.id);
      toastSuccess("Đã xoá phiên dở", "Các phần đã gửi trên kho lưu trữ cũng được dọn theo.");
      await load();
      onChanged?.();
    } catch (caught) {
      toastError(caught);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-label="Phiên tải lên còn dở"
      className="rounded-3xl border border-line bg-warm/85 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="size-4 text-ink-soft" aria-hidden />
        <h2 className="text-[14px] font-medium">
          {formatCount(sessions.length, "phiên")} tải lên còn dở
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          icon={<RefreshCw className="size-3.5" aria-hidden />}
          onClick={() => void load()}
        >
          Đọc lại
        </Button>
      </div>

      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
        Các phần đã gửi vẫn nằm trên kho lưu trữ. Chọn lại đúng tệp gốc để nối tiếp — chỉ những
        phần còn thiếu được gửi lại.
      </p>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        onChange={(event) => {
          onFileChosen(event.target.files);
          event.target.value = "";
        }}
      />

      {sizeWarning ? (
        <p
          role="alert"
          className="mt-2.5 flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {sizeWarning}
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-line">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">
                {truncateMiddle(session.originalFilename, 44)}
              </p>
              <p className="text-[11.5px] text-ink-soft">
                {formatBytes(session.uploadedBytes)}/{formatBytes(session.totalBytes)} ·{" "}
                {session.completedParts}/{session.partCount} phần · còn{" "}
                {session.partCount - session.completedParts} phần · hết hạn{" "}
                {formatDate(session.expiresAt)}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<UploadCloud className="size-3.5" aria-hidden />}
              onClick={() => pickFileFor(session)}
            >
              Nối tiếp
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busyId === session.id}
              icon={<Trash2 className="size-3.5" aria-hidden />}
              onClick={() => void abort(session)}
            >
              Xoá phiên
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
