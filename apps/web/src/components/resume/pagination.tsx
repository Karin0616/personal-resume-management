"use client";
import { useEffect, useRef } from "react";

// Let oversized entries flow across pages instead of moving an unbreakable block
// to a new page first. Ordinary entries keep break-inside: avoid.
export function Pagination() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const paper = marker.current?.closest(".resume-paper");
    if (!paper) return;
    const measure = () => {
      for (const item of paper.querySelectorAll<HTMLElement>(".resume-item")) {
        item.classList.toggle(
          "long-item",
          item.getBoundingClientRect().height > (267 * 96) / 25.4,
        );
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(paper);
    void document.fonts.ready.then(measure);
    window.addEventListener("beforeprint", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("beforeprint", measure);
    };
  }, []);
  return <span ref={marker} hidden aria-hidden="true" />;
}
