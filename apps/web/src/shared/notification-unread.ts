import { useSyncExternalStore } from "react";

let unread = 0;
const listeners = new Set<() => void>();
export function publishNotificationUnread(count: number) {
  if (unread === count) return;
  unread = count;
  for (const listener of listeners) listener();
}
export function useNotificationUnread() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => unread,
  );
}
