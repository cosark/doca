import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Keep comments beside the host's whole scrollable document, including its
 * discussion footer. Editor models and SDK components stay in their own tree. */
export function CommentSidebar({ open, children, readyChanged }: { open: boolean; children: ReactNode; readyChanged(ready: boolean): void }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const host = marker.current?.closest(".ai-document-main");
    if (!host) return;
    const element = document.createElement("div");
    element.className = "document-comment-dock";
    host.append(element);
    setDock(element);
    return () => { setDock(null); element.remove(); };
  }, [open]);
  useLayoutEffect(() => {
    readyChanged(!!dock);
    return () => readyChanged(false);
  }, [dock, readyChanged]);
  return <><span ref={marker} hidden />{open && dock && createPortal(children, dock)}</>;
}
