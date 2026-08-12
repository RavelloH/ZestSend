import { WebGLLiquid } from "@/components/ui/webgl-liquid";
import { useTheme } from "@/components/theme";

export function GlobalLiquidBackground() {
  const { theme } = useTheme();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ backgroundColor: theme.deep }}
    >
      <WebGLLiquid
        title=""
        subtitle=""
        description=""
        colorDeep={theme.deep}
        colorMid={theme.mid}
        colorHighlight={theme.highlight}
        speed={0.9}
        flowStrength={0.9}
        grain={0.05}
        contrast={1.2}
        opacity={0.95}
        reveal
        delayMs={0}
        className="h-full min-h-0"
      />
    </div>
  );
}
