import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { Images, Settings as SettingsIcon, Upload, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

const items = [
  { key: "home", to: "/", label: "Thư viện", icon: Images },
  { key: "upload", to: "/upload", label: "Tải ảnh", icon: Upload },
  { key: "settings", to: "/settings", label: "Cài đặt", icon: SettingsIcon },
  // "Tài khoản" trỏ tới /login; khi đã đăng nhập, LoginPage tự chuyển tiếp
  // sang /settings. Vì vậy key="account" được coi là khớp cả hai đường dẫn
  // để bọng kính không "lạc" sang tab Cài đặt sau khi chuyển tiếp.
  { key: "account", to: "/login", label: "Tài khoản", icon: UserRound },
] as const;

type ItemKey = (typeof items)[number]["key"];

/** Suy ra tab đang chọn từ URL khi người dùng không bấm tab trực tiếp. */
function keyFromPath(pathname: string): ItemKey | null {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/upload")) return "upload";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/login")) return "account";
  return null;
}

/**
 * Điều hướng dưới cùng trên mobile: dạng viên thuốc "liquid glass" nổi
 * (giống Instagram / iOS), bo tròn toàn bộ, hiệu ứng kính nhiều lớp.
 *
 * Bọng kính trượt tới tab vừa được BẤM (state cục bộ), không chỉ theo URL —
 * nhờ đó bấm "Tài khoản" (mà trang tự chuyển tiếp sang Cài đặt) thì bọng
 * dừng ở Tài khoản thay vì nhảy sang Cài đặt. Chuyển động dùng spring
 * có nảy (overshoot) cho cảm giác bật nảy như Instagram.
 */
export function MobileNavigation() {
  const location = useLocation();
  const [tappedKey, setTappedKey] = useState<ItemKey | null>(null);
  // URL vào thời điểm bấm: react-router cập nhật URL ở render sau, nên trong
  // 1–2 frame đầu location.pathname vẫn là URL CŨ. Nếu so khớp ngay lúc đó,
  // tab bấm tay sẽ bị coi là không khớp và bọng kính nhảy về tab cũ trước khi
  // kịp chạy sang tab mới — đúng lỗi "bấm mục khác mà nó kéo về mục cũ".
  // Giữ tab bấm tay thắng cho tới khi URL thật sự đổi đi nơi khác hẳn.
  const pathAtTapRef = useRef(location.pathname);

  const tapped = items.find((entry) => entry.key === tappedKey) ?? null;
  const urlStillAtTap = location.pathname === pathAtTapRef.current;
  const matches =
    tapped !== null &&
    (location.pathname === tapped.to ||
      (tappedKey === "account" && location.pathname === "/settings"));
  const activeKey: ItemKey | null =
    tapped !== null && (matches || urlStillAtTap) ? tappedKey : keyFromPath(location.pathname);

  return (
    <nav
      aria-label="Điều hướng dưới cùng"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden"
    >
      <ul className="liquid-glass pointer-events-auto relative mx-auto flex w-full max-w-md items-stretch justify-around rounded-full p-1.5">
        {/* Bắt sáng: quầng trắng phía trên viên thuốc, như kính thật */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
        />
        {items.map((item) => {
          const isActive = activeKey === item.key;
          return (
            <li key={item.key} className="flex-1">
              <Link
                to={item.to}
                onClick={() => {
                  pathAtTapRef.current = location.pathname;
                  setTappedKey(item.key);
                }}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-full text-[12px] font-semibold transition-colors",
                  isActive ? "text-rose-deep" : "text-ink",
                )}
              >
                <span className="relative grid size-10 place-items-center">
                  {isActive ? (
                    <motion.span
                      layoutId="mobile-nav-indicator"
                      className="absolute inset-0 rounded-full bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_10px_rgba(117,0,12,0.16)] ring-1 ring-white/70"
                      transition={{ type: "spring", stiffness: 520, damping: 20, mass: 0.9 }}
                    />
                  ) : null}
                  <item.icon className="relative size-6" strokeWidth={2.25} aria-hidden />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
