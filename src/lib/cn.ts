import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Gộp class Tailwind, xử lý xung đột theo thứ tự sau cùng thắng. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
