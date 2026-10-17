import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Camera, Clock3, Lock } from "lucide-react";
import type { Album } from "@/types";
import { useAlbumCoverSrc } from "@/hooks/useMediaSrc";
import { PhotoThumb } from "@/components/photos/PhotoThumb";
import { formatBytes, formatRelative, photoCountLabel } from "@/lib/format";
import { staggerItem, staggerItemReduced } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

/** Thẻ album trong lưới thư viện. */
export function AlbumCard({ album, index = 0 }: { album: Album; index?: number }) {
  const cover = useAlbumCoverSrc(album);
  const reduced = usePrefersReducedMotion();

  return (
    <motion.li
      variants={reduced ? staggerItemReduced : staggerItem}
      custom={index}
      className="group list-none"
    >
      <Link
        to={`/albums/${album.id}`}
        className="block overflow-hidden rounded-3xl border border-line bg-warm/90 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-rose/30 hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose motion-reduce:hover:translate-y-0"
      >
        <div className="relative">
          <PhotoThumb
            src={cover.src}
            alt={`Ảnh bìa album ${album.title}`}
            rounding="rounded-none"
            className="aspect-[4/3]"
            fallbackLabel={album.coverPhotoId ? "Không xem trước" : undefined}
          />
          {!album.coverPhotoId ? (
            <div className="absolute inset-0 grid place-items-center bg-blush/40">
              <div className="flex flex-col items-center gap-1 text-rose-text">
                <Camera className="size-5" aria-hidden />
                <span className="text-[11px] font-medium">Chưa có ảnh</span>
              </div>
            </div>
          ) : null}
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-cloud/90 px-2.5 py-1 text-[11px] font-medium text-ink shadow-soft backdrop-blur">
            {photoCountLabel(album.photoCount)}
          </span>
        </div>

        <div className="space-y-1.5 p-4">
          <h3 className="truncate text-[15px] font-semibold text-ink">{album.title}</h3>
          {album.description ? (
            <p className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-soft">
              {album.description}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11.5px] text-ink-soft">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3" aria-hidden />
              {formatRelative(album.updatedAt)}
            </span>
            {album.totalBytes > 0 ? <span>{formatBytes(album.totalBytes)}</span> : null}
            {album.photoCount > 0 && !album.coverPhotoId ? (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" aria-hidden />
                riêng tư
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </motion.li>
  );
}
