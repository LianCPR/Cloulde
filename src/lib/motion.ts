import type { Transition, Variants } from "motion/react";

/**
 * Nguyên tắc chuyển động của Cloudey:
 *  - Chỉ animate `transform` và `opacity` để không gây layout shift.
 *  - Không quá 420ms cho điều hướng; không chặn thao tác tải xuống.
 *  - Tôn trọng `prefers-reduced-motion`: mọi biến thể đều có bản "tĩnh".
 */

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_SOFT: [number, number, number, number] = [0.4, 0, 0.2, 1];

export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 0.7,
};

export const tweenSoft: Transition = { duration: 0.28, ease: EASE_OUT };

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18, ease: EASE_SOFT } },
};

export const pageVariantsReduced: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } },
};

export const staggerContainer = (stagger = 0.045, delay = 0.02): Variants => ({
  initial: {},
  animate: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.42, ease: EASE_OUT },
  },
};

export const staggerItemReduced: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.01 } },
};

export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: EASE_SOFT } },
};

export const dialogVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.26, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 8,
    transition: { duration: 0.16, ease: EASE_SOFT },
  },
};

export const sheetVariants: Variants = {
  initial: { y: "100%" },
  animate: { y: 0, transition: springSoft },
  exit: { y: "100%", transition: { duration: 0.22, ease: EASE_SOFT } },
};

export const toolbarVariants: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: 24, transition: { duration: 0.18, ease: EASE_SOFT } },
};

/** Biến thể tối giản khi người dùng bật giảm chuyển động. */
export const staticVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } },
};

export function pickVariants(
  reduced: boolean | null | undefined,
  normal: Variants,
): Variants {
  return reduced ? staticVariants : normal;
}
