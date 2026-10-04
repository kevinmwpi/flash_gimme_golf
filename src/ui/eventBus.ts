// OWNER: ui
/** SimEvent fan-out from GameCanvas.onEvents to React (Callouts subscribes). ARCH.md §1.13. */
import type { SimEvent } from '../sim/types';

export type EventBus = {
  push(events: readonly SimEvent[]): void;
  subscribe(fn: (e: SimEvent) => void): () => void;
};

export function createEventBus(): EventBus {
  const subscribers = new Set<(e: SimEvent) => void>();
  return {
    push(events) {
      for (const e of events) for (const fn of subscribers) fn(e);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
