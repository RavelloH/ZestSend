import Layout from "../components/Layout";
import { CursorDrivenParticleTypography } from "../components/ui/cursor-driven-particle-typography";

export default function NotFound() {
  return (
    <Layout title="ZestSend — 404">
      <main
        aria-label="Page not found. Click anywhere to return home."
        className="flex h-full min-h-0 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden px-4 sm:gap-5"
        onClick={() => window.location.assign("/")}
        role="button"
        tabIndex={0}
      >
        <h1 className="sr-only">ZestSend 404</h1>
        <CursorDrivenParticleTypography
          aria-hidden="true"
          className="h-[min(30vw,15rem)] min-h-0 max-w-5xl"
          color="#d9f4ff"
          fontFamily="Aptos Display, Segoe UI, sans-serif"
          fontSize={180}
          particleDensity={2}
          particleSize={1}
          text="ZestSend"
        />
        <CursorDrivenParticleTypography
          aria-hidden="true"
          className="h-[min(22vw,10rem)] min-h-0 max-w-3xl"
          color="#d9f4ff"
          fontFamily="Aptos Display, Segoe UI, sans-serif"
          fontSize={120}
          particleDensity={2}
          particleSize={1}
          text="404"
        />
      </main>
    </Layout>
  );
}
