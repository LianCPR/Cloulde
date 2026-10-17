import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  ChevronDown,
  HardDrive,
  Images,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/context/AuthContext";
import { Wordmark } from "./Wordmark";
import { Button } from "@/components/ui/Button";
import { formatBytes } from "@/lib/format";
import { getBackend, isArchiveMode } from "@/services/backend";

/** Thanh điều hướng trên cùng: gọn trên mobile, đầy đủ trên desktop. */
export function AppHeader({
  onToggleSidebar,
  sidebarOpen,
  guest = false,
}: {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  /**
   * Đang ở trang của KHÁCH (liên kết chia sẻ).
   *
   * Khách không đăng nhập và cũng không kết nối kho lưu trữ, nên thanh này chỉ
   * còn logo và một lối vào cho chủ kho. Điều hướng tới Thư viện/Cài đặt và nhãn
   * loại kho đều là thông tin của chủ kho — hiển thị chúng ở đây chỉ làm khách
   * tưởng mình đang thiếu quyền.
   */
  guest?: boolean;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!user || !menuOpen) return;
    let active = true;
    void getBackend()
      .usage.getUsage()
      .then((result) => {
        if (active) setUsage(result.usedBytes);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [menuOpen, user]);

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 frosted">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:h-16 sm:px-6">
        {onToggleSidebar ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Ẩn thanh bên" : "Hiện thanh bên"}
            aria-expanded={sidebarOpen}
            className="mr-1 hidden size-9 place-items-center rounded-full text-ink-soft transition-colors hover:bg-blush hover:text-ink lg:grid"
          >
            <Menu className="size-4" aria-hidden />
          </button>
        ) : null}

        <Link
          to="/"
          className="flex items-center rounded-full px-1 py-1 transition-opacity hover:opacity-80"
          aria-label="Cloudey — về trang thư viện"
        >
          <Wordmark />
        </Link>

        {guest ? null : (
          <nav aria-label="Điều hướng chính" className="ml-4 hidden items-center gap-1 md:flex">
            <HeaderLink to="/" icon={<Images className="size-4" aria-hidden />} label="Thư viện" exact />
            <HeaderLink
              to="/settings"
              icon={<SettingsIcon className="size-4" aria-hidden />}
              label="Cài đặt"
            />
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/*
           * Nhãn này chỉ được hiện khi THỰC SỰ đang chạy backend cục bộ.
           * Trước đây điều kiện là `!isSupabaseMode()`, nên chế độ kho lưu trữ
           * (R2 — nơi dữ liệu nằm trên hạ tầng thật) bị gắn nhầm nhãn "demo
           * cục bộ". Nhãn sai làm người dùng hiểu sai nơi dữ liệu của họ nằm.
           */}
          {guest ? null : getBackend().mode === "local" ? (
            <span className="hidden rounded-full bg-beige/70 px-3 py-1 text-[11.5px] font-medium text-ink-soft sm:inline-flex">
              Chế độ demo cục bộ
            </span>
          ) : isArchiveMode() ? (
            <span className="hidden rounded-full bg-beige/70 px-3 py-1 text-[11.5px] font-medium text-ink-soft sm:inline-flex">
              Kho Cloudflare R2
            </span>
          ) : null}

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 rounded-full border border-line bg-warm px-2.5 py-1.5 text-sm transition-colors hover:border-rose/40"
              >
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-full bg-pastel text-[11px] font-semibold text-rose-text"
                >
                  {(user.displayName ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-[10rem] truncate text-[13px] text-ink sm:inline">
                  {user.displayName || user.email}
                </span>
                <ChevronDown className="size-3.5 text-ink-soft" aria-hidden />
              </button>

              {menuOpen ? (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.16 }}
                  className="absolute right-0 top-[calc(100%+8px)] w-60 overflow-hidden rounded-2xl border border-line bg-cloud p-1.5 shadow-float"
                >
                  <div className="px-3 py-2">
                    <p className="truncate text-[13px] font-medium">{user.email}</p>
                    {usage !== null ? (
                      <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-soft">
                        <HardDrive className="size-3.5" aria-hidden />
                        Đã dùng {formatBytes(usage)}
                      </p>
                    ) : null}
                  </div>
                  <div className="my-1 h-px bg-line" />
                  <Link
                    to="/settings"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-colors hover:bg-blush"
                  >
                    <SettingsIcon className="size-4 text-ink-soft" aria-hidden />
                    Cài đặt & dung lượng
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      setMenuOpen(false);
                      await signOut();
                      navigate("/login");
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-blush"
                  >
                    <LogOut className="size-4 text-ink-soft" aria-hidden />
                    Đăng xuất
                  </button>
                </motion.div>
              ) : null}
            </div>
          ) : guest ? (
            <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
              Đăng nhập
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => navigate("/login")}
              >
                Đăng nhập
              </Button>
              <Button
                size="sm"
                icon={<Upload className="size-3.5" aria-hidden />}
                onClick={() => navigate("/signup")}
              >
                Tạo tài khoản
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderLink({
  to,
  label,
  icon,
  exact,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2 rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors",
          isActive ? "text-rose-text" : "text-ink-soft hover:bg-blush/70 hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          {icon}
          {label}
          {isActive ? (
            <motion.span
              layoutId="header-indicator"
              className="absolute inset-0 -z-10 rounded-full bg-pastel/80"
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}
