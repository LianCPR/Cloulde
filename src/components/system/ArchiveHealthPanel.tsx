import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Coins,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { ArchiveHealth, ArchiveMaintenanceResult, ArchiveUsage } from "@/types";
import { getBackend } from "@/services/backend";
import { describeError } from "@/services/errors";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatBytes, formatCount } from "@/lib/format";
import { toastError, toastSuccess } from "@/components/ui/Toast";

/**
 * Bảng điều khiển sức khoẻ & chi phí của kho lưu trữ.
 *
 * Nguyên tắc trung thực:
 *  • Dung lượng hiển thị là số ĐO ĐƯỢC từ cơ sở dữ liệu, không phải ước lượng.
 *  • Chi phí là ƯỚC TÍNH từ đơn giá cấu hình, và được ghi rõ là như vậy.
 *  • Không có hạn mức nào do ứng dụng đặt: ngưỡng của nhà cung cấp chỉ sinh
 *    CẢNH BÁO, không bao giờ chặn tải lên hay xoá ảnh.
 *  • Kiểm tra sức khoẻ THỰC SỰ ghi/đọc/xoá một object thử, không phải ping suông.
 */
export function ArchiveHealthPanel() {
  const backend = getBackend();
  const [usage, setUsage] = useState<ArchiveUsage | null>(null);
  const [health, setHealth] = useState<ArchiveHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastMaintenance, setLastMaintenance] = useState<ArchiveMaintenanceResult | null>(null);

  const load = useCallback(async () => {
    if (!backend.usageDetails || !backend.health) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [usageResult, healthResult] = await Promise.all([
        backend.usageDetails().catch(() => null),
        backend.health().catch(() => null),
      ]);
      setUsage(usageResult);
      setHealth(healthResult);
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMaintenance = async () => {
    if (!backend.runMaintenance) return;
    setBusy(true);
    try {
      const result = await backend.runMaintenance();
      setLastMaintenance(result);
      toastSuccess(
        "Đã chạy bảo trì",
        `${result.jobsProcessed.length} việc xử lý · còn ${result.pendingJobsRemaining} việc trong hàng đợi`,
      );
      await load();
    } catch (caught) {
      toastError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!usage) {
    return (
      <p className="text-[13px] text-ink-soft">
        Không đọc được số liệu dung lượng từ kho lưu trữ. {health ? describeError(health) : ""}
      </p>
    );
  }

  const warnings = usage.warnings.filter((warning) => warning.level === "warning");

  return (
    <div className="space-y-4">
      {/* Số liệu thật */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          icon={<HardDrive className="size-4" aria-hidden />}
          label="Đang lưu trữ"
          value={formatBytes(usage.usedBytes)}
          hint={`${formatBytes(usage.originalBytes)} ảnh gốc · ${formatBytes(usage.thumbnailBytes)} ảnh thu nhỏ`}
        />
        <Metric
          icon={<Coins className="size-4" aria-hidden />}
          label="Ước tính tháng này"
          value={`$${usage.cost.totalUsd.toFixed(4)}`}
          hint={`${usage.cost.marginalPerGbMonthUsd} USD mỗi GB tăng thêm`}
        />
        <Metric
          icon={<Activity className="size-4" aria-hidden />}
          label="Thao tác trong tháng"
          value={`${formatCount(usage.operations.classA, "A")} · ${formatCount(usage.operations.classB, "B")}`}
          hint={`Đọc ${formatBytes(usage.operations.bytesRead)} · ghi ${formatBytes(usage.operations.bytesWritten)}`}
        />
      </div>

      {/* Xác minh toàn vẹn */}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row
          label="Ảnh chờ xác minh SHA-256"
          value={
            usage.verification.awaitingVerification === 0
              ? "Không còn ảnh nào"
              : `${formatCount(usage.verification.awaitingVerification, "ảnh")} trong hàng đợi`
          }
          tone={usage.verification.awaitingVerification === 0 ? "ok" : "neutral"}
        />
        <Row
          label="Ảnh sai lệch checksum"
          value={
            usage.verification.mismatches === 0
              ? "Không phát hiện sai lệch"
              : `${formatCount(usage.verification.mismatches, "ảnh")} cần kiểm tra lại`
          }
          tone={usage.verification.mismatches === 0 ? "ok" : "danger"}
        />
      </dl>

      {/* Sức khoẻ hạ tầng */}
      {health ? (
        <div className="rounded-2xl border border-line bg-warm/70 p-3.5">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            {health.ok ? (
              <CheckCircle2 className="size-4 text-success" aria-hidden />
            ) : (
              <AlertTriangle className="size-4 text-danger" aria-hidden />
            )}
            {health.ok
              ? "Kho lưu trữ hoạt động: đã ghi – đọc – xoá thử thành công"
              : "Có thành phần chưa hoạt động — xem chi tiết bên dưới"}
          </p>
          <dl className="mt-2.5 grid gap-2 text-[12.5px] sm:grid-cols-2">
            <Detail label="Driver lưu trữ" value={health.storage.driver} />
            <Detail
              label="Cách tải lên"
              value={
                health.storage.uploadMode === "worker-proxy"
                  ? "Qua Worker (không lộ khoá nào ở trình duyệt)"
                  : health.storage.uploadMode
              }
            />
            <Detail
              label="Bucket ảnh gốc"
              value={health.storage.originalsWritable ? "Ghi được" : "Không ghi được"}
            />
            <Detail
              label="Bucket ảnh thu nhỏ"
              value={health.storage.thumbnailsWritable ? "Ghi được" : "Không ghi được"}
            />
            <Detail
              label="Hàng đợi nền"
              value={health.queue.pendingJobs === 0 ? "Trống" : `${health.queue.pendingJobs} việc chờ`}
            />
            <Detail
              label="Phiên tải lên dở"
              value={
                health.uploads.activeSessions === 0
                  ? "Không có"
                  : `${health.uploads.activeSessions} phiên`
              }
            />
          </dl>
          {health.details.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[12px] text-danger">
              {health.details.map((detail) => (
                <li key={detail}>• {detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Ngưỡng & cảnh báo */}
      {warnings.length > 0 ? (
        <ul className="space-y-2">
          {warnings.map((warning) => (
            <li
              key={warning.message}
              className="flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-danger"
            >
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {warning.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-2 rounded-2xl bg-beige/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
          <BadgeCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Chưa vượt ngưỡng miễn phí nào của nhà cung cấp. Các ngưỡng này chỉ để CẢNH BÁO — ứng dụng
          không chặn tải lên và không tự xoá ảnh để tiết kiệm tiền.
        </p>
      )}

      <p className="text-[12px] leading-relaxed text-ink-soft">
        {usage.cost.note} Số liệu tháng {usage.month}. Trần kỹ thuật của nền tảng: mỗi request tối đa{" "}
        {formatBytes(health?.limits.workerMaxRequestBytes ?? 0)} (lý do phải chia phần) và tối đa{" "}
        {formatCount(health?.limits.r2MaxParts ?? 0, "phần")} mỗi tệp. Đây là giới hạn của Cloudflare,
        không phải hạn mức của ứng dụng.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="size-3.5" aria-hidden />}
          onClick={() => void load()}
        >
          Đọc lại số liệu
        </Button>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          icon={busy ? undefined : <Wrench className="size-3.5" aria-hidden />}
          onClick={() => void runMaintenance()}
        >
          Chạy bảo trì ngay
        </Button>
        {lastMaintenance ? (
          <span className="text-[12px] text-ink-soft">
            Lần chạy vừa rồi: dọn {lastMaintenance.abortedStaleSessions} phiên bỏ dở · xử lý{" "}
            {lastMaintenance.jobsProcessed.length} việc · còn {lastMaintenance.pendingJobsRemaining}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft">
            <Loader2 className="size-3 animate-spin-slow" aria-hidden />
            Bảo trì cũng tự chạy theo Cron Trigger nếu bạn đã cấu hình.
          </span>
        )}
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-warm/80 p-3.5">
      <p className="flex items-center gap-1.5 text-[12px] text-ink-soft">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-soft">{hint}</p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "danger" | "neutral";
}) {
  const color =
    tone === "ok" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-warm/80 px-3.5 py-3">
      <dt className="text-[12px] text-ink-soft">{label}</dt>
      <dd className={`mt-0.5 text-[14px] font-medium ${color}`}>{value}</dd>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-soft">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
