import { cn } from "@/lib/cn";

/** Khối xương (skeleton) có nhịp thở nhẹ, không gây mỏi mắt. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-2xl bg-gradient-to-br from-blush/80 via-pastel/60 to-blush/70",
        className,
      )}
    />
  );
}

export function AlbumCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-warm">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-4 w-3/5 rounded-full" />
        <Skeleton className="h-3 w-2/5 rounded-full" />
      </div>
    </div>
  );
}

export function AlbumGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <AlbumCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function PhotoGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="aspect-square rounded-2xl" />
      ))}
    </div>
  );
}
