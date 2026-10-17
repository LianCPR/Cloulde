import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

/**
 * Chi tiết trang trí nền rất nhẹ: vài vệt sáng hồng và một "đám mây" mờ.
 *
 * Yêu cầu: chỉ là điểm nhấn, không gây xao nhãng, không ảnh hưởng khả năng đọc,
 * và hoàn toàn đứng yên khi người dùng bật giảm chuyển động. Vì chỉ dùng
 * transform/opacity nên được xử lý trên GPU.
 */
export function CloudBackdrop() {
  const reduced = usePrefersReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Nền gradient đối xứng: Burgundy trên → Mushroom dưới */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#75000c]/12 via-cream to-cream" />
      {/* Hai quầng sáng trôi chậm, tạo cảm giác thứ tự "fade fade" */}
      <div
        className={
          reduced
            ? "absolute -left-24 -top-24 size-[26rem] rounded-full bg-[#d4cfae]/55 blur-3xl"
            : "absolute -left-24 -top-24 size-[26rem] animate-drift-slow rounded-full bg-[#d4cfae]/55 blur-3xl"
        }
      />
      <div
        className={
          reduced
            ? "absolute -right-32 top-1/3 size-[30rem] rounded-full bg-[#8d261f]/14 blur-3xl"
            : "absolute -right-32 top-1/3 size-[30rem] animate-drift rounded-full bg-[#8d261f]/14 blur-3xl"
        }
      />
      <div className="absolute bottom-0 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-[#f0e5c1]/70 blur-3xl" />
    </div>
  );
}
