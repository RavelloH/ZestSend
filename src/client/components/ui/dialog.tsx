import { X } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, type HTMLMotionProps, motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { OverlayScrollbar } from "./overlay-scrollbar";

type DialogContextValue = {
  onOpenChange: (open: boolean) => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error("Dialog components must be used within Dialog.");
  return context;
}

export function Dialog({
  children,
  onOpenChange,
  open,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const layerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = layerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      layerRef.current?.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [close, open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogContext.Provider value={{ onOpenChange }}>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={layerRef}
            animate={{ opacity: 1 }}
            aria-label="Dialog overlay"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm sm:p-8"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </DialogContext.Provider>,
    document.body,
  );
}

export const DialogContent = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  ({ className, children, ...props }, ref) => (
    <motion.div
      ref={ref}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className={cn(
        "glass zest-dialog-content flex w-full max-w-3xl flex-col overflow-hidden rounded-lg text-gray-100",
        className,
      )}
      exit={{ opacity: 0, scale: 0.98, y: 18 }}
      initial={{ opacity: 0, scale: 0.98, y: 18 }}
      role="dialog"
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
      {...props}
    >
      <OverlayScrollbar className="min-h-0 flex-1 overscroll-contain">{children as ReactNode}</OverlayScrollbar>
    </motion.div>
  ),
);

DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-6 border-b border-white/[0.1] p-6 sm:p-9", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-2xl font-bold tracking-[0.04em] text-sky-50 sm:text-3xl", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-2 text-sm font-medium tracking-[0.05em] text-sky-100/60 sm:text-base", className)} {...props} />;
}

export const DialogClose = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, onClick, "aria-label": ariaLabel, ...props }, ref) => {
    const { onOpenChange } = useDialog();

    return (
      <button
        ref={ref}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-white/[0.1] bg-transparent text-sky-100/75 transition-colors hover:bg-white/[0.05] hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onOpenChange(false);
        }}
        type="button"
        {...props}
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    );
  },
);

DialogClose.displayName = "DialogClose";
