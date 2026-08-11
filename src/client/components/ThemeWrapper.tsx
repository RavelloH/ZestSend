import type { ReactNode } from "react";

/** Kept as a compatibility shell for legacy component composition. */
export default function ThemeWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
