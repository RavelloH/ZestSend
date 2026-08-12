import { useEffect } from "react";
import { OverlayScrollbars } from "overlayscrollbars";

import {
  prepareNativeScrollbarHost,
  shouldUseNativeScrollbars,
  VERTICAL_SCROLLBAR_OPTIONS,
} from "./ui/overlay-scrollbar";

export function GlobalScrollbars() {
  useEffect(() => {
    if (shouldUseNativeScrollbars()) {
      prepareNativeScrollbarHost(document.documentElement);
      prepareNativeScrollbarHost(document.body);
      document.documentElement.dataset.nativeScrollbars = "true";
      return () => {
        delete document.documentElement.dataset.nativeScrollbars;
      };
    }

    const existing = OverlayScrollbars(document.body);
    const instance = existing ?? OverlayScrollbars(document.body, VERTICAL_SCROLLBAR_OPTIONS);
    if (existing) existing.options(VERTICAL_SCROLLBAR_OPTIONS);

    return () => {
      if (!existing) instance.destroy();
    };
  }, []);

  return null;
}
