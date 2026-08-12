import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { motion, type Easing } from "framer-motion";

export interface AutoResizerProps {
  children: ReactNode;
  className?: string;
  duration?: number;
  ease?: Easing | Easing[];
  initial?: boolean;
  animateWidth?: boolean;
  animateHeight?: boolean;
}

export function AutoResizer({
  children,
  className = "",
  duration = 0.3,
  ease = "easeInOut",
  initial = false,
  animateWidth = false,
  animateHeight = true,
}: AutoResizerProps) {
  const [height, setHeight] = useState<number | "auto">(
    initial && animateHeight ? 0 : "auto",
  );
  const [width, setWidth] = useState<number | "auto">(
    initial && animateWidth ? 0 : "auto",
  );
  const [updateCount, setUpdateCount] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measureContent = (element: HTMLElement) => {
      if (animateHeight) setHeight(element.scrollHeight);
      if (animateWidth) setWidth(element.scrollWidth);
      setUpdateCount((count) => count + 1);
    };

    measureContent(content);
    const observer = new ResizeObserver(([entry]) => measureContent(entry.target as HTMLElement));
    observer.observe(content);
    return () => observer.disconnect();
  }, [animateHeight, animateWidth]);

  const shouldAnimate = initial || updateCount > 1;
  const animate: { height?: number | "auto"; width?: number | "auto" } = {};
  if (animateHeight) animate.height = height;
  if (animateWidth) animate.width = width;

  return (
    <motion.div
      animate={animate}
      className={className}
      style={{
        backgroundColor: "transparent",
        display: animateWidth ? "inline-flex" : undefined,
        overflow: "visible",
      }}
      transition={{ duration: shouldAnimate ? duration : 0, ease }}
    >
      <div
        ref={contentRef}
        style={{
          backgroundColor: "transparent",
          ...(animateWidth ? { display: "inline-block", width: "max-content" } : undefined),
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}
