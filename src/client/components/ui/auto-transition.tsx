import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AnimatePresence,
  motion,
  type TargetAndTransition,
} from "framer-motion";

export type TransitionType = "fade" | "slide" | "scale" | "slideUp" | "slideDown";

export interface AutoTransitionProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "children" | "className"
> {
  children: React.ReactNode;
  as?: "div" | "g" | "span" | "tbody";
  className?: string;
  duration?: number;
  type?: TransitionType;
  initial?: boolean;
  custom?: unknown;
  transitionKey?: string | number;
  presenceMode?: "sync" | "wait" | "popLayout";
  customVariants?: {
    initial?: TargetAndTransition | ((custom: unknown) => TargetAndTransition);
    animate?: TargetAndTransition | ((custom: unknown) => TargetAndTransition);
    exit?: TargetAndTransition | ((custom: unknown) => TargetAndTransition);
  };
}

const transitionVariants: Record<
  TransitionType,
  {
    initial: TargetAndTransition;
    animate: TargetAndTransition;
    exit: TargetAndTransition;
  }
> = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  slide: {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 20 },
  },
  slideUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  },
  slideDown: {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 20 },
  },
  scale: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },
};

export function AutoTransition({
  children,
  as = "div",
  className = "",
  duration = 0.3,
  type = "fade",
  initial = true,
  custom,
  transitionKey,
  presenceMode = "wait",
  customVariants,
  ...motionProps
}: AutoTransitionProps) {
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    if (!hasRendered) setHasRendered(true);
  }, [hasRendered]);

  const key = useMemo(() => {
    if (transitionKey !== undefined) return String(transitionKey);
    if (!children) return "empty";

    const firstChild = React.Children.toArray(children)[0];
    if (React.isValidElement(firstChild) && firstChild.key) return String(firstChild.key);
    if (React.isValidElement(firstChild) && typeof firstChild.type === "string") {
      return firstChild.type;
    }

    return typeof firstChild === "string" || typeof firstChild === "number"
      ? String(firstChild)
      : "node";
  }, [children, transitionKey]);

  const MotionComponent = (
    as === "g" ? motion.g : as === "span" ? motion.span : as === "tbody" ? motion.tbody : motion.div
  ) as React.ElementType;

  return (
    <AnimatePresence mode={presenceMode} custom={custom}>
      <MotionComponent
        {...motionProps}
        key={key}
        className={className}
        custom={custom}
        variants={customVariants || transitionVariants[type]}
        initial={initial || hasRendered ? "initial" : false}
        animate="animate"
        exit="exit"
        transition={{ duration }}
      >
        {children}
      </MotionComponent>
    </AnimatePresence>
  );
}
