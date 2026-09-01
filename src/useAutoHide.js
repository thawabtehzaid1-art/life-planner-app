import { useState, useEffect, useRef } from "react";

// True while there's been touch/scroll/pointer activity in the last
// `delay` ms, false once things go quiet — for a floating control that
// should get out of the way when you're just reading, not touching
// anything, and reappear the instant you touch or scroll again.
export function useAutoHide(delay = 1800) {
  const [active, setActive] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    const wake = () => {
      setActive(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setActive(false), delay);
    };
    wake(); // start visible, then begin the same countdown as any real interaction
    const events = ["touchstart", "touchmove", "scroll", "pointerdown"];
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, wake));
      clearTimeout(timerRef.current);
    };
  }, [delay]);

  return active;
}
