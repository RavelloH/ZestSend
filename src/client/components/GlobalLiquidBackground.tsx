import { WebGLLiquid } from "@/components/ui/webgl-liquid";

export function GlobalLiquidBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#02040b]">
      <WebGLLiquid
        title=""
        subtitle=""
        description=""
        colorDeep="#02040b"
        colorMid="#11315e"
        colorHighlight="#67d5ff"
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
