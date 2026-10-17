import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { FolderOpen, HardDrive, Images, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { albumService } from "@/services/albumService";
import { getBackend } from "@/services/backend";
import { formatBytes, formatRelative } from "@/lib/format";
import type { Album, StorageUsage } from "@/types";
import { useAuth } from "@/context/AuthContext";

/**
 * Thanh bên trên desktop (có thể thu gọn).
 * Hiển thị điều hướng, album gần đây và tình trạng dung lượng.
 */
export function Sidebar({ open }: { open: boolean }) {
  const { user } = useAuth();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  useEffect(() => {
    if (!user) {
      setAlbums([]);
      setUsage(null);
      return;
    }
    let active = true;
    void albumService
      .listRecent(8)
      .then((result) => {
        if (active) setAlbums(result);
      })
      .catch(() => undefined);
    void getBackend()
      .usage.getUsage()
      .then((result) => {
        if (active) setUsage(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user]);

  const mode = getBackend().mode;

  return (
    <motion.aside
      aria-label="Thanh điều hướng bên"
      initial={false}
      animate={{ width: open ? 260 : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 overflow-hidden border-r border-line/70 lg:block",
        !open && "pointer-events-none border-r-0",
      )}
    >
      <div className="flex h-full w-[260px] flex-col gap-5 overflow-y-auto px-4 py-5">
        <nav aria-label="Điều hướng bên">
          <ul className="space-y-1">
            <SidebarLink to="/" icon={<Images className="size-4" aria-hidden />} label="Thư viện album" exact />
            <SidebarLink
              to="/settings"
              icon={<SettingsIcon className="size-4" aria-hidden />}
              label="Cài đặt"
            />
          </ul>
        </nav>

        {user ? (
          <>
            <section>
              <h2 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Album gần đây
              </h2>
              {albums.length === 0 ? (
                <p className="mt-2 px-3 text-[12.5px] text-ink-soft">
                  Chưa có album nào. Hãy tạo album đầu tiên của bạn.
                </p>
              ) : (
                <ul className="mt-2 space-y-0.5">
                  {albums.map((album) => (
                    <li key={album.id}>
                      <NavLink
                        to={`/albums/${album.id}`}
                        className={({ isActive }) =>
                          cn(
                            "flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] transition-colors",
                            isActive ? "bg-pastel/70 text-rose-text" : "hover:bg-blush/70",
                          )
                        }
                      >
                        <FolderOpen className="mt-0.5 size-3.5 shrink-0 text-ink-soft" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{album.title}</span>
                          <span className="block text-[11.5px] text-ink-soft">
                            {album.photoCount} ảnh · {formatRelative(album.updatedAt)}
                          </span>
                        </span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {usage ? (
              <section className="mt-auto rounded-2xl border border-line bg-warm/80 p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                  <HardDrive className="size-3.5 text-ink-soft" aria-hidden />
                  Dung lượng
                </p>
                <p className="mt-1 text-[12px] text-ink-soft">
                  {formatBytes(usage.usedBytes)} · {usage.photoCount} ảnh
                </p>
                {usage.quotaBytes ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-rose"
                      style={{
                        width: `${Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100).toFixed(1)}%`,
                      }}
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            <p className="flex items-start gap-1.5 px-1 text-[11.5px] leading-relaxed text-ink-soft">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {mode === "supabase"
                ? "Ảnh của bạn được bảo vệ bằng Row Level Security."
                : "Chế độ demo: dữ liệu chỉ nằm trong trình duyệt này."}
            </p>
          </>
        ) : null}
      </div>
    </motion.aside>
  );
}

function SidebarLink({
  to,
  icon,
  label,
  exact,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  exact?: boolean;
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={exact}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-[13.5px] font-medium transition-colors",
            isActive ? "bg-pastel/80 text-rose-text" : "text-ink-soft hover:bg-blush/70 hover:text-ink",
          )
        }
      >
        {icon}
        {label}
      </NavLink>
    </li>
  );
}
