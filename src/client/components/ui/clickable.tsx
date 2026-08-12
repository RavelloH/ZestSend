import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { forwardRef } from "react";
import { type HTMLMotionProps, motion } from "framer-motion";

import { cn } from "@/lib/utils";

interface ClickableProps extends Omit<
  HTMLMotionProps<"div">,
  "children" | "onClick" | "onKeyDown"
> {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
  disabled?: boolean;
  enableHoverScale?: boolean;
  hoverScale?: number;
  tapScale?: number;
  duration?: number;
  "aria-label"?: string;
}

export const Clickable = forwardRef<HTMLDivElement, ClickableProps>(
  (
    {
      children,
      onClick,
      className,
      disabled = false,
      enableHoverScale = true,
      hoverScale = 1.16,
      tapScale = 0.94,
      duration = 0.16,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
      if (!disabled) onClick?.(event);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick?.(event as unknown as MouseEvent<HTMLDivElement>);
      }
    };

    return (
      <motion.div
        ref={ref}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex select-none items-center justify-center rounded-none outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          className,
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={disabled ? -1 : 0}
        transition={{ duration, ease: "easeOut" }}
        whileHover={!disabled && enableHoverScale ? { scale: hoverScale } : undefined}
        whileTap={!disabled ? { scale: tapScale } : undefined}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);

Clickable.displayName = "Clickable";
