import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { OverlayScrollbars, type PartialOptions } from "overlayscrollbars";

import { cn } from "@/lib/utils";

export const VERTICAL_SCROLLBAR_OPTIONS = {
  overflow: {
    x: "hidden",
    y: "scroll",
  },
  scrollbars: {
    theme: "os-theme-zestsend",
    autoHide: "move",
    autoHideDelay: 420,
    autoHideSuspend: false,
  },
} satisfies PartialOptions;

export function shouldUseNativeScrollbars(): boolean {
  if (typeof navigator === "undefined") return false;

  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform || navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  const isApplePlatform = /Mac|iPhone|iPad|iPod/i.test(platform) || /iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && /Apple/i.test(vendor) && !/Android|Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Opera/i.test(userAgent);

  return isApplePlatform || isSafari;
}

export function prepareNativeScrollbarHost(host: HTMLElement): boolean {
  if (!shouldUseNativeScrollbars()) return false;
  host.removeAttribute("data-overlayscrollbars-initialize");
  return true;
}

type OverlayScrollbarProps = ComponentPropsWithoutRef<"div"> & {
  options?: PartialOptions;
  syncKey?: string | number | boolean | null;
};

export function OverlayScrollbar({
  children,
  className,
  options = VERTICAL_SCROLLBAR_OPTIONS,
  syncKey,
  ...props
}: OverlayScrollbarProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ReturnType<typeof OverlayScrollbars> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const viewport = viewportRef.current;
    if (!host || !viewport || prepareNativeScrollbarHost(host)) return;

    const existing = OverlayScrollbars(host);
    const instance = existing ?? OverlayScrollbars({
      target: host,
      elements: {
        content: false,
        padding: false,
        viewport,
      },
    }, options);
    if (existing) existing.options(options);
    instanceRef.current = instance;

    return () => {
      if (!existing) instance.destroy();
      if (instanceRef.current === instance) instanceRef.current = null;
    };
  }, [options]);

  useEffect(() => {
    instanceRef.current?.update(true);
  }, [syncKey]);

  return (
    <div
      {...props}
      ref={hostRef}
      className={cn("overflow-y-auto", className)}
      data-overlayscrollbars-initialize=""
    >
      <div className="h-full min-h-full" ref={viewportRef}>
        {children}
      </div>
    </div>
  );
}
