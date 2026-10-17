import { useEffect, useRef, useState } from "react";

/**
 * Vùng thông báo cho trình đọc màn hình (aria-live).
 *
 * Dùng cho tiến độ tải lên/tải xuống và các thay đổi quan trọng, để người dùng
 * không nhìn thấy màn hình vẫn biết chuyện gì đang xảy ra.
 */

type Politeness = "polite" | "assertive";
type Listener = (message: string, politeness: Politeness) => void;

const listeners = new Set<Listener>();

export function announce(message: string, politeness: Politeness = "polite"): void {
  for (const listener of listeners) listener(message, politeness);
}

export function LiveRegion() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const counter = useRef(0);

  useEffect(() => {
    const listener: Listener = (message, politeness) => {
      // Thêm hậu tố vô hình để trình đọc màn hình đọc lại cả khi nội dung trùng.
      counter.current += 1;
      const payload = `${message}\u00A0`;
      if (politeness === "assertive") setAssertive(payload);
      else setPolite(payload);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertive}
      </div>
    </>
  );
}
