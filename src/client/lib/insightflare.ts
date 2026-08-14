type InsightEventValue = boolean | number | string | null | undefined;
type InsightEventData = Record<string, InsightEventValue>;

type InsightFlareApi = {
  track: (eventName: string, eventData?: InsightEventData) => void;
  trackOnce: (eventName: string, eventData?: InsightEventData) => void;
};

type PendingEvent = {
  data?: InsightEventData;
  name: string;
  once: boolean;
};

declare global {
  interface Window {
    insightflare?: InsightFlareApi;
  }
}

const pendingEvents: PendingEvent[] = [];

function flushPendingEvents() {
  const analytics = window.insightflare;
  if (!analytics) return;
  for (const event of pendingEvents.splice(0)) {
    if (event.once) analytics.trackOnce(event.name, event.data);
    else analytics.track(event.name, event.data);
  }
}

if (typeof window !== "undefined") window.addEventListener("insightflare:ready", flushPendingEvents);

function report(name: string, data: InsightEventData | undefined, once: boolean) {
  if (import.meta.env.DEV || typeof window === "undefined") return;
  const analytics = window.insightflare;
  if (analytics) {
    if (once) analytics.trackOnce(name, data);
    else analytics.track(name, data);
    return;
  }
  if (pendingEvents.length < 40) pendingEvents.push({ data, name, once });
}

export function trackInsightEvent(name: string, data?: InsightEventData) {
  report(name, data, false);
}

export function trackInsightEventOnce(name: string, data?: InsightEventData) {
  report(name, data, true);
}
