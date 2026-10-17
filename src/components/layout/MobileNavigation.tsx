import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { Images, Settings as SettingsIcon, Upload, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

const items = [
  { to: "/", label: "Thư viện", icon: Images, exact: true },
  { to: "/upload", label: "Tải ảnh", icon: Upload, exact: true },
  { to: "/settings", label: "Cài đặt", icon: SettingsIcon, exact: false },
] as const;

/**
 * Điều hướng dưới cùng trên mobile: vùng chạm ≥ 48px, có hỗ trợ vùng an toàn
 * của iPhone (safe-area-inset-bottom) để không bị thanh home che.
 */
export function MobileNavigation() {
  return (
    <nav
      aria-label="Điều hướng dưới cùng"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 pb-safe frosted-strong md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition-colors",
                  isActive ? "text-rose-text" : "text-ink-soft",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative grid size-9 place-items-center">
                    {isActive ? (
                      <motion.span
                        layoutId="mobile-nav-indicator"
                        className="absolute inset-0 rounded-full bg-pastel/90"
                        transition={{ type: "spring", stiffness: 400, damping: 34 }}
                      />
                    ) : null}
                    <item.icon className="relative size-[18px]" aria-hidden />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <NavLink
            to="/login"
            className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium text-ink-soft"
          >
            <span className="grid size-9 place-items-center">
              <UserRound className="size-[18px]" aria-hidden />
            </span>
            Tài khoản
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
