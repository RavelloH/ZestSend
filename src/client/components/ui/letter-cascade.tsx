"use client";

import { cn } from "@/lib/utils";
import {
    type DynamicAnimationOptions,
    motion,
    stagger,
    useAnimate,
} from "framer-motion";
import { useCallback, useState } from "react";

interface LetterCascadeProps {
    /** The text to animate */
    text: string;
    /** Additional CSS classes for the container */
    className?: string;
    /** CSS classes applied to each individual letter */
    letterClassName?: string;
    /** Stagger delay between each letter in seconds */
    staggerDuration?: number;
    /** Where the stagger wave originates */
    staggerFrom?: "first" | "last" | "center" | number;
    /** Spring stiffness — higher = snappier */
    stiffness?: number;
    /** Spring damping — lower = bouncier */
    damping?: number;
    /** Trigger the animation on click instead of hover */
    triggerOnClick?: boolean;
    /** Callback when the full animation cycle completes */
    onComplete?: () => void;
}

export function LetterCascade({
    text,
    className,
    letterClassName,
    staggerDuration = 0.04,
    staggerFrom = "first",
    stiffness = 220,
    damping = 16,
    triggerOnClick = false,
    onComplete,
}: LetterCascadeProps) {
    const [scope, animate] = useAnimate();
    const [blocked, setBlocked] = useState(false);

    const trigger = useCallback(() => {
        if (blocked) return;
        setBlocked(true);

        const merge = (base: DynamicAnimationOptions): DynamicAnimationOptions => ({
            ...base,
            delay: stagger(staggerDuration, { from: staggerFrom }),
        });

        const spring: DynamicAnimationOptions = {
            type: "spring",
            stiffness,
            damping,
        };

        // ── Phase 1: front tilts back, echo flips in from below ──
        animate(
            ".cascade-front",
            {
                rotateX: 90,
                opacity: 0,
                y: -6,
            },
            merge(spring)
        ).then(() => {
            // Instantly reset front
            animate(
                ".cascade-front",
                { rotateX: 0, opacity: 1, y: 0 },
                { duration: 0 }
            ).then(() => {
                setBlocked(false);
                onComplete?.();
            });
        });

        animate(
            ".cascade-echo",
            {
                rotateX: 0,
                opacity: 1,
                y: 0,
                scale: 1,
            },
            merge(spring)
        ).then(() => {
            // Instantly reset echo
            animate(
                ".cascade-echo",
                {
                    rotateX: -90,
                    opacity: 0,
                    y: 6,
                    scale: 0.8,
                },
                { duration: 0 }
            );
        });
    }, [
        blocked,
        animate,
        staggerDuration,
        staggerFrom,
        stiffness,
        damping,
        onComplete,
    ]);

    return (
        <span
            ref={scope}
            className={cn(
                "relative inline-flex cursor-pointer select-none items-center justify-center",
                className
            )}
            {...(triggerOnClick ? { onClick: trigger } : { onMouseEnter: trigger })}
            aria-label={text}
        >
            {text.split("").map((letter, i) => (
                <span
                    key={i}
                    className="relative inline-flex whitespace-pre"
                    style={{ perspective: "500px" }}
                >
                    {/* Front face — visible by default, tilts backward on trigger */}
                    <motion.span
                        className={cn("cascade-front inline-block", letterClassName)}
                        style={{
                            rotateX: 0,
                            y: 0,
                            transformOrigin: "bottom center",
                            backfaceVisibility: "hidden",
                        }}
                    >
                        {letter}
                    </motion.span>

                    {/* Echo face — hidden below, flips up into view on trigger */}
                    <motion.span
                        className={cn(
                            "cascade-echo absolute inset-0 inline-block",
                            letterClassName
                        )}
                        style={{
                            rotateX: -90,
                            opacity: 0,
                            y: 6,
                            scale: 0.8,
                            transformOrigin: "top center",
                            backfaceVisibility: "hidden",
                        }}
                    >
                        {letter}
                    </motion.span>
                </span>
            ))}
        </span>
    );
}
