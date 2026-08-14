import { useEffect, type ReactNode } from "react";

export default function Layout({ children, title = "ZestSend - P2P文件传输" }: { children: ReactNode; title?: string }) {
  useEffect(() => {
    document.title = title;
    if (import.meta.env.DEV) return;

    const existing = document.querySelector<HTMLScriptElement>('script[data-insightflare-site="421ced79-a0af-4305-aa51-859ae620b29e"]');
    if (existing) return;

    const analytics = document.createElement("script");
    analytics.dataset.insightflareSite = "421ced79-a0af-4305-aa51-859ae620b29e";
    analytics.src = "https://insight.ravelloh.com/script.js?siteId=421ced79-a0af-4305-aa51-859ae620b29e";
    analytics.defer = true;
    analytics.addEventListener("load", () => window.dispatchEvent(new Event("insightflare:ready")), { once: true });
    document.head.append(analytics);
  }, [title]);

  return (
    <main className="zest-viewport box-border overflow-hidden text-slate-100">{children}</main>
  );
}
