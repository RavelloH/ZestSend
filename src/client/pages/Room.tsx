import {
  RiArrowLeftLine,
  RiCheckboxCircleFill,
  RiChat3Line,
  RiCloseCircleFill,
  RiExchange2Line,
  RiFileEditLine,
  RiFolderTransferLine,
  RiGlobalLine,
  RiMicLine,
  RiPlayCircleLine,
  RiPulseLine,
  RiRadioButtonLine,
  RiShareForwardLine,
  RiRouterLine,
  RiLogoutBoxRLine,
  RiLock2Fill,
  RiBrushLine,
  RiVideoOnLine,
  RiWifiLine,
} from "@remixicon/react";
import NumberFlow, { continuous } from "@number-flow/react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import Layout from "../components/Layout";
import { useTheme } from "../components/theme";
import { AutoTransition } from "../components/ui/auto-transition";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { MagneticDock, type DockItemData } from "../components/ui/magnetic-dock";
import {
  NativeWebRTCSession,
  type ConnectionRoute,
  type ConnectionProgress,
  type ConnectionState,
  type ConnectionStep,
} from "../lib/webrtc";

type StatusRowProps = {
  icon: typeof RiRouterLine;
  label: string;
  status: ConnectionProgress[keyof ConnectionProgress];
};

const continuousNumberFlow = [continuous];

type RoomLocale = "en" | "zh";
type WorkspaceId = "chat" | "files" | "video" | "voice" | "watch" | "collaborate" | "canvas" | "status";

const roomCopy = {
  en: {
    connectingTitle: "Establishing an end-to-end connection",
    connectionErrorTitle: "Reconnecting",
    preparing: (roomId: string) => `Ask the other person to enter room number ${roomId}, or share the room link.`,
    room: "ROOM",
    resource: "Request server connection information",
    websocket: "WebSocket signaling",
    stun: "STUN server",
    turn: "TURN server",
    p2p: "P2P connection",
    dataChannel: "Data channel",
    ready: "Peer-to-peer connection established",
    readyDescription: "Choose a feature from the buttons below",
    encrypted: "End-to-end encrypted · Direct",
    encryptedRelay: "End-to-end encrypted · Relay",
    leave: "Exit",
    share: "Share",
    copied: "Room link copied",
    roomFullDescription: "This room already has two participants. Try a different four-digit room number.",
    roomFullTitle: "Room is full",
    returnHome: "Return home",
    pageTitle: (roomId: string) => `Connecting to room ${roomId}`,
    roomTitle: (roomId: string) => `ZestSend room ${roomId}`,
  },
  zh: {
    connectingTitle: "正在建立端对端连接",
    connectionErrorTitle: "断线重连中",
    preparing: (roomId: string) => `请让对方输入房间号：${roomId}，或者点击分享链接。`,
    room: "房间",
    resource: "请求服务器连接信息",
    websocket: "WebSocket 信令",
    stun: "STUN 服务器",
    turn: "TURN 服务器",
    p2p: "P2P 连接",
    dataChannel: "数据通道",
    ready: "端对端连接已建立",
    readyDescription: "从下方按钮中选择功能",
    encrypted: "端对端加密 · 直连",
    encryptedRelay: "端对端加密 · 中继",
    leave: "退出",
    share: "分享",
    copied: "房间链接已复制",
    roomFullDescription: "这个房间已有两位参与者，请换一个四位房间号后重试。",
    roomFullTitle: "房间已满",
    returnHome: "返回首页",
    pageTitle: (roomId: string) => `正在连接房间 ${roomId}`,
    roomTitle: (roomId: string) => `ZestSend 房间 ${roomId}`,
  },
} as const;

const workspaceCopy = {
  en: {
    apps: {
      canvas: ["Canvas", "A shared place for sketches and marks."],
      chat: ["Chat", "Messages remain available while you work elsewhere."],
      collaborate: ["Collaborate", "A shared Markdown document for the room."],
      files: ["Files", "Send files or let the other participant choose what to receive."],
      status: ["Connection status", "Live measurements for this private room."],
      video: ["Video", "Video calls and screen sharing share one media session."],
      voice: ["Voice", "Keep a voice channel running in the background."],
      watch: ["Watch together", "Synchronize a shared video or audio session."],
    },
    background: "Running in background",
    exit: "Exit room",
    room: "ROOM",
    statusHint: "All values update from the active connection.",
  },
  zh: {
    apps: {
      canvas: ["画板", "与对方共享涂鸦、笔记和标记。"],
      chat: ["聊天", "切换到其他功能时，消息仍会保持可用。"],
      collaborate: ["协作", "在房间内共同编辑 Markdown 文档。"],
      files: ["文件", "发送文件，或让对方选择需要接收的文件。"],
      status: ["连接状态", "查看这个私密房间的实时连接测量。"],
      video: ["视频", "视频通话与屏幕共享使用同一媒体会话。"],
      voice: ["语音", "在后台持续保持一条语音通道。"],
      watch: ["同播", "同步观看视频或一起听音频。"],
    },
    background: "正在后台运行",
    exit: "退出房间",
    room: "房间",
    statusHint: "所有数值均来自当前活跃连接。",
  },
} as const;

const workspaceOrder: WorkspaceId[] = ["chat", "files", "video", "voice", "watch", "collaborate", "canvas", "status"];
const workspaceIcons = {
  canvas: RiBrushLine,
  chat: RiChat3Line,
  collaborate: RiFileEditLine,
  files: RiFolderTransferLine,
  status: RiPulseLine,
  video: RiVideoOnLine,
  voice: RiMicLine,
  watch: RiPlayCircleLine,
} as const;

const detailTranslation: Record<string, string> = {
  "Waiting for signaling socket": "正在等待信令 WebSocket",
  "Checking STUN server": "正在检查 STUN 服务器",
  "Checking TURN server": "正在检查 TURN 服务器",
  "Waiting to request Cloudflare resources": "正在等待请求 Cloudflare 资源",
  "Requesting Cloudflare ICE resources": "正在请求 Cloudflare ICE 资源",
  "ICE resources issued by server": "服务器已下发 ICE 资源",
  "Testing STUN server": "正在测试 STUN 服务器",
  "Testing TURN server": "正在测试 TURN 服务器",
  "Waiting for the other participant to join the room": "正在等待另一位参与者加入房间",
  "Waiting for data channel": "正在等待数据通道",
  "Opening signaling socket": "正在打开信令 WebSocket",
  "Signaling socket connected": "信令 WebSocket 已连接",
  "Signaling socket closed": "信令 WebSocket 已关闭",
  "Available STUN server detected": "已检测到可用 STUN 服务器",
  "STUN server unavailable": "STUN 服务器不可用",
  "Available TURN server detected": "已检测到可用 TURN 服务器",
  "TURN server unavailable": "无可用 TURN 服务器，仅可建立直连连接",
  "TURN credentials are not configured.": "无可用 TURN 服务器，仅可建立直连连接",
  "TURN extension not configured on server": "服务器未配置 TURN 拓展",
  "TURN credentials could not be generated.": "无法生成 TURN 凭证",
  "Waiting for connection offer": "正在等待连接请求",
  "The other participant left": "另一位参与者已离开",
  "Creating P2P offer": "正在创建 P2P 连接请求",
  "Accepting P2P offer": "正在接受 P2P 连接请求",
  "P2P connection established": "P2P 连接已建立",
  "P2P connection failed.": "P2P 连接失败",
  "Opening data channel": "正在打开数据通道",
  "Data channel ready": "数据通道已就绪",
  "Data channel closed": "数据通道已关闭",
  "Data channel failed.": "与对方断开连接，正在重新连接。",
  "The signaling WebSocket could not be opened.": "无法打开信令 WebSocket",
};

function localizedDetail(locale: RoomLocale, detail: string): string {
  return locale === "zh" ? (detailTranslation[detail] ?? detail) : detail;
}

function latencyColor(latency: number, realtimeConnection = false): string {
  if (realtimeConnection) {
    if (latency <= 50) return "text-emerald-300";
    if (latency <= 499) return "text-amber-300";
    return "text-rose-300";
  }

  if (latency <= 250) return "text-emerald-300";
  if (latency <= 1_000) return "text-amber-300";
  return "text-rose-300";
}

function StatusRow({ icon: Icon, label, locale, nonBlockingFailure = false, realtimeConnection = false, showPendingLoading = false, status }: StatusRowProps & { locale: RoomLocale; nonBlockingFailure?: boolean; realtimeConnection?: boolean; showPendingLoading?: boolean }) {
  const active = status.state === "active" || status.state === "ready";
  const working = status.state === "checking" || (showPendingLoading && status.state === "pending");
  const failed = status.state === "error";
  const pending = status.state === "pending";
  const iconTone = active
    ? { backgroundColor: "rgba(52, 211, 153, 0.15)", color: "rgb(110, 231, 183)" }
    : failed
      ? nonBlockingFailure
        ? { backgroundColor: "rgba(251, 191, 36, 0.15)", color: "rgb(252, 211, 77)" }
        : { backgroundColor: "rgba(251, 113, 133, 0.15)", color: "rgb(253, 164, 175)" }
      : pending
        ? { backgroundColor: "rgba(148, 163, 184, 0.12)", color: "rgb(148, 163, 184)" }
        : { backgroundColor: "rgba(56, 189, 248, 0.15)", color: "rgb(125, 211, 252)" };

  return (
    <div className="flex min-h-20 items-center gap-4 py-3 sm:gap-5">
      <motion.div
        animate={iconTone}
        className="relative flex size-12 shrink-0 items-center justify-center rounded-full"
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <AnimatePresence initial={false}>
          {working ? (
            <motion.span
              animate={{ opacity: 1, scale: 1.1 }}
              aria-hidden="true"
              className="absolute size-12 rounded-full"
              exit={{ opacity: 0, scale: 0.82 }}
              initial={{ opacity: 0, scale: 0.82 }}
              key="loading-ring"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <svg
                aria-hidden="true"
                className="absolute inset-0"
                viewBox="0 0 24 24"
              >
                <g stroke="currentColor">
                  <circle cx="12" cy="12" fill="none" r="9.5" strokeLinecap="round" strokeWidth="1.5">
                    <animate
                      attributeName="stroke-dasharray"
                      calcMode="spline"
                      dur="1.5s"
                      keySplines="0.42,0,0.58,1;0.42,0,0.58,1;0.42,0,0.58,1"
                      keyTimes="0;0.475;0.95;1"
                      repeatCount="indefinite"
                      values="0 150;42 150;42 150;42 150"
                    />
                    <animate
                      attributeName="stroke-dashoffset"
                      calcMode="spline"
                      dur="1.5s"
                      keySplines="0.42,0,0.58,1;0.42,0,0.58,1;0.42,0,0.58,1"
                      keyTimes="0;0.475;0.95;1"
                      repeatCount="indefinite"
                      values="0;-16;-59;-59"
                    />
                  </circle>
                  <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                </g>
              </svg>
            </motion.span>
          ) : null}
        </AnimatePresence>
        <Icon aria-hidden="true" className="relative z-10 size-6" />
      </motion.div>
      <div className="relative min-w-0 flex-1 self-stretch pr-14">
        <p className="min-w-0 truncate text-base font-bold tracking-[0.04em] text-sky-50 sm:text-lg">{label}</p>
        {status.latency !== undefined ? (
          <span className={`absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center font-mono text-sm leading-none ${latencyColor(status.latency, realtimeConnection)}`}>
            <NumberFlow
              className="inline-flex leading-none"
              plugins={continuousNumberFlow}
              spinTiming={{ duration: 420, easing: "ease-out" }}
              transformTiming={{ duration: 420, easing: "ease-out" }}
              value={status.latency}
              willChange
            />
            <span className="ml-px inline-flex items-center leading-none">ms</span>
          </span>
        ) : null}
        <AutoTransition
          className="mt-0.5 truncate text-sm font-medium tracking-[0.03em] text-sky-100/55"
          duration={0.22}
          transitionKey={status.detail}
          type="fade"
        >
          {localizedDetail(locale, status.detail)}
        </AutoTransition>
      </div>
    </div>
  );
}

function ConnectionDialog({
  error,
  locale,
  onLeave,
  onExitComplete,
  open,
  progress,
  roomId,
}: {
  error: string | null;
  locale: RoomLocale;
  onLeave: () => void;
  onExitComplete?: () => void;
  open: boolean;
  progress: ConnectionProgress;
  roomId: string;
}) {
  const copy = roomCopy[locale];
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");

  const shareRoom = async () => {
    const url = new URL(`/room/${roomId}`, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: `ZestSend ${copy.room} ${roomId}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      window.setTimeout(() => setShareStatus("idle"), 1_800);
    } catch (shareError) {
      if ((shareError as DOMException).name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setShareStatus("copied");
        window.setTimeout(() => setShareStatus("idle"), 1_800);
      } catch {
        // The sharing action cannot proceed when browser permissions are unavailable.
      }
    }
  };

  return (
    <Dialog open={open} onExitComplete={onExitComplete} onOpenChange={() => undefined}>
      <DialogContent aria-labelledby="connection-title" className="!max-w-2xl">
        <div className="flex items-center justify-between gap-5 border-b border-white/10 p-6 sm:p-8">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.12em] text-sky-100/50">{copy.room} {roomId}</p>
            <AutoTransition
              aria-level={1}
              className="mt-2 text-2xl font-bold tracking-[0.04em] text-sky-50 sm:text-3xl"
              duration={0.22}
              id="connection-title"
              role="heading"
              transitionKey={error ? "error" : "connecting"}
              type="fade"
            >
              {error ? copy.connectionErrorTitle : copy.connectingTitle}
            </AutoTransition>
            <AutoTransition
              className="mt-2 text-sm font-medium tracking-[0.04em] text-sky-100/60"
              duration={0.22}
              transitionKey={shareStatus === "copied" ? "copied" : error ?? "preparing"}
              type="fade"
            >
              {shareStatus === "copied" ? copy.copied : error ? localizedDetail(locale, error) : copy.preparing(roomId)}
            </AutoTransition>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-label={copy.share}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.1] px-3 text-sm font-semibold tracking-[0.04em] text-sky-100/75 transition-colors hover:bg-white/[0.05] hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60"
              onClick={() => void shareRoom()}
              type="button"
            >
              <RiShareForwardLine aria-hidden="true" className="size-5" />
              <span>{copy.share}</span>
            </button>
            <button
              aria-label={copy.leave}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 text-sm font-semibold tracking-[0.04em] text-rose-200 transition-colors hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-200/60"
              onClick={onLeave}
              type="button"
            >
              <RiLogoutBoxRLine aria-hidden="true" className="size-5" />
              <span>{copy.leave}</span>
            </button>
          </div>
        </div>
        <div className="divide-y divide-white/10 px-6 sm:px-8">
          <StatusRow icon={RiGlobalLine} label={copy.resource} locale={locale} nonBlockingFailure status={progress.resource} />
          <StatusRow icon={RiRouterLine} label={copy.websocket} locale={locale} realtimeConnection status={progress.websocket} />
          <StatusRow icon={RiGlobalLine} label={copy.stun} locale={locale} nonBlockingFailure status={progress.stun} />
          <StatusRow icon={RiExchange2Line} label={copy.turn} locale={locale} nonBlockingFailure status={progress.turn} />
          <StatusRow icon={RiWifiLine} label={copy.p2p} locale={locale} realtimeConnection showPendingLoading status={progress.p2p} />
          <StatusRow icon={RiRadioButtonLine} label={copy.dataChannel} locale={locale} showPendingLoading status={progress.dataChannel} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusMetric({ icon: Icon, label, status }: { icon: typeof RiRouterLine; label: string; status: ConnectionStep }) {
  const tone = status.state === "active" || status.state === "ready"
    ? "text-emerald-300"
    : status.state === "error"
      ? "text-rose-300"
      : status.state === "checking"
        ? "text-sky-300"
        : "text-slate-400";

  return (
    <div className="flex items-center gap-3 border-b border-white/10 py-4 last:border-b-0">
      <Icon aria-hidden="true" className={`size-5 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold tracking-[0.04em] text-sky-50">{label}</p>
        <p className="mt-1 truncate text-xs font-medium tracking-[0.03em] text-sky-100/50">{status.detail}</p>
      </div>
      {status.latency !== undefined ? <span className={`font-mono text-sm ${tone}`}>{status.latency}ms</span> : null}
    </div>
  );
}

function RoomWorkspace({
  locale,
  onExitComplete,
  onLeave,
  open,
  progress,
  roomId,
  connectionRoute,
}: {
  locale: RoomLocale;
  onExitComplete?: () => void;
  onLeave: () => void;
  open: boolean;
  progress: ConnectionProgress;
  roomId: string;
  connectionRoute: ConnectionRoute;
}) {
  const copy = roomCopy[locale];
  const { theme } = useTheme();
  const workspace = workspaceCopy[locale];
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId | null>(null);
  const [runningWorkspaces, setRunningWorkspaces] = useState<WorkspaceId[]>([]);

  const activateWorkspace = (workspaceId: WorkspaceId) => {
    setActiveWorkspace(workspaceId);
    setRunningWorkspaces((current) => current.includes(workspaceId) ? current : [...current, workspaceId]);
  };

  const dockItems: DockItemData[] = workspaceOrder.map((workspaceId) => {
    const Icon = workspaceIcons[workspaceId];
    return {
      icon: <Icon aria-hidden="true" className="size-full" />,
      id: workspaceId,
      isActive: activeWorkspace === workspaceId,
      label: workspace.apps[workspaceId][0],
      onClick: () => activateWorkspace(workspaceId),
    };
  });

  dockItems.push({
    icon: <RiLogoutBoxRLine aria-hidden="true" className="size-full" />,
    id: "exit",
    label: workspace.exit,
    onClick: onLeave,
    tone: "danger",
  });

  return (
    <Dialog fullScreen open={open} overlay={false} onExitComplete={onExitComplete} onOpenChange={() => undefined}>
      <DialogContent
        fadeOnly
        fullScreen
        aria-labelledby="connection-ready-title"
        style={{ height: "100dvh", maxHeight: "none", width: "100dvw" }}
      >
        <div className="relative flex min-h-full flex-1 flex-col p-5 sm:p-8">
          <header className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <p
                className="animate-gradient bg-clip-text text-lg font-bold tracking-[0.06em] text-transparent sm:text-xl"
                style={{ backgroundImage: `linear-gradient(120deg, ${theme.accent}, ${theme.highlight}, ${theme.accent})` }}
              >
                ZestSend
              </p>
              <p className="truncate text-lg font-bold tracking-[0.06em] text-sky-100/65 sm:text-xl"># {roomId}</p>
            </div>
            <p className="inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.05em] text-emerald-300">
              <RiLock2Fill aria-hidden="true" className="size-4" />
              {connectionRoute === "relay" ? copy.encryptedRelay : copy.encrypted}
            </p>
          </header>

          <main className="flex min-h-0 flex-1 items-center justify-center pb-28 pt-8">
            {workspaceOrder.map((workspaceId) => {
              const [title, description] = workspace.apps[workspaceId];
              const Icon = workspaceIcons[workspaceId];
              const isActive = activeWorkspace === workspaceId;
              const isRunning = runningWorkspaces.includes(workspaceId);

              if (!isActive) return null;

              return (
                <section
                  className="w-full max-w-2xl"
                  key={workspaceId}
                >
                  {workspaceId === "status" ? (
                    <div className="mx-auto w-full max-w-xl">
                      <div className="flex items-start gap-4">
                        <Icon aria-hidden="true" className="mt-1 size-8 text-sky-200" />
                        <div>
                          <h1 id="connection-ready-title" className="text-3xl font-bold tracking-[0.04em] text-sky-50">{title}</h1>
                          <p className="mt-2 text-sm font-medium tracking-[0.04em] text-sky-100/60">{workspace.statusHint}</p>
                        </div>
                      </div>
                      <div className="mt-8 border-y border-white/10">
                        <StatusMetric icon={RiGlobalLine} label={roomCopy[locale].resource} status={progress.resource} />
                        <StatusMetric icon={RiRouterLine} label={roomCopy[locale].websocket} status={progress.websocket} />
                        <StatusMetric icon={RiGlobalLine} label={roomCopy[locale].stun} status={progress.stun} />
                        <StatusMetric icon={RiExchange2Line} label={roomCopy[locale].turn} status={progress.turn} />
                        <StatusMetric icon={RiWifiLine} label={roomCopy[locale].p2p} status={progress.p2p} />
                        <StatusMetric icon={RiRadioButtonLine} label={roomCopy[locale].dataChannel} status={progress.dataChannel} />
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto max-w-xl text-center">
                      <Icon aria-hidden="true" className="mx-auto size-10 text-sky-200" />
                      <h1 id="connection-ready-title" className="mt-5 text-3xl font-bold tracking-[0.04em] text-sky-50">{title}</h1>
                      <p className="mx-auto mt-3 max-w-md text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/60">{description}</p>
                      {isRunning && workspaceId !== "chat" ? <p className="mt-6 text-xs font-bold tracking-[0.1em] text-sky-100/40">{workspace.background}</p> : null}
                    </div>
                  )}
                </section>
              );
            })}
            {activeWorkspace === null ? (
              <section className="w-full max-w-2xl text-center">
                <RiCheckboxCircleFill aria-hidden="true" className="mx-auto size-12 text-emerald-300" />
                <p className="mt-5 text-xs font-bold tracking-[0.12em] text-sky-100/50">{workspace.room} {roomId}</p>
                <h1 id="connection-ready-title" className="mt-2 text-3xl font-bold tracking-[0.04em] text-sky-50">{copy.ready}</h1>
                <p className="mx-auto mt-4 max-w-lg text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/65">
                  {copy.readyDescription}
                </p>
              </section>
            ) : null}
          </main>

          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center sm:bottom-8">
            <div
              className="pointer-events-auto origin-bottom"
              style={{ transform: "scale(clamp(0.46, calc((100vw - 1.5rem) / 41.5rem), 1))" }}
            >
              <MagneticDock
                activeColor={theme.accent}
                iconOnly
                iconSize={64}
                items={dockItems}
                magneticDistance={190}
                maxScale={1.7}
                showLabels
                variant="transparent"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoomFullContent({ locale, onLeave, roomId }: { locale: RoomLocale; onLeave: () => void; roomId: string }) {
  const copy = roomCopy[locale];

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent aria-labelledby="room-full-title" className="!max-w-md">
        <div className="p-7 text-center sm:p-9">
          <RiCloseCircleFill aria-hidden="true" className="mx-auto size-12 text-rose-300" />
          <p className="mt-5 text-xs font-bold tracking-[0.12em] text-sky-100/50">{copy.room} {roomId}</p>
          <h1 id="room-full-title" className="mt-2 text-2xl font-bold tracking-[0.04em] text-sky-50 sm:text-3xl">
            {copy.roomFullTitle}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/65">
            {copy.roomFullDescription}
          </p>
          <button
            className="mt-8 inline-flex h-10 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-semibold tracking-[0.04em] text-sky-100/80 transition-colors hover:bg-white/[0.05] hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60"
            onClick={onLeave}
            type="button"
          >
            {copy.returnHome}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Room({ locale, roomId }: { locale: RoomLocale; roomId: string }) {
  const navigate = useNavigate();
  const [dialogPhase, setDialogPhase] = useState<"connecting" | "closing-for-full" | "closing-for-ready" | "closing-for-reconnect" | "full" | "ready">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [connectionRoute, setConnectionRoute] = useState<ConnectionRoute>("direct");
  const [progress, setProgress] = useState<ConnectionProgress>({
    websocket: { state: "pending", detail: "Waiting for signaling socket" },
    resource: { state: "pending", detail: "Waiting to request Cloudflare resources" },
    stun: { state: "pending", detail: "Checking STUN server" },
    turn: { state: "pending", detail: "Checking TURN server" },
    p2p: { state: "pending", detail: "Waiting for the other participant to join the room" },
    dataChannel: { state: "pending", detail: "Waiting for data channel" },
  });
  const sessionRef = useRef<NativeWebRTCSession | null>(null);

  useEffect(() => {
    const session = new NativeWebRTCSession(
      roomId,
      setProgress,
      () => setDialogPhase("closing-for-ready"),
      setError,
      () => {
        session.close();
        setDialogPhase("closing-for-full");
      },
      () => {
        setError("Data channel failed.");
        setConnectionRoute("direct");
        setDialogPhase("closing-for-reconnect");
      },
      setConnectionRoute,
    );
    sessionRef.current = session;
    session.connect();

    return () => {
      session.close();
      sessionRef.current = null;
    };
  }, [roomId]);

  const leave = () => {
    sessionRef.current?.close();
    void navigate({ to: locale === "zh" ? "/zh" : "/en" });
  };

  return (
    <Layout title={dialogPhase === "ready" ? roomCopy[locale].roomTitle(roomId) : roomCopy[locale].pageTitle(roomId)}>
      {dialogPhase === "full" ? (
        <RoomFullContent locale={locale} onLeave={leave} roomId={roomId} />
      ) : dialogPhase === "ready" || dialogPhase === "closing-for-reconnect" ? (
        <RoomWorkspace
          locale={locale}
          onExitComplete={() => {
            if (dialogPhase === "closing-for-reconnect") setDialogPhase("connecting");
          }}
          onLeave={leave}
          open={dialogPhase === "ready"}
          progress={progress}
          roomId={roomId}
          connectionRoute={connectionRoute}
        />
      ) : (
        <ConnectionDialog
          error={error}
          locale={locale}
          onExitComplete={() => {
            if (dialogPhase === "closing-for-full") setDialogPhase("full");
            if (dialogPhase === "closing-for-ready") setDialogPhase("ready");
          }}
          onLeave={leave}
          open={dialogPhase === "connecting"}
          progress={progress}
          roomId={roomId}
        />
      )}
    </Layout>
  );
}
