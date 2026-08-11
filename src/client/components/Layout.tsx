import { useEffect, type ReactNode } from "react";

export default function Layout({ children, title = "ZestSend - P2P文件传输" }: { children: ReactNode; title?: string }) {
  useEffect(() => {
    document.title = title;
    if (import.meta.env.DEV) return;

    const analytics = document.createElement("script");
    analytics.src = "https://insight.ravelloh.com/script.js?siteId=421ced79-a0af-4305-aa51-859ae620b29e";
    analytics.defer = true;
    document.head.append(analytics);
    return () => analytics.remove();
  }, [title]);

  return (
    <main className="min-h-screen text-slate-100">{children}</main>
  );
}
