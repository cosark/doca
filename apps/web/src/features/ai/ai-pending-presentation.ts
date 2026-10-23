/** A message belongs to the timeline or the waiting queue, never both.
 * This only projects UI state; the durable recovery copy is left untouched.
 */
export function waitingPendingItems<T extends { id: string }>(
  items: readonly T[],
  messages: readonly {
    id: string;
    delivery?: "sending" | "queued" | "failed";
  }[],
): T[] {
  const represented = new Set(
    messages
      .filter((message) => message.delivery !== "queued")
      .map((message) => message.id),
  );
  return items.filter((item) => !represented.has(item.id));
}
