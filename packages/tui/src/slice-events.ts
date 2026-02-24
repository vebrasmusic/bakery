import type { ListSlicesResponse } from "@bakery/shared";

export type ExternalSliceEvent = "created" | "removed" | "status-changed";

export interface SliceSnapshot {
  id: string;
  pieId: string;
  host: string;
  status: ListSlicesResponse["slices"][number]["status"];
}

export interface SliceLifecycleEvent {
  event: ExternalSliceEvent;
  sliceId: string;
  pieId: string;
  host: string;
  status: ListSlicesResponse["slices"][number]["status"];
  previousStatus?: ListSlicesResponse["slices"][number]["status"];
}

export function toSliceEventKey(event: SliceLifecycleEvent): string {
  if (event.event === "status-changed") {
    return `${event.event}:${event.sliceId}:${event.status}`;
  }
  return `${event.event}:${event.sliceId}`;
}

function toMap(slices: SliceSnapshot[]): Map<string, SliceSnapshot> {
  return new Map(slices.map((slice) => [slice.id, slice]));
}

export function buildSliceSnapshots(slices: ListSlicesResponse["slices"]): SliceSnapshot[] {
  return slices.map((slice) => ({
    id: slice.id,
    pieId: slice.pieId,
    host: slice.host,
    status: slice.status
  }));
}

export function detectSliceLifecycleEvents(previous: SliceSnapshot[], next: SliceSnapshot[]): SliceLifecycleEvent[] {
  const previousById = toMap(previous);
  const nextById = toMap(next);
  const events: SliceLifecycleEvent[] = [];

  for (const slice of next) {
    const previousSlice = previousById.get(slice.id);
    if (!previousSlice) {
      events.push({
        event: "created",
        sliceId: slice.id,
        pieId: slice.pieId,
        host: slice.host,
        status: slice.status
      });
      continue;
    }

    if (previousSlice.status !== slice.status) {
      events.push({
        event: "status-changed",
        sliceId: slice.id,
        pieId: slice.pieId,
        host: slice.host,
        status: slice.status,
        previousStatus: previousSlice.status
      });
    }
  }

  for (const slice of previous) {
    if (!nextById.has(slice.id)) {
      events.push({
        event: "removed",
        sliceId: slice.id,
        pieId: slice.pieId,
        host: slice.host,
        status: slice.status
      });
    }
  }

  return events;
}

export function filterSuppressedSliceEvents(
  events: SliceLifecycleEvent[],
  suppressions: Map<string, number>,
  now = Date.now()
): SliceLifecycleEvent[] {
  for (const [key, expiresAt] of suppressions) {
    if (expiresAt <= now) {
      suppressions.delete(key);
    }
  }

  const visibleEvents: SliceLifecycleEvent[] = [];
  for (const event of events) {
    const key = toSliceEventKey(event);
    const expiresAt = suppressions.get(key);
    if (expiresAt !== undefined && expiresAt > now) {
      suppressions.delete(key);
      continue;
    }
    visibleEvents.push(event);
  }
  return visibleEvents;
}
