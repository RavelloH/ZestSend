"use client";

import { cn } from "@/lib/utils";
import React, { useEffect, useRef } from "react";

export interface CursorDrivenParticleTypographyProps {
    /** Additional CSS classes */
    className?: string;
    /** The text to render */
    text: string;
    /** Font size in pixels */
    fontSize?: number;
    /** Font family */
    fontFamily?: string;
    /** Size of each particle */
    particleSize?: number;
    /** Density of particles (lower number = more particles, minimum 1) */
    particleDensity?: number;
    /** How strongly the cursor pushes particles away */
    dispersionStrength?: number;
    /** Speed at which particles return to origin */
    returnSpeed?: number;
    /** Custom color for particles. Overrides inherited text color if set. */
    color?: string;
}

class Particle {
    x: number;
    y: number;
    originX: number;
    originY: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    dispersion: number;
    returnSpd: number;

    constructor(
        x: number,
        y: number,
        size: number,
        color: string,
        dispersion: number,
        returnSpd: number
    ) {
        this.x = x + (Math.random() - 0.5) * 10; // start with slight randomness
        this.y = y + (Math.random() - 0.5) * 10;
        this.originX = x;
        this.originY = y;
        this.vx = (Math.random() - 0.5) * 5;
        this.vy = (Math.random() - 0.5) * 5;
        this.size = size;
        this.color = color;
        this.dispersion = dispersion;
        this.returnSpd = returnSpd;
    }

    update(mouseX: number, mouseY: number) {
        const dx = mouseX - this.x;
        const dy = mouseY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Physics interaction with mouse
        const interactionRadius = 120; // 120px interaction radius

        if (distance < interactionRadius && mouseX !== -1000 && mouseY !== -1000) {
            const forceDirectionX = dx / distance;
            const forceDirectionY = dy / distance;

            const force = (interactionRadius - distance) / interactionRadius;

            // Calculate repulsion
            const repulsionX = forceDirectionX * force * this.dispersion;
            const repulsionY = forceDirectionY * force * this.dispersion;

            this.vx -= repulsionX;
            this.vy -= repulsionY;
        }

        // Return to origin (spring physics)
        this.vx += (this.originX - this.x) * this.returnSpd;
        this.vy += (this.originY - this.y) * this.returnSpd;

        // Friction
        this.vx *= 0.85;
        this.vy *= 0.85;

        // Add subtle noise/jitter when close to origin
        const distToOrigin = Math.sqrt(
            Math.pow(this.x - this.originX, 2) + Math.pow(this.y - this.originY, 2)
        );
        if (distToOrigin < 1 && Math.random() > 0.95) {
            this.vx += (Math.random() - 0.5) * 0.2;
            this.vy += (Math.random() - 0.5) * 0.2;
        }

        this.x += this.vx;
        this.y += this.vy;
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

export function CursorDrivenParticleTypography({
    className,
    text,
    fontSize = 120,
    fontFamily = "Inter, sans-serif",
    particleSize = 1.5,
    particleDensity = 6,
    dispersionStrength = 15,
    returnSpeed = 0.08,
    color,
}: CursorDrivenParticleTypographyProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        let animationFrameId: number;
        let particles: Particle[] = [];

        let mouseX = -1000;
        let mouseY = -1000;

        let containerWidth = 0;
        let containerHeight = 0;

        const init = () => {
            const container = containerRef.current;
            if (!container) return;

            containerWidth = container.clientWidth;
            containerHeight = container.clientHeight;

            const dpr = window.devicePixelRatio || 1;
            canvas.width = containerWidth * dpr;
            canvas.height = containerHeight * dpr;
            canvas.style.width = `${containerWidth}px`;
            canvas.style.height = `${containerHeight}px`;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // Determine text color
            const computedStyle = window.getComputedStyle(container);
            const textColor = color || computedStyle.color || "#000000";

            ctx.clearRect(0, 0, containerWidth, containerHeight);

            // Draw text to generate pixel map
            ctx.fillStyle = textColor;
            // Responsive font size based on container width if text is large
            const effectiveFontSize = Math.min(fontSize, containerWidth * 0.15);
            ctx.font = `bold ${effectiveFontSize}px ${fontFamily}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            // Draw standard text first to measure it
            ctx.fillText(text, containerWidth / 2, containerHeight / 2);

            // Get pixel data
            const textCoordinates = ctx.getImageData(0, 0, canvas.width, canvas.height);
            particles = [];

            // Create particles from text pixels
            // Step by density multiplied by dpr
            const step = Math.max(1, Math.floor(particleDensity * dpr));
            for (let y = 0; y < textCoordinates.height; y += step) {
                for (let x = 0; x < textCoordinates.width; x += step) {
                    const index = (y * textCoordinates.width + x) * 4;
                    const alpha = textCoordinates.data[index + 3] || 0;

                    if (alpha > 128) {
                        particles.push(
                            new Particle(
                                x / dpr,
                                y / dpr,
                                particleSize,
                                textColor,
                                dispersionStrength,
                                returnSpeed
                            )
                        );
                    }
                }
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, containerWidth, containerHeight);

            particles.forEach((particle) => {
                particle.update(mouseX, mouseY);
                particle.draw(ctx);
            });
            animationFrameId = requestAnimationFrame(animate);
        };

        const handleMouseMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            mouseX = e.clientX - rect.left;
            mouseY = e.clientY - rect.top;
        };

        const handleMouseLeave = () => {
            mouseX = -1000;
            mouseY = -1000;
        };

        const handleResize = () => {
            init();
        };

        // Initialize with a short delay to ensure fonts/layout are ready
        const timeoutId = setTimeout(() => {
            init();
            animate();
        }, 100);

        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        // Re-initialize particles when the theme changes (detects class changes on html tag)
        const themeObserver = new MutationObserver(() => {
            init();
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"]
        });

        canvas.addEventListener("mousemove", handleMouseMove);
        canvas.addEventListener("mouseleave", handleMouseLeave);
        canvas.addEventListener("touchstart", (e) => {
            if (!e.touches[0]) return;
            const rect = canvas.getBoundingClientRect();
            mouseX = e.touches[0].clientX - rect.left;
            mouseY = e.touches[0].clientY - rect.top;
        });
        canvas.addEventListener("touchmove", (e) => {
            if (!e.touches[0]) return;
            const rect = canvas.getBoundingClientRect();
            mouseX = e.touches[0].clientX - rect.left;
            mouseY = e.touches[0].clientY - rect.top;
        });
        canvas.addEventListener("touchend", handleMouseLeave);

        return () => {
            clearTimeout(timeoutId);
            resizeObserver.disconnect();
            themeObserver.disconnect();
            canvas.removeEventListener("mousemove", handleMouseMove);
            canvas.removeEventListener("mouseleave", handleMouseLeave);
            cancelAnimationFrame(animationFrameId);
        };
    }, [text, fontSize, fontFamily, particleSize, particleDensity, dispersionStrength, returnSpeed, color]);

    return (
        <div
            ref={containerRef}
            className={cn("w-full h-full min-h-[400px] flex items-center justify-center relative touch-none", className)}
        >
            <canvas
                ref={canvasRef}
                className="block w-full h-full"
            />
        </div>
    );
}
