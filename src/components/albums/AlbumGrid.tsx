import { motion } from "motion/react";
import type { Album } from "@/types";
import { AlbumCard } from "./AlbumCard";
import { AlbumGridSkeleton } from "@/components/ui/Skeleton";
import { staggerContainer } from "@/lib/motion";

/**
 * Lưới album: 2 cột trên mobile (theo yêu cầu thiết kế), nhiều cột hơn khi
 * màn hình rộng ra. Mỗi thẻ xuất hiện lần lượt (stagger) để mắt bám theo được.
 */
export function AlbumGrid({
  albums,
  loading,
  skeletonCount = 6,
}: {
  albums: Album[];
  loading?: boolean;
  skeletonCount?: number;
}) {
  if (loading) return <AlbumGridSkeleton count={skeletonCount} />;

  return (
    <motion.ul
      variants={staggerContainer(0.05)}
      initial="initial"
      animate="animate"
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4"
    >
      {albums.map((album, index) => (
        <AlbumCard key={album.id} album={album} index={index} />
      ))}
    </motion.ul>
  );
}
