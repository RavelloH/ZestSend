import {
  RiArrowGoBackLine,
  RiBrushLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEraserLine,
  RiPaletteLine,
  RiPencilLine,
  RiRestartLine,
  RiZoomInLine,
  RiZoomOutLine,
} from "@remixicon/react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { P2PCollaborationProvider } from "../lib/p2p-collaboration";

type Locale = "en" | "zh";
type Point = { x: number; y: number };
type Camera = { x: number; y: number; zoom: number };
type Stroke = {
  author: number;
  color: string;
  deleted: boolean;
  id: string;
  points: Point[];
  size: number;
};

const colorPresets = [
  "#F8FAFC", "#94A3B8", "#334155", "#0F172A",
  "#FB7185", "#F97316", "#FBBF24", "#A3E635",
  "#2DD4BF", "#38BDF8", "#818CF8", "#C084FC",
  "#F472B6", "#FDBA74", "#E2E8F0", "#FFFFFF",
];
const initialWorldWidth = 16_000;
const initialWorldHeight = 9_000;
const minZoom = 0.01;
const maxZoom = 5;

function normalizeHex(value: string): string | null {
  const candidate = value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`;
  return /^#[\da-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : null;
}

function createPath(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y} l 0.01 0.01`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!;
    const next = points[index + 1]!;
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = points[points.length - 1]!;
  return `${path} L ${last.x} ${last.y}`;
}

function readStrokes(strokes: Y.Array<Y.Map<unknown>>): Stroke[] {
  return strokes.toArray().map((stroke) => {
    const rawPoints = (stroke.get("points") as Y.Array<number> | undefined)?.toArray() ?? [];
    const points: Point[] = [];
    for (let index = 0; index < rawPoints.length; index += 2) {
      points.push({ x: rawPoints[index] ?? 0, y: rawPoints[index + 1] ?? 0 });
    }
    return {
      author: Number(stroke.get("author") ?? -1),
      color: String(stroke.get("color") ?? "#67d5ff"),
      deleted: Boolean(stroke.get("deleted")),
      id: String(stroke.get("id") ?? ""),
      points,
      size: Number(stroke.get("size") ?? 4),
    };
  });
}

function CanvasToolButton({ active = false, children, label, onClick }: { active?: boolean; children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className={`zest-canvas-tool ${active ? "zest-canvas-tool-active" : ""}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function CollaborationCanvas({ accent, locale, onFeatureUsed, provider }: { accent: string; locale: Locale; onFeatureUsed: () => void; provider: P2PCollaborationProvider | null }) {
  const [color, setColor] = useState(accent);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [hexInput, setHexInput] = useState(accent.toUpperCase());
  const [eraser, setEraser] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [size, setSize] = useState(4);
  const [version, setVersion] = useState(0);
  const [surfaceSize, setSurfaceSize] = useState({ height: initialWorldHeight, width: initialWorldWidth });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const activeStrokeRef = useRef<{ points: Y.Array<number>; stroke: Y.Map<unknown> } | null>(null);
  const cameraRef = useRef(camera);
  const queuedPointsRef = useRef<number[]>([]);
  const flushFrameRef = useRef(0);
  const interactionRef = useRef<{ lastX: number; lastY: number; mode: "draw" | "pan" } | null>(null);
  const initialCameraSetRef = useRef(false);
  const surfaceRef = useRef<SVGSVGElement>(null);

  const strokes = useMemo(() => provider?.document.getArray<Y.Map<unknown>>("zestsend-canvas-strokes") ?? null, [provider]);
  const renderedStrokes = useMemo(() => strokes ? readStrokes(strokes) : [], [strokes, version]);

  useEffect(() => {
    if (!strokes) return;
    const refresh = () => setVersion((current) => current + 1);
    strokes.observeDeep(refresh);
    refresh();
    return () => strokes.unobserveDeep(refresh);
  }, [strokes]);

  useEffect(() => () => {
    if (flushFrameRef.current) window.cancelAnimationFrame(flushFrameRef.current);
  }, []);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    if (!strokes) {
      initialCameraSetRef.current = false;
      return;
    }
    const surface = surfaceRef.current;
    if (!surface) return;
    const resize = () => {
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setSurfaceSize({ height: rect.height, width: rect.width });
      if (initialCameraSetRef.current) return;
      initialCameraSetRef.current = true;
      setCamera({ x: 0, y: 0, zoom: rect.width / initialWorldWidth });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    resize();
    return () => observer.disconnect();
  }, [strokes]);

  if (!provider || !strokes) {
    return <div className="flex size-full items-center justify-center text-sm font-medium tracking-[0.05em] text-sky-100/55">{locale === "zh" ? "正在准备共享画板…" : "Preparing shared canvas…"}</div>;
  }

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): Point | null => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const matrix = surface.getScreenCTM();
    if (!matrix) return null;
    const screenPoint = surface.createSVGPoint();
    screenPoint.x = event.clientX;
    screenPoint.y = event.clientY;
    const point = screenPoint.matrixTransform(matrix.inverse());
    return {
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
    };
  };

  const flushPoints = () => {
    flushFrameRef.current = 0;
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke || !queuedPointsRef.current.length) return;
    const points = queuedPointsRef.current;
    queuedPointsRef.current = [];
    provider.document.transact(() => activeStroke.points.push(points));
  };

  const queuePoint = (point: Point) => {
    queuedPointsRef.current.push(point.x, point.y);
    if (!flushFrameRef.current) flushFrameRef.current = window.requestAnimationFrame(flushPoints);
  };

  const eraseAt = (point: Point) => {
    const target = renderedStrokes.slice().reverse().find((stroke) => {
      if (stroke.deleted) return false;
      const threshold = Math.max(12 / cameraRef.current.zoom, stroke.size * 2.5);
      return stroke.points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= threshold);
    });
    if (!target) return;
    const yStroke = strokes.toArray().find((stroke) => String(stroke.get("id")) === target.id);
    provider.document.transact(() => yStroke?.set("deleted", true));
  };

  const startStroke = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panMode || event.button === 1 || event.shiftKey) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      interactionRef.current = { lastX: event.clientX, lastY: event.clientY, mode: "pan" };
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (eraser) {
      eraseAt(point);
      return;
    }
    interactionRef.current = { lastX: event.clientX, lastY: event.clientY, mode: "draw" };
    const stroke = new Y.Map<unknown>();
    const points = new Y.Array<number>();
    provider.document.transact(() => {
      stroke.set("author", provider.document.clientID);
      stroke.set("color", color);
      stroke.set("deleted", false);
      stroke.set("id", `${provider.document.clientID}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      stroke.set("points", points);
      stroke.set("size", size);
      strokes.push([stroke]);
    });
    activeStrokeRef.current = { points, stroke };
    onFeatureUsed();
    queuePoint(point);
  };

  const continueStroke = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = interactionRef.current;
    if (interaction?.mode === "pan") {
      const deltaX = event.clientX - interaction.lastX;
      const deltaY = event.clientY - interaction.lastY;
      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;
      if (deltaX || deltaY) {
        setCamera((current) => ({
          ...current,
          x: current.x - deltaX / current.zoom,
          y: current.y - deltaY / current.zoom,
        }));
      }
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    if (eraser) {
      if (event.buttons) eraseAt(point);
      return;
    }
    if (activeStrokeRef.current) queuePoint(point);
  };

  const finishStroke = () => {
    if (flushFrameRef.current) {
      window.cancelAnimationFrame(flushFrameRef.current);
      flushPoints();
    }
    activeStrokeRef.current = null;
    interactionRef.current = null;
  };

  const updateZoom = (nextZoom: number, clientX?: number, clientY?: number) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const clampedZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    const anchorX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const anchorY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    setCamera((current) => ({
      x: current.x + anchorX / current.zoom - anchorX / clampedZoom,
      y: current.y + anchorY / current.zoom - anchorY / clampedZoom,
      zoom: clampedZoom,
    }));
  };

  const resetCamera = () => {
    setCamera({ x: 0, y: 0, zoom: surfaceSize.width / initialWorldWidth });
  };

  const undo = () => {
    const localStroke = strokes.toArray().slice().reverse().find((stroke) => (
      Number(stroke.get("author")) === provider.document.clientID && !stroke.get("deleted")
    ));
    provider.document.transact(() => localStroke?.set("deleted", true));
  };

  const clear = () => {
    provider.document.transact(() => {
      strokes.forEach((stroke) => stroke.set("deleted", true));
    });
  };

  const selectColor = (value: string) => {
    const normalized = normalizeHex(value);
    if (!normalized) return;
    setColor(normalized);
    setHexInput(normalized);
    setEraser(false);
  };

  const openColorPicker = () => {
    setHexInput(color.toUpperCase());
    setColorPickerOpen(true);
  };

  const viewBox = `${camera.x} ${camera.y} ${surfaceSize.width / camera.zoom} ${surfaceSize.height / camera.zoom}`;

  return (
    <div className="zest-canvas-shell" style={{ "--zest-canvas-accent": accent } as CSSProperties}>
      <div className="zest-canvas-toolbar">
        <div className="zest-canvas-tools" role="toolbar" aria-label={locale === "zh" ? "画板工具栏" : "Canvas toolbar"}>
          <CanvasToolButton active={!eraser && !panMode} label={locale === "zh" ? "画笔" : "Pen"} onClick={() => { setEraser(false); setPanMode(false); }}><RiPencilLine /></CanvasToolButton>
          <CanvasToolButton active={eraser} label={locale === "zh" ? "橡皮擦" : "Eraser"} onClick={() => { setEraser(true); setPanMode(false); }}><RiEraserLine /></CanvasToolButton>
          <CanvasToolButton active={panMode} label={locale === "zh" ? "平移画布" : "Pan canvas"} onClick={() => { setEraser(false); setPanMode(true); }}><RiDragMove2Line /></CanvasToolButton>
          <span className="zest-canvas-divider" />
          <button
            aria-label={locale === "zh" ? "选择颜色" : "Choose color"}
            className="zest-canvas-color-trigger"
            onClick={openColorPicker}
            title={locale === "zh" ? "选择颜色" : "Choose color"}
            type="button"
          >
            <span className="zest-canvas-current-color" style={{ backgroundColor: color }} />
            <RiPaletteLine />
          </button>
          <span className="zest-canvas-divider" />
          <input
            aria-label={locale === "zh" ? "画笔粗细" : "Brush size"}
            className="zest-canvas-size"
            max="16"
            min="2"
            onChange={(event) => setSize(Number(event.target.value))}
            type="range"
            value={size}
          />
          <span className="zest-canvas-divider" />
          <CanvasToolButton label={locale === "zh" ? "缩小" : "Zoom out"} onClick={() => updateZoom(camera.zoom / 1.25)}><RiZoomOutLine /></CanvasToolButton>
          <button className="zest-canvas-zoom-value" onClick={resetCamera} title={locale === "zh" ? "重置视图" : "Reset view"} type="button">{Math.round((camera.zoom / (surfaceSize.width / initialWorldWidth)) * 100)}%</button>
          <CanvasToolButton label={locale === "zh" ? "放大" : "Zoom in"} onClick={() => updateZoom(camera.zoom * 1.25)}><RiZoomInLine /></CanvasToolButton>
          <CanvasToolButton label={locale === "zh" ? "重置视图" : "Reset view"} onClick={resetCamera}><RiRestartLine /></CanvasToolButton>
          <span className="zest-canvas-divider" />
          <CanvasToolButton label={locale === "zh" ? "撤销我的笔划" : "Undo my stroke"} onClick={undo}><RiArrowGoBackLine /></CanvasToolButton>
          <CanvasToolButton label={locale === "zh" ? "清空画板" : "Clear canvas"} onClick={clear}><RiDeleteBinLine /></CanvasToolButton>
        </div>
      </div>
      <div className="zest-canvas-surface-wrap">
        <svg
          className={`zest-canvas-surface ${eraser ? "zest-canvas-erasing" : panMode ? "zest-canvas-panning" : ""}`}
          onPointerCancel={finishStroke}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={finishStroke}
          onWheel={(event) => {
            event.preventDefault();
            updateZoom(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
          }}
          preserveAspectRatio="none"
          ref={surfaceRef}
          viewBox={viewBox}
        >
          <defs>
            <pattern height="250" id="zest-canvas-grid" patternUnits="userSpaceOnUse" width="250">
              <path d="M 250 0 L 0 0 0 250" fill="none" stroke="rgb(255 255 255 / 0.035)" strokeWidth="12" />
            </pattern>
          </defs>
          <rect fill="url(#zest-canvas-grid)" height={surfaceSize.height / camera.zoom} pointerEvents="none" width={surfaceSize.width / camera.zoom} x={camera.x} y={camera.y} />
          {renderedStrokes.filter((stroke) => !stroke.deleted && stroke.points.length).map((stroke) => (
            <path
              d={createPath(stroke.points)}
              fill="none"
              key={stroke.id}
              stroke={stroke.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={stroke.size * 10}
            />
          ))}
        </svg>
        {renderedStrokes.every((stroke) => stroke.deleted) ? (
          <div className="zest-canvas-empty" aria-hidden="true"><RiBrushLine /><span>{locale === "zh" ? "从一笔开始" : "Start with a stroke"}</span></div>
        ) : null}
      </div>
      <Dialog open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
        <DialogContent className="zest-canvas-color-dialog max-w-md" role="dialog">
          <DialogHeader className="zest-canvas-color-dialog-header">
            <div>
              <p className="text-[0.65rem] font-bold tracking-[0.12em] text-sky-100/40">{locale === "zh" ? "画板" : "CANVAS"}</p>
              <DialogTitle className="mt-1 text-xl sm:text-2xl">{locale === "zh" ? "画笔颜色" : "Ink color"}</DialogTitle>
            </div>
            <DialogClose aria-label={locale === "zh" ? "关闭颜色选择" : "Close color picker"} />
          </DialogHeader>
          <div className="zest-canvas-color-dialog-body">
            <div className="zest-canvas-color-preview" style={{ backgroundColor: color }} />
            <div className="zest-canvas-color-value">
              <label htmlFor="zest-canvas-hex">HEX</label>
              <div>
                <input
                  aria-label="HEX"
                  id="zest-canvas-hex"
                  maxLength={7}
                  onChange={(event) => {
                    const value = event.target.value.toUpperCase();
                    setHexInput(value);
                    const normalized = normalizeHex(value);
                    if (normalized) setColor(normalized);
                  }}
                  spellCheck={false}
                  value={hexInput}
                />
                <label className="zest-canvas-native-color" title={locale === "zh" ? "使用系统取色器" : "Open system color picker"}>
                  <input aria-label={locale === "zh" ? "使用系统取色器" : "Open system color picker"} onChange={(event) => selectColor(event.target.value)} type="color" value={color} />
                  <span style={{ backgroundColor: color }} />
                </label>
              </div>
            </div>
            <div className="zest-canvas-color-presets" aria-label={locale === "zh" ? "颜色预设" : "Color presets"}>
              {colorPresets.map((swatch) => (
                <button
                  aria-label={swatch}
                  className={color === swatch ? "zest-canvas-preset-active" : ""}
                  key={swatch}
                  onClick={() => selectColor(swatch)}
                  style={{ backgroundColor: swatch }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
