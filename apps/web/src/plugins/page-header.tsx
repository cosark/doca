import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./page-header.css";

export interface PluginPageHeaderProps {
  title: ReactNode;
  actions: ReactNode;
}

/** The host owns the shell targets; plugins only supply their React content. */
export function PluginPageHeader({ title, actions }: PluginPageHeaderProps) {
  const [slots, setSlots] = useState<{ title: HTMLElement; actions: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const title = document.getElementById("plugin-page-header-title");
    const actions = document.getElementById("plugin-page-header-actions");
    if (title && actions) setSlots({ title, actions });
  }, []);
  return slots ? <>{createPortal(title, slots.title)}{createPortal(actions, slots.actions)}</> : null;
}
