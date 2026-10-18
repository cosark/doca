import { useCallback, useLayoutEffect, useRef } from "react";

type AnchorRect = Pick<DOMRect, "left" | "top" | "bottom">;
const margin = 8;
const gap = 6;
const menuHeight = 280;

export function mentionMenuPosition(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const below = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const onTop = size.height > below && above > below;
  const maxHeight = Math.min(menuHeight, onTop ? above : below);
  return {
    left: Math.max(
      margin,
      Math.min(anchor.left, viewport.width - size.width - margin),
    ),
    top: onTop
      ? anchor.top - gap - Math.min(size.height, maxHeight)
      : anchor.bottom + gap,
    maxHeight,
  };
}

/** Measure the whole picker, then keep it on one side of the editing area. */
export function useMentionMenuPosition(
  open: boolean,
  getAnchor: () => AnchorRect | null,
) {
  const menu = useRef<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    menu.current = element;
  }, []);
  useLayoutEffect(() => {
    const panel = menu.current;
    if (!open || !panel) return;
    const update = () => {
      const anchor = getAnchor();
      if (!anchor) {
        panel.style.visibility = "hidden";
        return;
      }
      // Restore the natural capped height before measuring after a previous
      // constrained placement or an asynchronous directory result.
      panel.style.maxHeight = `${menuHeight}px`;
      const rect = panel.getBoundingClientRect();
      const position = mentionMenuPosition(anchor, rect, {
        width: innerWidth,
        height: innerHeight,
      });
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
      panel.style.maxHeight = `${position.maxHeight}px`;
      panel.style.visibility = "visible";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      update();
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", scroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, getAnchor]);
  return ref;
}
