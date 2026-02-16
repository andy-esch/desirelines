import { useState, useEffect } from "react";

/**
 * Returns true when the page or a specific element has been scrolled past the given threshold.
 */
export function useScrolled(
  threshold = 4,
  elementRef?: React.RefObject<HTMLElement | null>
): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = elementRef?.current ? elementRef.current.scrollTop : window.scrollY;
      setScrolled(scrollY > threshold);
    };

    const target = elementRef?.current || window;

    // Check initial state
    handleScroll();

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => target.removeEventListener("scroll", handleScroll);
  }, [threshold, elementRef?.current]);

  return scrolled;
}
