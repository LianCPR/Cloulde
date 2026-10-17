import { cn } from "@/lib/cn";

/**
 * Wordmark của Cloudey — dùng font LHanoienne (tệp người dùng cung cấp).
 * LHanoienne là font display Latin: các ký tự tiếng Việt không có trong font sẽ
 * tự động rơi xuống Playfair Display / serif hệ thống theo từng glyph, nên chữ
 * có dấu vẫn hiển thị đẹp và không bao giờ biến thành ô trống.
 */
export function Wordmark({
  className,
  showDot = true,
}: {
  className?: string;
  showDot?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-0.5", className)}>
      <span className="font-display text-[22px] leading-none tracking-tight text-ink">
        Cloudey
      </span>
      {showDot ? (
        <span aria-hidden className="size-1.5 rounded-full bg-rose" />
      ) : null}
    </span>
  );
}
