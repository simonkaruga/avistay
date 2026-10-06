import { useState, useEffect, useRef } from "react";

export function useCountUp(target: number, duration = 1800) {
  const [count, setCount]  = useState(0);
  const containerRef       = useRef<HTMLDivElement>(null);
  const started            = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;

      const startTs = performance.now();
      function tick(now: number) {
        const p     = Math.min((now - startTs) / duration, 1);
        const eased = 1 - (1 - p) ** 3; // ease-out-cubic
        setCount(Math.round(eased * target));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });

    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration]);

  return { count, ref: containerRef };
}
