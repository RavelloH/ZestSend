import {
  RiArrowLeftLine,
  RiAddLine,
  RiCheckboxCircleFill,
  RiCheckDoubleLine,
  RiCheckLine,
  RiChat3Line,
  RiClockwiseLine,
  RiCloseCircleFill,
  RiDeleteBinLine,
  RiDownload2Line,
  RiEyeLine,
  RiErrorWarningLine,
  RiEqualizerLine,
  RiExchange2Line,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiFileEditLine,
  RiFileCodeLine,
  RiFileExcel2Line,
  RiFileImageLine,
  RiFileLine,
  RiFileMusicLine,
  RiFilePdf2Line,
  RiFilePpt2Line,
  RiFileTextLine,
  RiFileWord2Line,
  RiFileZipLine,
  RiFolderTransferLine,
  RiGlobalLine,
  RiMicLine,
  RiMic2Line,
  RiMicOffLine,
  RiMagicLine,
  RiPlayCircleLine,
  RiPulseLine,
  RiRadioButtonLine,
  RiPauseLine,
  RiPlayLine,
  RiRefreshLine,
  RiShareForwardLine,
  RiRouterLine,
  RiSignalCellular1Fill,
  RiSignalCellular2Fill,
  RiSignalCellular3Fill,
  RiSendPlane2Fill,
  RiStopLine,
  RiSpeedLine,
  RiLogoutBoxRLine,
  RiLock2Fill,
  RiLoader4Line,
  RiBrushLine,
  RiCameraLine,
  RiCameraOffLine,
  RiCameraSwitchLine,
  RiComputerLine,
  RiSettings3Line,
  RiVideoOnLine,
  RiWifiLine,
  RiVolumeUpLine,
  RiZoomInLine,
} from "@remixicon/react";
import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useNavigate } from "@tanstack/react-router";
import cuid from "cuid";
import { AnimatePresence, motion } from "framer-motion";
import { type CSSProperties, type DragEventHandler, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import Layout from "../components/Layout";
import { useTheme } from "../components/theme";
import { AutoTransition } from "../components/ui/auto-transition";
import { Clickable } from "../components/ui/clickable";
import { Dialog, DialogClose, DialogContent } from "../components/ui/dialog";
import { MagneticDock, type DockItemData } from "../components/ui/magnetic-dock";
import { OverlayScrollbar } from "../components/ui/overlay-scrollbar";
import { FileTransferManager, type FileTransferDiagnostics, type FileTransferSnapshot } from "../lib/file-transfer";
import type { MediaTransport } from "../lib/media-transport";
import type { SharedPlaybackCommand, SharedPlaybackMessage } from "../lib/shared-playback";
import {
  NativeWebRTCSession,
  type ConnectionRoute,
  type ConnectionProgress,
  type ConnectionState,
  type ConnectionStep,
  type SessionStatus,
  type WebRTCTransportDiagnostics,
} from "../lib/webrtc";

type StatusRowProps = {
  icon: typeof RiRouterLine;
  label: string;
  status: ConnectionProgress[keyof ConnectionProgress];
};

type ChatMessage = {
  deliveryStatus?: "sending" | "received" | "read" | "error";
  id: string;
  lastAttemptedAt?: number;
  text: string;
  sender: "local" | "remote";
  sentAt: number;
};

const workspaceShellClassName = "flex h-full min-h-0 w-full max-w-2xl flex-col pb-[clamp(6rem,7vh,7rem)] pt-6 lg:max-w-3xl";
const workspaceScrollClassName = "min-h-0 flex-1 px-2 pb-7 pt-4 pr-5 [mask-image:linear-gradient(to_bottom,transparent_0%,black_4rem,black_calc(100%-3rem),transparent_100%)]";
const workspaceComposerClassName = "relative h-28 shrink-0";

function WorkspaceShell({
  children,
  footer,
  status,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onSubmit,
  scrollKey,
}: {
  children: ReactNode;
  footer: ReactNode;
  status?: ReactNode;
  onDragEnter?: DragEventHandler<HTMLElement>;
  onDragLeave?: DragEventHandler<HTMLElement>;
  onDragOver?: DragEventHandler<HTMLElement>;
  onDrop?: DragEventHandler<HTMLElement>;
  onSubmit?: () => void;
  scrollKey: string | number;
}) {
  return (
    <section
      className={workspaceShellClassName}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <OverlayScrollbar className={workspaceScrollClassName} syncKey={scrollKey}>
        {children}
      </OverlayScrollbar>
      <form className="relative shrink-0 border-t border-white/10 pt-4" onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}>
        {status}
        <div className={workspaceComposerClassName}>{footer}</div>
      </form>
    </section>
  );
}

function WorkspaceEmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return <motion.div
    animate={{ opacity: 1 }}
    className="flex size-full min-h-0 flex-1 flex-col items-center justify-center text-center"
    exit={{ opacity: 0 }}
    initial={{ opacity: 0 }}
    transition={{ duration: 0.2, ease: "easeOut" }}
  >
    {icon}
    <p className="mt-4 max-w-sm text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/50">{message}</p>
  </motion.div>;
}

function appendChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return [...messages, message].sort((left, right) => left.id.localeCompare(right.id));
}

function displayedNumber(value: number, precision = 0): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
const ignoreDialogOpenChange = () => undefined;

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
    chatPlaceholder: "Write a message",
    chatEmpty: "Send a message to begin your private conversation",
    exit: "Exit room",
    exitCancel: "Stay in room",
    exitConfirm: "Exit room",
    exitDescription: "This will close your end-to-end connection and stop all room activity.",
    exitTitle: "Leave this room?",
    room: "ROOM",
    statusHint: "All values update from the active connection.",
    typing: "Typing...",
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
    chatPlaceholder: "输入消息",
    chatEmpty: "发送一条消息，开始私密对话",
    exit: "退出房间",
    exitCancel: "留在房间",
    exitConfirm: "退出房间",
    exitDescription: "这将关闭端对端连接，并停止房间内的所有活动。",
    exitTitle: "确认退出房间？",
    room: "房间",
    statusHint: "所有数值均来自当前活跃连接。",
    typing: "正在输入...",
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

function workspaceFromHash(): WorkspaceId | null {
  const workspaceId = window.location.hash.slice(1) as WorkspaceId;
  return workspaceOrder.includes(workspaceId) ? workspaceId : null;
}

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
  "Peer joined, preparing P2P connection": "另一位参与者已加入，正在准备 P2P 连接",
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
  "Opening data channels": "正在建立数据通道",
  "Data channels ready": "数据通道已就绪",
  "Data channel closed": "数据通道已关闭",
  "Data channel failed.": "与对方断开连接，正在重新连接。",
  "Reconnecting signaling socket": "正在重新连接信令 WebSocket",
  "Room temporarily reserved; retrying automatically": "房间暂时保留中，正在自动重试",
  "Reconnecting peer-to-peer connection": "正在重新连接端对端通道",
  "Reconnecting data channels": "正在重新连接数据通道",
  "Waiting for the other participant to reconnect": "正在等待另一位参与者重新连接",
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

function signalLevel(latency: number | undefined): 1 | 2 | 3 {
  if (latency === undefined) return 1;
  if (latency <= 50) return 3;
  if (latency <= 499) return 2;
  return 1;
}

function SignalIcon({ level, className }: { level: 1 | 2 | 3; className?: string }) {
  const Icon = level === 3 ? RiSignalCellular3Fill : level === 2 ? RiSignalCellular2Fill : RiSignalCellular1Fill;
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        animate={{ opacity: 1 }}
        className="inline-flex"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        key={level}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <Icon aria-hidden="true" className={className} />
      </motion.span>
    </AnimatePresence>
  );
}

function LatencyValue({ latency, realtimeConnection = false }: { latency: number; realtimeConnection?: boolean }) {
  const value = Math.round(latency);
  return (
    <NumberFlowGroup>
      <motion.span
        layout="position"
        className={`inline-flex items-center ${latencyColor(latency, realtimeConnection)}`}
        transition={{ layout: { duration: 0.42, ease: "easeOut" } }}
      >
        <NumberFlow
          className="inline-flex leading-none"
          value={value}
          willChange
        />
        <motion.span layout="position" className="ml-1" transition={{ layout: { duration: 0.42, ease: "easeOut" } }}>ms</motion.span>
      </motion.span>
    </NumberFlowGroup>
  );
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
        <AutoTransition
          as="span"
          className="absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center font-mono text-sm font-semibold leading-none tabular-nums"
          duration={0.22}
          transitionKey={status.channels !== undefined ? `channels-${status.channels}` : status.latency !== undefined ? "latency" : "empty"}
          type="fade"
        >
          {status.channels !== undefined ? (
            <span className="text-sky-100/55">{status.channels} / 3</span>
          ) : status.latency !== undefined ? (
            <LatencyValue latency={status.latency} realtimeConnection={realtimeConnection} />
          ) : null}
        </AutoTransition>
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
  onRequestLeave,
  onExitComplete,
  open,
  progress,
  roomId,
}: {
  error: string | null;
  locale: RoomLocale;
  onRequestLeave: () => void;
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
    <Dialog
      open={open}
      onExitComplete={onExitComplete}
      onOpenChange={ignoreDialogOpenChange}
      transitionDuration={0.18}
    >
      <DialogContent fadeDuration={0.18} fadeOnly aria-labelledby="connection-title" className="!max-w-2xl">
          <div className="flex flex-col gap-5 border-b border-white/10 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
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
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <button
                aria-label={copy.share}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] px-3 text-sm font-semibold tracking-[0.04em] text-sky-100/75 transition-colors hover:bg-white/[0.05] hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60 sm:h-10 sm:w-auto"
                onClick={() => void shareRoom()}
                type="button"
              >
                <RiShareForwardLine aria-hidden="true" className="size-5" />
                <span>{copy.share}</span>
              </button>
              <button
                aria-label={copy.leave}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 text-sm font-semibold tracking-[0.04em] text-rose-200 transition-colors hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-200/60 sm:h-10 sm:w-auto"
                onClick={onRequestLeave}
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

function transferredValue(bytes: number): { precision: number; unit: "B" | "KB" | "MB"; value: number } {
  if (bytes < 1_024) return { precision: 0, unit: "B", value: bytes };
  if (bytes < 1_024 * 1_024) return { precision: bytes < 10_240 ? 1 : 0, unit: "KB", value: bytes / 1_024 };
  return { precision: bytes < 10 * 1_024 * 1_024 ? 2 : 1, unit: "MB", value: bytes / (1_024 * 1_024) };
}

function useTransferRates(transferred?: { received: number; sent: number }) {
  const latestRef = useRef(transferred);
  const previousRef = useRef<{ received: number; sent: number } | null>(null);
  const [rates, setRates] = useState({ received: 0, sent: 0 });
  latestRef.current = transferred;

  useEffect(() => {
    previousRef.current = {
      received: transferred?.received ?? 0,
      sent: transferred?.sent ?? 0,
    };
    const timer = window.setInterval(() => {
      const current = {
        received: latestRef.current?.received ?? 0,
        sent: latestRef.current?.sent ?? 0,
      };
      const previous = previousRef.current ?? current;
      setRates({
        received: Math.max(0, current.received - previous.received),
        sent: Math.max(0, current.sent - previous.sent),
      });
      previousRef.current = current;
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return rates;
}

function DataTransferStats({ transferred, mode = "totals" }: { transferred?: { received: number; sent: number }; mode?: "rates" | "totals" }) {
  const rates = useTransferRates(transferred);
  const sent = transferred?.sent ?? 0;
  const received = transferred?.received ?? 0;
  const separator = <motion.span layout="position" className="mx-2 font-mono text-sky-100/35">·</motion.span>;
  const metric = (direction: "down" | "up", bytes: number, suffix = "") => (
    <motion.span layout="position" className="inline-flex items-baseline font-mono tabular-nums" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>
      <motion.span layout="position" className="mr-1 text-sky-200/70">{direction === "up" ? "↑" : "↓"}</motion.span>
      <FileSizeValue bytes={bytes} suffix={suffix} />
    </motion.span>
  );

  return (
    <NumberFlowGroup>
      <motion.div
        layout="position"
        className="flex shrink-0 flex-wrap items-baseline gap-y-1 text-xs font-medium text-sky-100/55 sm:text-sm"
        transition={{ layout: { duration: 0.42, ease: "easeOut" } }}
      >
        {mode === "totals" ? <>{metric("up", sent)}{separator}{metric("down", received)}{separator}<motion.span layout="position" className="inline-flex items-baseline font-mono tabular-nums"><FileSizeValue bytes={rates.sent + rates.received} suffix="/s" /></motion.span></> : <>{metric("up", rates.sent, "/s")}{separator}{metric("down", rates.received, "/s")}</>}
      </motion.div>
    </NumberFlowGroup>
  );
}

function HeaderConnectionToggle({
  connectionRoute,
  encryptedLabel,
  encryptedRelayLabel,
  latency,
  showRates,
  transferred,
}: {
  connectionRoute: ConnectionRoute;
  encryptedLabel: string;
  encryptedRelayLabel: string;
  latency?: number;
  showRates: boolean;
  transferred?: { received: number; sent: number };
}) {
  const [displayRates, setDisplayRates] = useState(showRates);
  const [phase, setPhase] = useState<"entering" | "exiting" | "visible">("visible");
  const requestedRatesRef = useRef(showRates);
  requestedRatesRef.current = showRates;

  useEffect(() => {
    if (phase === "visible" && displayRates !== showRates) setPhase("exiting");
    if (phase === "entering" && displayRates !== showRates) setPhase("exiting");
  }, [displayRates, phase, showRates]);

  const finishAnimation = () => {
    if (phase === "exiting") {
      setDisplayRates(requestedRatesRef.current);
      setPhase("entering");
      return;
    }
    if (phase === "entering") setPhase("visible");
  };

  return (
    <motion.span
      animate={{ opacity: phase === "exiting" ? 0 : 1 }}
      className="inline-flex min-w-0 items-center"
      initial={false}
      onAnimationComplete={finishAnimation}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {displayRates ? <DataTransferStats mode="rates" transferred={transferred} /> : (
        <motion.div
          layout="position"
          className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold tracking-[0.05em]"
          transition={{ layout: { duration: 0.32, ease: "easeOut" } }}
        >
          <RiLock2Fill aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />
          <motion.span layout="position" className="whitespace-nowrap text-emerald-300" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>
            {connectionRoute === "relay" ? encryptedRelayLabel : encryptedLabel}
          </motion.span>
          <motion.span layout="position" className="text-slate-400/60" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>|</motion.span>
          <motion.span layout="position" className={latency === undefined ? "text-slate-400" : latencyColor(latency, true)} transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>
            <SignalIcon className="size-4 shrink-0" level={signalLevel(latency)} />
          </motion.span>
          <NumberFlowGroup>
            <motion.span
              layout="position"
              className={`inline-flex shrink-0 items-baseline font-mono tabular-nums ${latency === undefined ? "text-slate-400" : latencyColor(latency, true)}`}
              transition={{ layout: { duration: 0.32, ease: "easeOut" } }}
            >
              {latency === undefined ? <motion.span layout="position">--</motion.span> : <NumberFlow value={Math.round(latency)} willChange />}
              <motion.span layout="position" className="ml-1" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>ms</motion.span>
            </motion.span>
          </NumberFlowGroup>
        </motion.div>
      )}
    </motion.span>
  );
}

function StatusMetric({ icon: Icon, label, locale, realtimeConnection = false, status }: {
  icon: typeof RiRouterLine;
  label: string;
  locale: RoomLocale;
  realtimeConnection?: boolean;
  status: ConnectionStep;
}) {
  const tone = status.latency !== undefined
    ? latencyColor(status.latency, realtimeConnection)
    : status.state === "active" || status.state === "ready"
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
        <AutoTransition
          as="span"
          className="mt-1 block truncate text-xs font-medium tracking-[0.03em] text-sky-100/50"
          duration={0.22}
          transitionKey={status.detail}
          type="fade"
        >
          {localizedDetail(locale, status.detail)}
        </AutoTransition>
      </div>
      {status.transferred !== undefined ? (
        <DataTransferStats transferred={status.transferred} />
      ) : (
        <AutoTransition
          as="span"
          className="inline-flex shrink-0 items-center font-mono text-sm font-semibold leading-none tabular-nums"
          duration={0.22}
          transitionKey={status.latency !== undefined ? "latency" : "empty"}
          type="fade"
        >
          {status.latency !== undefined ? <LatencyValue latency={status.latency} realtimeConnection={realtimeConnection} /> : null}
        </AutoTransition>
      )}
    </div>
  );
}

function ChatWorkspace({
  accent,
  emptyMessage,
  messages,
  onMarkRead,
  onSend,
  onTyping,
  peerTyping,
  placeholder,
  ready,
  typingLabel,
}: {
  accent: string;
  emptyMessage: string;
  messages: ChatMessage[];
  onMarkRead: (id: string) => boolean;
  onSend: (text: string) => boolean;
  onTyping: () => void;
  peerTyping: boolean;
  placeholder: string;
  ready: boolean;
  typingLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const readMessageIdsRef = useRef(new Set<string>());
  const hasFocusedComposerRef = useRef(false);
  const canSend = ready && draft.trim().length > 0;

  useEffect(() => {
    const viewport = messageListRef.current?.closest("[data-overlayscrollbars-viewport]");
    if (viewport instanceof HTMLElement) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (!ready || hasFocusedComposerRef.current) return;
    hasFocusedComposerRef.current = true;
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [ready]);

  useEffect(() => {
    const viewport = messageListRef.current?.closest("[data-overlayscrollbars-viewport]");
    if (!(viewport instanceof HTMLElement)) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const messageId = (entry.target as HTMLElement).dataset.chatMessageId;
        if (!messageId || readMessageIdsRef.current.has(messageId) || !onMarkRead(messageId)) continue;
        readMessageIdsRef.current.add(messageId);
      }
    }, { root: viewport, threshold: 0.65 });

    viewport.querySelectorAll<HTMLElement>("[data-chat-message-id]").forEach((message) => observer.observe(message));
    return () => observer.disconnect();
  }, [messages, onMarkRead, ready]);

  const send = () => {
    if (!canSend || !onSend(draft)) return;
    setDraft("");
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <WorkspaceShell
      footer={(
        <>
          <textarea
            aria-label={placeholder}
            className="absolute bottom-0 left-0 h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 pr-14 text-sm font-medium leading-relaxed tracking-[0.03em] text-sky-50 outline-none transition-colors placeholder:text-sky-100/35 focus:border-sky-100/35 focus:bg-black/30 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!ready}
            maxLength={4_000}
            onChange={(event) => {
              setDraft(event.target.value);
              if (event.target.value) onTyping();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            ref={composerRef}
            value={draft}
          />
          <button
            aria-label={placeholder}
            className="absolute bottom-3 right-3 inline-flex size-9 items-center justify-center rounded-xl text-sky-50 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/70 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!canSend}
            style={{ backgroundColor: canSend ? `${accent}80` : "rgb(255 255 255 / 0.08)" }}
            type="submit"
          >
            <RiSendPlane2Fill aria-hidden="true" className="size-4" />
          </button>
        </>
      )}
      status={(
        <AutoTransition
          as="span"
          aria-live="polite"
          className="pointer-events-none absolute bottom-full left-4 mb-3 text-xs font-medium leading-4 tracking-[0.04em] text-sky-100/45"
          duration={0.2}
          transitionKey={peerTyping ? "typing" : "idle"}
          type="fade"
        >
          {peerTyping ? typingLabel : null}
        </AutoTransition>
      )}
      onSubmit={send}
      scrollKey={messages.length}
    >
        <div ref={messageListRef} className={`flex min-h-full flex-col ${messages.length === 0 ? "" : "justify-end pt-8"}`}>
          <AnimatePresence initial={false} mode="popLayout">
            {messages.length === 0 ? (
              <WorkspaceEmptyState icon={<RiChat3Line aria-hidden="true" className="size-10 text-sky-200/55" />} key="empty-chat" message={emptyMessage} />
            ) : messages.map((message) => {
                const isLocal = message.sender === "local";
                return (
                  <motion.div key={message.id} layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className={`mb-5 flex flex-col ${isLocal ? "items-end" : "items-start"}`}
                      data-chat-message-id={isLocal ? undefined : message.id}
                      exit={{ opacity: 0, y: -6 }}
                      initial={{ opacity: 0, y: 10 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      <div className="relative max-w-[82%] sm:max-w-[72%]">
                        <p
                          className={`relative whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm font-medium leading-relaxed tracking-[0.03em] ${isLocal ? "rounded-br-none" : "rounded-bl-none"}`}
                          style={isLocal
                            ? { backgroundColor: `${accent}40`, color: "rgb(240 249 255 / 0.96)" }
                            : { backgroundColor: "rgb(0 0 0 / 0.25)", color: "rgb(224 242 254 / 0.88)" }}
                        >
                          {message.text}
                        </p>
                        <svg
                          aria-hidden="true"
                          className={`absolute bottom-0 ${isLocal ? "-right-2" : "-left-2 scale-x-[-1]"}`}
                          height="12"
                          viewBox="0 0 8 12"
                          width="8"
                        >
                          <path d="M 0 0 L 8 12 L 0 12 Z" fill={isLocal ? `${accent}40` : "rgb(0 0 0 / 0.25)"} />
                        </svg>
                      </div>
                      <p className={`mt-1.5 flex h-4 items-center gap-1.5 px-1 text-xs font-medium leading-none tabular-nums text-sky-100/40 ${isLocal ? "justify-end" : "justify-start"}`}>
                        <time dateTime={new Date(message.sentAt).toISOString()}>
                          {new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(message.sentAt)}
                        </time>
                        {isLocal ? <ChatDeliveryStatus status={message.deliveryStatus ?? "sending"} /> : null}
                      </p>
                    </motion.div>
                  </motion.div>
                );
              })}
          </AnimatePresence>
        </div>
    </WorkspaceShell>
  );
}

function ChatDeliveryStatus({ status }: { status: NonNullable<ChatMessage["deliveryStatus"]> }) {
  const Icon = status === "read"
    ? RiCheckDoubleLine
    : status === "received"
      ? RiCheckLine
      : status === "error"
        ? RiErrorWarningLine
        : RiLoader4Line;
  const color = status === "error" ? "text-rose-300/80" : status === "read" ? "text-sky-100/70" : "text-sky-100/60";

  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center self-center">
      <AutoTransition
        as="span"
        className="absolute inset-0 grid place-items-center"
        duration={0.2}
        presenceMode="wait"
        transitionKey={status}
        type="fade"
      >
        <Icon aria-hidden="true" className={`size-3.5 ${status === "sending" ? "animate-spin" : ""} ${color}`} />
      </AutoTransition>
    </span>
  );
}

function AudioSpectrum({
  accent,
  active,
  anchor,
  fillAvailableHeight = false,
  stream,
}: {
  accent: string;
  active: boolean;
  anchor: "bottom" | "top";
  fillAvailableHeight?: boolean;
  stream?: MediaStream;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const track = stream?.getAudioTracks().find((candidate) => candidate.readyState === "live");
    if (!canvas) return;

    const audioContext = track ? new AudioContext() : null;
    const analyser = audioContext?.createAnalyser();
    const source = audioContext && track ? audioContext.createMediaStreamSource(new MediaStream([track])) : null;
    const samples = new Uint8Array(1_024);
    const levels = new Float32Array(48);
    let frame = 0;

    if (analyser && source && audioContext) {
      analyser.fftSize = 2_048;
      analyser.minDecibels = -96;
      analyser.maxDecibels = -24;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      void audioContext.resume().catch(() => undefined);
    }

    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const targetWidth = Math.max(1, Math.round(width * ratio));
      const targetHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (analyser && audioContext) analyser.getByteFrequencyData(samples);
      const gap = Math.max(3, width / 190);
      const barWidth = Math.max(2, (width - gap * (levels.length - 1)) / levels.length);
      const maxHeight = height * 0.92;
      const minFrequency = 20;
      const maxFrequency = Math.min(20_000, (audioContext?.sampleRate ?? 48_000) / 2);
      const frequencyPerBin = (audioContext?.sampleRate ?? 48_000) / (analyser?.fftSize ?? 2_048);
      context.globalAlpha = active ? 1 : 0.42;

      for (let index = 0; index < levels.length; index += 1) {
        const lowFrequency = minFrequency * (maxFrequency / minFrequency) ** (index / levels.length);
        const highFrequency = minFrequency * (maxFrequency / minFrequency) ** ((index + 1) / levels.length);
        const start = Math.max(0, Math.floor(lowFrequency / frequencyPerBin));
        const end = Math.min(samples.length, Math.max(start + 1, Math.ceil(highFrequency / frequencyPerBin)));
        let peak = 0;
        for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) peak = Math.max(peak, samples[sampleIndex]);
        const target = active ? Math.pow(peak / 255, 0.58) : 0;
        levels[index] += (target - levels[index]) * (target > levels[index] ? 0.34 : 0.12);
        const barHeight = Math.max(4, levels[index] * maxHeight);
        const x = index * (barWidth + gap);
        const y = anchor === "top" ? 0 : height - barHeight;
        context.fillStyle = anchor === "top" ? "rgb(224 242 254 / 0.25)" : `${accent}55`;
        context.fillRect(x, y, barWidth, barHeight);
      }

      frame = window.requestAnimationFrame(draw);
    };

    draw();
    return () => {
      window.cancelAnimationFrame(frame);
      source?.disconnect();
      analyser?.disconnect();
      void audioContext?.close();
    };
  }, [accent, active, anchor, stream]);

  return <div className={fillAvailableHeight ? "flex min-h-0 w-full flex-1 basis-1/2" : "flex h-[clamp(8rem,28vh,13rem)] w-full shrink-0"}>
    <canvas aria-label={anchor === "top" ? "Remote audio spectrum" : "Local audio spectrum"} className="size-full" ref={canvasRef} />
  </div>;
}

type VideoQuality = "low" | "balanced" | "high";

type VideoTile = {
  id: "remote-camera" | "remote-screen" | "local-camera" | "local-screen";
  label: string;
  muted: boolean;
  stream: MediaStream;
};

type SharedPlayback = {
  currentTime: number;
  duration: number;
  id: string;
  kind: "audio" | "video";
  name: string;
  owner: "local" | "remote";
  playbackRate: number;
  playing: boolean;
};

type CapturableMediaElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function captureMediaStream(element: HTMLMediaElement): MediaStream | null {
  const capturable = element as CapturableMediaElement;
  return capturable.captureStream?.() ?? capturable.mozCaptureStream?.() ?? null;
}

function mediaDuration(element: HTMLMediaElement): number {
  return Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
}

function localMediaKind(file: File): "audio" | "video" | null {
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["mp4", "m4v", "mov", "mkv", "ogv", "webm"].includes(extension ?? "")) return "video";
  if (["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "weba"].includes(extension ?? "")) return "audio";
  return null;
}

function waitForMediaMetadata(element: HTMLMediaElement): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The selected media file could not be opened."));
    };
    const cleanup = () => {
      element.removeEventListener("loadedmetadata", onLoaded);
      element.removeEventListener("error", onError);
    };
    element.addEventListener("loadedmetadata", onLoaded, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

function VideoStream({ className, muted, stream, style }: { className?: string; muted?: boolean; stream: MediaStream; style?: CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stream]);

  return <video autoPlay className={className} muted={muted} playsInline ref={ref} style={style} />;
}

function FloatingVideoSidecars({ media, locale, onFocus }: { media: MediaTransport | null; locale: RoomLocale; onFocus: (id: VideoTile["id"]) => void }) {
  const [mediaVersion, setMediaVersion] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === "undefined" ? 1_280 : window.innerWidth);
  const boundsRef = useRef<HTMLDivElement>(null);
  const draggedBasePositionsRef = useRef(new Map<VideoTile["id"], { bottom: number; position: { left: number } | { right: number } }>());
  const pointerStartRef = useRef(new Map<VideoTile["id"], { x: number; y: number }>());
  const suppressClickRef = useRef(new Set<VideoTile["id"]>());
  const localStreamsRef = useRef(new Map<"camera-video" | "screen-video", MediaStream>());
  const signatureRef = useRef("");

  useEffect(() => {
    if (!media) return;
    return media.subscribe((slots) => {
      const signature = slots
        .filter((slot) => slot.id === "camera-video" || slot.id === "screen-video")
        .map((slot) => `${slot.id}:${slot.localState}:${slot.remoteState}:${slot.remoteStream?.id ?? ""}:${media.getLocalTrack(slot.id)?.id ?? ""}`)
        .join("|");
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      setMediaVersion((current) => current + 1);
    });
  }, [media]);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  const groups = useMemo(() => {
    const streamForLocalTrack = (id: "camera-video" | "screen-video", track: MediaStreamTrack | null) => {
      if (!track) {
        localStreamsRef.current.delete(id);
        return undefined;
      }
      const current = localStreamsRef.current.get(id);
      if (current?.getVideoTracks()[0] === track) return current;
      const stream = new MediaStream([track]);
      localStreamsRef.current.set(id, stream);
      return stream;
    };
    const copy = locale === "zh" ? {
      localCamera: "我的视频",
      localScreen: "我的屏幕",
      remoteCamera: "对方视频",
      remoteScreen: "对方屏幕",
    } : {
      localCamera: "YOUR VIDEO",
      localScreen: "YOUR SCREEN",
      remoteCamera: "THEIR VIDEO",
      remoteScreen: "THEIR SCREEN",
    };
    const remoteCamera = media?.getRemoteStream("camera-video");
    const remoteScreen = media?.getRemoteStream("screen-video");
    const localCamera = streamForLocalTrack("camera-video", media?.getLocalTrack("camera-video") ?? null);
    const localScreen = streamForLocalTrack("screen-video", media?.getLocalTrack("screen-video") ?? null);
    const remote: Array<Pick<VideoTile, "id" | "label" | "stream"> | null> = [
      remoteCamera ? { id: "remote-camera", label: copy.remoteCamera, stream: remoteCamera } : null,
      remoteScreen ? { id: "remote-screen", label: copy.remoteScreen, stream: remoteScreen } : null,
    ];
    const local: Array<Pick<VideoTile, "id" | "label" | "stream"> | null> = [
      localCamera ? { id: "local-camera", label: copy.localCamera, stream: localCamera } : null,
      localScreen ? { id: "local-screen", label: copy.localScreen, stream: localScreen } : null,
    ];
    const isVideoTile = (tile: Pick<VideoTile, "id" | "label" | "stream"> | null): tile is Pick<VideoTile, "id" | "label" | "stream"> => tile !== null;
    return { local: local.filter(isVideoTile), remote: remote.filter(isVideoTile) };
  }, [locale, media, mediaVersion]);

  if (!groups.local.length && !groups.remote.length) return null;

  const sideGutter = Math.max(0, (viewportWidth - 768) / 2);
  const cardWidth = Math.max(160, Math.min(560, sideGutter - 32));
  const cardHeight = cardWidth * 9 / 16;
  const floatingTiles = [
    ...groups.remote.map((tile, index) => ({ index, owner: "remote" as const, tile })),
    ...groups.local.map((tile, index) => ({ index, owner: "local" as const, tile })),
  ];

  return <div className="pointer-events-none fixed inset-x-0 bottom-28 top-20 z-40 hidden xl:block" ref={boundsRef}>
    <AnimatePresence initial>
      {floatingTiles.map(({ index, owner, tile }) => {
        const offset = Math.max(16, sideGutter - cardWidth - 24);
        const position = owner === "remote" ? { left: offset } : { right: offset };
        const defaultBottom = 4 + index * (cardHeight + 12);
        const draggedBasePosition = draggedBasePositionsRef.current.get(tile.id);
        return <motion.button
          animate={{ opacity: 1, scale: 1 }}
          aria-label={tile.label}
          className="pointer-events-auto group absolute touch-none cursor-grab overflow-hidden rounded-2xl border border-white/10 bg-black/35 text-left shadow-2xl shadow-black/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60 active:cursor-grabbing"
          drag
          dragConstraints={boundsRef}
          dragElastic={0.08}
          dragMomentum={false}
          exit={{ opacity: 0, scale: 0.96 }}
          initial={{ opacity: 0, scale: 0.96 }}
          key={tile.id}
          layout="position"
          onClick={(event) => {
            if (suppressClickRef.current.delete(tile.id)) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            onFocus(tile.id);
          }}
          onDragEnd={() => {
            suppressClickRef.current.add(tile.id);
            window.setTimeout(() => suppressClickRef.current.delete(tile.id), 500);
          }}
          onDragStart={() => {
            if (!draggedBasePositionsRef.current.has(tile.id)) draggedBasePositionsRef.current.set(tile.id, { bottom: defaultBottom, position });
            suppressClickRef.current.add(tile.id);
          }}
          onPointerDownCapture={(event) => pointerStartRef.current.set(tile.id, { x: event.clientX, y: event.clientY })}
          onPointerMoveCapture={(event) => {
            const start = pointerStartRef.current.get(tile.id);
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) suppressClickRef.current.add(tile.id);
          }}
          onPointerUpCapture={() => pointerStartRef.current.delete(tile.id)}
          onPointerCancelCapture={() => pointerStartRef.current.delete(tile.id)}
          style={{ ...(draggedBasePosition?.position ?? position), bottom: draggedBasePosition?.bottom ?? defaultBottom, height: cardHeight, width: cardWidth }}
          transition={{ layout: { damping: 28, mass: 0.7, stiffness: 300, type: "spring" }, opacity: { duration: 0.2 }, scale: { duration: 0.2 } }}
          type="button"
          whileTap={{ scale: 0.98 }}
        >
          <VideoStream className="block size-full object-contain" muted stream={tile.stream} />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-7 text-[10px] font-bold tracking-[0.08em] text-sky-50/85">{tile.label}</span>
          <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100"><span className="glass grid size-10 place-items-center !rounded-full text-sky-50"><RiZoomInLine aria-hidden="true" className="size-5" /></span></span>
        </motion.button>;
      })}
    </AnimatePresence>
  </div>;
}

function VideoShell({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return <section className="flex h-full min-h-0 w-full flex-col pb-[clamp(6rem,7vh,7rem)] pt-6">
    <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    <div className="mx-auto w-full max-w-2xl lg:max-w-3xl">
      <form className="relative shrink-0 border-t border-white/10 pt-4" onSubmit={(event) => event.preventDefault()}>
        <div className={workspaceComposerClassName}>{footer}</div>
      </form>
    </div>
  </section>;
}

function SpeakerVolumeDialog({
  locale,
  onOpenChange,
  onScreenShareVolumeChange,
  onSharedPlaybackVolumeChange,
  onVoiceVolumeChange,
  open,
  screenShareVolume,
  sharedPlaybackVolume,
  voiceVolume,
}: {
  locale: RoomLocale;
  onOpenChange: (open: boolean) => void;
  onScreenShareVolumeChange: (value: number) => void;
  onSharedPlaybackVolumeChange: (value: number) => void;
  onVoiceVolumeChange: (value: number) => void;
  open: boolean;
  screenShareVolume: number;
  sharedPlaybackVolume: number;
  voiceVolume: number;
}) {
  const copy = locale === "zh" ? {
    screen: "屏幕共享音量",
    sharedPlayback: "同播共享音量",
    speaker: "扬声器",
    voice: "语音通话音量",
  } : {
    screen: "Screen-share volume",
    sharedPlayback: "Shared playback volume",
    speaker: "Speaker",
    voice: "Voice call volume",
  };
  const controls = [
    [copy.voice, voiceVolume, onVoiceVolumeChange],
    [copy.screen, screenShareVolume, onScreenShareVolumeChange],
    [copy.sharedPlayback, sharedPlaybackVolume, onSharedPlaybackVolumeChange],
  ] as const;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-labelledby="speaker-volume-title" className="!max-w-md">
      <div className="p-6 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-sky-100/50">{copy.speaker}</p>
            <h2 className="mt-2 text-2xl font-bold tracking-[0.04em] text-sky-50" id="speaker-volume-title">{copy.speaker}</h2>
          </div>
          <DialogClose aria-label={locale === "zh" ? "关闭" : "Close"} />
        </div>
        {controls.map(([label, value, onChange]) => <label className="mt-7 flex items-center gap-4" key={label}>
          <span className="w-28 shrink-0 text-sm font-semibold text-sky-100/65">{label}</span>
          <input aria-label={label} className="h-1.5 w-full cursor-pointer accent-sky-300" max="1" min="0" onChange={(event) => onChange(Number(event.target.value))} step="0.01" type="range" value={value} />
          <NumberFlowGroup>
            <span className="inline-flex w-10 items-baseline justify-end text-sm font-semibold tabular-nums text-sky-100/70"><NumberFlow value={Math.round(value * 100)} willChange /><span>%</span></span>
          </NumberFlowGroup>
        </label>)}
      </div>
    </DialogContent>
  </Dialog>;
}

function VideoWorkspace({
  accent,
  cameraActive,
  cameraDeviceId,
  focusTileId,
  locale,
  media,
  onSelectCamera,
  onToggleCamera,
  onToggleScreenShare,
  onUpdateVideoQuality,
  quality,
  ready,
  screenShareActive,
  screenAudioFallbackOpen,
  onCloseScreenAudioFallback,
  onShareScreenWithoutAudio,
  onOpenSpeakerDialog,
  speakerActive,
}: {
  accent: string;
  cameraActive: boolean;
  cameraDeviceId: string | null;
  focusTileId: VideoTile["id"] | null;
  locale: RoomLocale;
  media: MediaTransport | null;
  onSelectCamera: (deviceId: string) => Promise<boolean>;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onUpdateVideoQuality: (quality: VideoQuality) => void;
  quality: VideoQuality;
  ready: boolean;
  screenShareActive: boolean;
  screenAudioFallbackOpen: boolean;
  onCloseScreenAudioFallback: () => void;
  onShareScreenWithoutAudio: () => void;
  onOpenSpeakerDialog: () => void;
  speakerActive: boolean;
}) {
  const [cameraInputs, setCameraInputs] = useState<MediaDeviceInfo[]>([]);
  const [cameraDialogOpen, setCameraDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [primaryId, setPrimaryId] = useState<VideoTile["id"] | null>(null);
  const [tileRotations, setTileRotations] = useState<Partial<Record<VideoTile["id"], number>>>({});
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const signatureRef = useRef("");
  const localStreamsRef = useRef(new Map<"camera-video" | "screen-video", MediaStream>());
  const videoSurfaceRef = useRef<HTMLDivElement>(null);
  const copy = locale === "zh" ? {
    camera: "摄像头",
    cameraOff: "打开摄像头",
    cameraOn: "关闭摄像头",
    chooseCamera: "选择摄像头",
    exitFullscreen: "退出全屏",
    fullscreen: "全屏",
    noVideo: "尚未有视频流",
    quality: "视频设置",
    qualityDescription: "带宽不足时会由浏览器自动降低实际编码质量。",
    screen: "屏幕共享",
    screenOff: "开始共享",
    screenOn: "停止共享",
    rotate: "旋转画面",
    speaker: "扬声器",
    videoQuality: "目标视频质量",
    localCamera: "我的视频",
    localScreen: "我的屏幕",
    remoteCamera: "对方视频",
    remoteScreen: "对方屏幕",
    low: "流畅",
    balanced: "均衡",
    high: "高清",
  } : {
    camera: "Camera",
    cameraOff: "Turn camera on",
    cameraOn: "Turn camera off",
    chooseCamera: "Choose camera",
    exitFullscreen: "Exit full screen",
    fullscreen: "Full screen",
    noVideo: "No video stream yet",
    quality: "Video settings",
    qualityDescription: "The browser automatically reduces the actual encode quality when bandwidth is limited.",
    screen: "Screen share",
    screenOff: "Start sharing",
    screenOn: "Stop sharing",
    rotate: "Rotate video",
    speaker: "Speaker",
    videoQuality: "Target video quality",
    localCamera: "YOUR VIDEO",
    localScreen: "YOUR SCREEN",
    remoteCamera: "THEIR VIDEO",
    remoteScreen: "THEIR SCREEN",
    low: "Smooth",
    balanced: "Balanced",
    high: "High definition",
  };

  useEffect(() => {
    if (!cameraDialogOpen) return;
    let cancelled = false;
    const refresh = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) setCameraInputs(devices.filter((device) => device.kind === "videoinput"));
    };
    void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [cameraDialogOpen]);

  useEffect(() => {
    if (!media) return;
    return media.subscribe((slots) => {
      const signature = slots
        .filter((slot) => slot.id === "camera-video" || slot.id === "screen-video")
        .map((slot) => `${slot.id}:${slot.localState}:${slot.remoteState}:${slot.remoteStream?.id ?? ""}:${media.getLocalTrack(slot.id)?.id ?? ""}`)
        .join("|");
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      setMediaVersion((value) => value + 1);
    });
  }, [media]);

  const tiles = useMemo<VideoTile[]>(() => {
    const remoteCamera = media?.getRemoteStream("camera-video");
    const remoteScreen = media?.getRemoteStream("screen-video");
    const localCamera = media?.getLocalTrack("camera-video");
    const localScreen = media?.getLocalTrack("screen-video");
    const localStream = (id: "camera-video" | "screen-video", track: MediaStreamTrack | null) => {
      if (!track) {
        localStreamsRef.current.delete(id);
        return undefined;
      }
      const current = localStreamsRef.current.get(id);
      if (current?.getVideoTracks()[0] === track) return current;
      const stream = new MediaStream([track]);
      localStreamsRef.current.set(id, stream);
      return stream;
    };
    const localCameraStream = localStream("camera-video", localCamera ?? null);
    const localScreenStream = localStream("screen-video", localScreen ?? null);
    return [
      remoteCamera ? { id: "remote-camera", label: copy.remoteCamera, muted: false, stream: remoteCamera } : null,
      remoteScreen ? { id: "remote-screen", label: copy.remoteScreen, muted: false, stream: remoteScreen } : null,
      localCameraStream ? { id: "local-camera", label: copy.localCamera, muted: true, stream: localCameraStream } : null,
      localScreenStream ? { id: "local-screen", label: copy.localScreen, muted: true, stream: localScreenStream } : null,
    ].filter((tile): tile is VideoTile => tile !== null);
  }, [copy.localCamera, copy.localScreen, copy.remoteCamera, copy.remoteScreen, media, mediaVersion]);
  const primary = tiles.find((tile) => tile.id === primaryId) ?? tiles[0];
  const secondary = tiles.filter((tile) => tile.id !== primary?.id);
  const secondarySpan = secondary.length === 1 ? "col-span-6 mx-auto w-full max-w-md" : secondary.length === 2 ? "col-span-3" : "col-span-2";

  useEffect(() => {
    if (focusTileId && tiles.some((tile) => tile.id === focusTileId)) setPrimaryId(focusTileId);
  }, [focusTileId, tiles]);

  const toggleFullscreen = () => {
    const surface = videoSurfaceRef.current;
    if (!surface) return;
    if (document.fullscreenElement === surface) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void surface.requestFullscreen().catch(() => undefined);
  };

  useEffect(() => {
    const syncFullscreen = () => setVideoFullscreen(document.fullscreenElement === videoSurfaceRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const activeIds = new Set(tiles.map((tile) => tile.id));
    setTileRotations((current) => Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id as VideoTile["id"]))) as Partial<Record<VideoTile["id"], number>>);
  }, [tiles]);

  return <VideoShell
    footer={<div className="flex h-full items-center justify-center gap-3 sm:gap-10">
      {[
        { active: screenShareActive, icon: RiComputerLine, label: screenShareActive ? copy.screenOn : copy.screen, onClick: onToggleScreenShare },
        { active: speakerActive, icon: RiVolumeUpLine, label: copy.speaker, onClick: onOpenSpeakerDialog },
        { active: cameraActive, icon: cameraActive ? RiCameraOffLine : RiCameraLine, label: cameraActive ? copy.cameraOn : copy.cameraOff, onClick: onToggleCamera },
        { active: Boolean(cameraDeviceId), icon: RiCameraSwitchLine, label: copy.chooseCamera, onClick: () => setCameraDialogOpen(true) },
        { active: false, icon: RiSettings3Line, label: copy.quality, onClick: () => setSettingsDialogOpen(true) },
      ].map(({ active, icon: Icon, label, onClick }) => <div className="flex min-w-0 flex-col items-center gap-1 sm:gap-2" key={label}>
        <Clickable
          aria-label={label}
          className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50 transition-[background-color] duration-200"
          disabled={!ready}
          hoverScale={1.08}
          onClick={onClick}
          style={{ backgroundColor: active ? `${accent}33` : "rgb(0 0 0 / 0.25)" }}
          tapScale={0.94}
        ><Icon aria-hidden="true" className="size-7" /></Clickable>
        <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{label}</span>
      </div>)}
    </div>}
  >
    <div className={`flex h-full min-h-0 items-center justify-center ${primary ? "px-2 py-3" : "px-2 pb-7 pt-4 pr-5"}`}>
      <AutoTransition className="flex size-full min-h-0 items-center justify-center" duration={0.22} presenceMode="wait" transitionKey={primary ? "active" : "empty"} type="fade">
        {!primary ? <WorkspaceEmptyState icon={<RiVideoOnLine aria-hidden="true" className="size-10 text-sky-200/55" />} message={copy.noVideo} /> : (
        <motion.div
          className="group/video relative grid h-full min-h-0 w-full max-w-5xl grid-cols-6 gap-2.5"
          layout
          ref={videoSurfaceRef}
          style={{ gridTemplateRows: secondary.length > 0 ? "minmax(0, 1fr) clamp(4.5rem, 15vh, 9rem)" : "minmax(0, 1fr)" }}
          transition={{ layout: { damping: 30, mass: 0.8, stiffness: 280, type: "spring" } }}
        >
          {[primary, ...secondary].map((tile) => {
            const isPrimary = tile.id === primary.id;
            return <motion.button
              aria-label={isPrimary ? tile.label : `${locale === "zh" ? "切换到主画面：" : "Make primary: "}${tile.label}`}
              className={`relative flex min-h-0 items-center justify-center overflow-hidden bg-black/30 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60 ${isPrimary ? "col-span-6 row-start-1 cursor-default rounded-2xl shadow-2xl shadow-black/15" : `${secondarySpan} group/thumb row-start-2 cursor-pointer rounded-xl shadow-xl shadow-black/10`}`}
              key={tile.id}
              layout
              onClick={() => { if (!isPrimary) setPrimaryId(tile.id); }}
              transition={{ layout: { damping: 30, mass: 0.8, stiffness: 280, type: "spring" } }}
              type="button"
            >
              <VideoStream className="block size-full object-contain transition-transform duration-300" muted={tile.muted} stream={tile.stream} style={{ transform: isPrimary ? `rotate(${tileRotations[tile.id] ?? 0}deg)` : undefined }} />
              <span className={`${isPrimary ? "left-3 top-3 px-2 py-1 text-xs" : "left-2 top-2 px-1.5 py-0.5 text-[10px]"} absolute rounded-md bg-black/35 font-bold tracking-[0.08em] text-sky-50/80`}>{tile.label}</span>
              {!isPrimary ? <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100"><span className="glass grid size-12 place-items-center !rounded-full text-sky-50"><RiZoomInLine aria-hidden="true" className="size-6" /></span></span> : null}
            </motion.button>;
          })}
          <div className="pointer-events-none absolute right-3 top-3 z-10 flex gap-2 opacity-0 transition-opacity duration-200 group-hover/video:opacity-100 group-focus-within/video:opacity-100">
            <button aria-label={copy.rotate} className="glass pointer-events-auto grid size-10 place-items-center !rounded-xl text-sky-100/80 transition-colors hover:bg-white/[0.1] hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60" onClick={() => { if (primary) setTileRotations((current) => ({ ...current, [primary.id]: ((current[primary.id] ?? 0) + 90) % 360 })); }} type="button"><RiClockwiseLine aria-hidden="true" className="size-5" /></button>
            <button aria-label={videoFullscreen ? copy.exitFullscreen : copy.fullscreen} className="glass pointer-events-auto grid size-10 place-items-center !rounded-xl text-sky-100/80 transition-colors hover:bg-white/[0.1] hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60" onClick={toggleFullscreen} type="button">{videoFullscreen ? <RiFullscreenExitLine aria-hidden="true" className="size-5" /> : <RiFullscreenLine aria-hidden="true" className="size-5" />}</button>
          </div>
        </motion.div>
        )}
      </AutoTransition>
    </div>
    <Dialog open={screenAudioFallbackOpen} onOpenChange={(open) => { if (!open) onCloseScreenAudioFallback(); }}>
      <DialogContent aria-labelledby="screen-audio-fallback-title" className="!max-w-md">
        <div className="p-7 sm:p-8">
          <RiVolumeUpLine aria-hidden="true" className="size-9" style={{ color: accent }} />
          <h2 className="mt-5 text-2xl font-bold tracking-[0.04em] text-sky-50" id="screen-audio-fallback-title">{locale === "zh" ? "无法共享系统音频" : "System audio is unavailable"}</h2>
          <p className="mt-3 text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/60">{locale === "zh" ? "当前浏览器或系统无法启动系统音频源。是否仅共享视频画面？" : "The browser or operating system could not start system audio. Share the screen without audio instead?"}</p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <Clickable className="glass !h-12 rounded-xl border border-white/10 text-base font-semibold text-sky-100/75" hoverScale={1.02} onClick={onCloseScreenAudioFallback} tapScale={0.97}>{locale === "zh" ? "取消" : "Cancel"}</Clickable>
            <Clickable className="!h-12 rounded-xl border border-sky-200/25 text-base font-semibold text-sky-50" hoverScale={1.02} onClick={onShareScreenWithoutAudio} style={{ backgroundColor: `${accent}33` }} tapScale={0.97}>{locale === "zh" ? "仅共享视频" : "Share video only"}</Clickable>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={cameraDialogOpen} onOpenChange={setCameraDialogOpen}><DialogContent aria-labelledby="video-camera-title" className="!max-w-md"><div className="p-6 sm:p-7"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.12em] text-sky-100/50">{copy.camera}</p><h2 className="mt-2 text-2xl font-bold tracking-[0.04em] text-sky-50" id="video-camera-title">{copy.chooseCamera}</h2></div><DialogClose aria-label={locale === "zh" ? "关闭" : "Close"} /></div><div className="mt-7 divide-y divide-white/10 border-y border-white/10">{cameraInputs.map((device, index) => <button className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold tracking-[0.03em] text-sky-100/75 transition-colors hover:text-sky-50" key={device.deviceId || index} onClick={() => void onSelectCamera(device.deviceId).then(() => setCameraDialogOpen(false))} type="button"><span className="truncate">{device.label || `${copy.camera} ${index + 1}`}</span>{device.deviceId === cameraDeviceId ? <RiCheckLine aria-hidden="true" className="size-5 shrink-0 text-sky-200" /> : null}</button>)}{cameraInputs.length === 0 ? <p className="py-4 text-sm font-medium text-sky-100/50">{locale === "zh" ? "未发现可用摄像头" : "No camera found"}</p> : null}</div></div></DialogContent></Dialog>
    <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}><DialogContent aria-labelledby="video-settings-title" className="!max-w-md"><div className="p-6 sm:p-7"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.12em] text-sky-100/50">{copy.quality}</p><h2 className="mt-2 text-2xl font-bold tracking-[0.04em] text-sky-50" id="video-settings-title">{copy.videoQuality}</h2></div><DialogClose aria-label={locale === "zh" ? "关闭" : "Close"} /></div><p className="mt-3 text-sm leading-relaxed text-sky-100/55">{copy.qualityDescription}</p><div className="mt-7 grid grid-cols-3 gap-2">{(["low", "balanced", "high"] as VideoQuality[]).map((option) => <Clickable className="glass !h-11 rounded-xl border border-white/10 text-sm font-semibold text-sky-100/75" hoverScale={1.02} key={option} onClick={() => { onUpdateVideoQuality(option); setSettingsDialogOpen(false); }} style={{ backgroundColor: option === quality ? `${accent}33` : "rgb(0 0 0 / 0.25)" }} tapScale={0.97}>{copy[option]}</Clickable>)}</div></div></DialogContent></Dialog>
  </VideoShell>;
}

function formatPlaybackTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function WatchWorkspace({
  accent,
  error,
  locale,
  media,
  onControl,
  onOpenFile,
  onOpenSpeakerDialog,
  playback,
  ready,
  speakerActive,
}: {
  accent: string;
  error: string | null;
  locale: RoomLocale;
  media: MediaTransport | null;
  onControl: (command: SharedPlaybackCommand, options?: { currentTime?: number; playbackRate?: number }) => void;
  onOpenFile: (file: File) => Promise<void>;
  onOpenSpeakerDialog: () => void;
  playback: SharedPlayback | null;
  ready: boolean;
  speakerActive: boolean;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const localStreamsRef = useRef(new Map<"audio" | "video", MediaStream>());
  const signatureRef = useRef("");
  const watchSurfaceRef = useRef<HTMLDivElement>(null);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [playbackChromeVisible, setPlaybackChromeVisible] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const copy = locale === "zh" ? {
    choose: "选择本地音频或视频",
    current: "正在同播",
    empty: "打开一个本地音频或视频，和对方一起看或听。",
    fullscreen: "全屏",
    exitFullscreen: "退出全屏",
    noVideo: "正在播放音频",
    pause: "暂停",
    play: "播放",
    remote: "对方发起",
    speaker: "扬声器",
    speed: "播放速度",
    stop: "结束同播",
    timeline: "播放进度",
  } : {
    choose: "Choose local media",
    current: "NOW PLAYING",
    empty: "Open a local audio or video file to watch or listen together.",
    fullscreen: "Full screen",
    exitFullscreen: "Exit full screen",
    noVideo: "Audio is playing",
    pause: "Pause",
    play: "Play",
    remote: "STARTED BY THEM",
    speaker: "Speaker",
    speed: "Speed",
    stop: "End session",
    timeline: "Playback position",
  };

  useEffect(() => {
    if (!media) return;
    return media.subscribe((slots) => {
      const signature = slots
        .filter((slot) => slot.id === "playback-audio" || slot.id === "playback-video")
        .map((slot) => `${slot.id}:${slot.localState}:${slot.remoteState}:${slot.remoteStream?.id ?? ""}:${media.getLocalTrack(slot.id)?.id ?? ""}`)
        .join("|");
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      setMediaVersion((value) => value + 1);
    });
  }, [media]);

  const streams = useMemo(() => {
    const local = (kind: "audio" | "video", track: MediaStreamTrack | null) => {
      if (!track) {
        localStreamsRef.current.delete(kind);
        return undefined;
      }
      const current = localStreamsRef.current.get(kind);
      if (current?.getTracks()[0] === track) return current;
      const stream = new MediaStream([track]);
      localStreamsRef.current.set(kind, stream);
      return stream;
    };
    const localVideo = local("video", media?.getLocalTrack("playback-video") ?? null);
    const localAudio = local("audio", media?.getLocalTrack("playback-audio") ?? null);
    return {
      audio: playback?.owner === "local" ? localAudio : media?.getRemoteStream("playback-audio"),
      video: playback?.owner === "local" ? localVideo : media?.getRemoteStream("playback-video"),
    };
  }, [media, mediaVersion, playback?.owner]);

  const duration = playback?.duration && playback.duration > 0 ? playback.duration : 1;
  const currentTime = Math.min(playback?.currentTime ?? 0, duration);
  const chooseFile = () => pickerRef.current?.click();
  const showPlaybackChrome = playback?.kind !== "video" || playbackChromeVisible;
  const toggleFullscreen = () => {
    const surface = watchSurfaceRef.current;
    if (!surface) return;
    if (document.fullscreenElement === surface) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void surface.requestFullscreen().catch(() => undefined);
  };

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === watchSurfaceRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    setPlaybackChromeVisible(false);
    setSpeedMenuOpen(false);
  }, [playback?.id]);

  return <VideoShell
    footer={<div className="flex h-full items-center justify-center gap-4 sm:gap-10">
      <input
        accept="audio/*,video/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onOpenFile(file);
        }}
        ref={pickerRef}
        type="file"
      />
      <div className="flex flex-col items-center gap-1 sm:gap-2">
        <Clickable
          aria-label={copy.speaker}
          className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50 transition-[background-color] duration-200"
          hoverScale={1.08}
          onClick={onOpenSpeakerDialog}
          style={{ backgroundColor: speakerActive ? `${accent}33` : "rgb(0 0 0 / 0.25)" }}
          tapScale={0.94}
        >
          <RiVolumeUpLine aria-hidden="true" className="size-7" />
        </Clickable>
        <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{copy.speaker}</span>
      </div>
      <div className="flex flex-col items-center gap-1 sm:gap-2">
        <Clickable
          aria-label={playback?.playing ? copy.pause : copy.play}
          className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50 transition-[background-color] duration-200"
          disabled={!ready || !playback}
          hoverScale={1.08}
          onClick={() => onControl(playback?.playing ? "pause" : "play")}
          style={{ backgroundColor: playback?.playing ? `${accent}33` : "rgb(0 0 0 / 0.25)" }}
          tapScale={0.94}
        >
          {playback?.playing ? <RiPauseLine aria-hidden="true" className="size-7" /> : <RiPlayLine aria-hidden="true" className="ml-0.5 size-7" />}
        </Clickable>
        <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{playback?.playing ? copy.pause : copy.play}</span>
      </div>
      <div className="flex flex-col items-center gap-1 sm:gap-2">
        <Clickable
          aria-label={copy.stop}
          className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border text-sky-50 transition-[background-color,border-color,color] duration-200"
          disabled={!ready || !playback}
          hoverScale={1.08}
          onClick={() => onControl("stop")}
          style={playback ? { backgroundColor: "rgba(136, 19, 55, 0.45)", borderColor: "rgba(244, 63, 94, 0.42)", color: "rgb(255 228 230)" } : { backgroundColor: "rgb(0 0 0 / 0.25)" }}
          tapScale={0.94}
        ><RiStopLine aria-hidden="true" className="size-7" /></Clickable>
        <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{copy.stop}</span>
      </div>
    </div>}
  >
    <div className="flex h-full min-h-0 items-center justify-center px-2 py-3">
      <AutoTransition className="flex size-full min-h-0 items-center justify-center" duration={0.22} presenceMode="wait" transitionKey={playback?.id ?? "empty"} type="fade">
        {!playback ? <div className="flex h-full min-h-0 w-full max-w-5xl">
        <button
          className="flex size-full min-h-0 flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed border-sky-100/20 bg-black/15 px-6 text-center text-sky-100/70 transition-colors hover:border-sky-100/45 hover:bg-black/25 hover:text-sky-50 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!ready}
          onClick={chooseFile}
          type="button"
        >
          <RiPlayCircleLine aria-hidden="true" className="size-12 text-sky-200/55" />
          <span className="mt-4 text-sm font-semibold tracking-[0.05em] text-sky-100/70">{copy.choose}</span>
          <span className="mt-2 max-w-md text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/50">{copy.empty}</span>
        </button>
      </div> : <div className="flex h-full min-h-0 w-full max-w-5xl flex-col justify-center">
        <div
          className="relative min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/35 shadow-2xl shadow-black/25"
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPlaybackChromeVisible(false); }}
          onFocusCapture={() => setPlaybackChromeVisible(true)}
          onMouseEnter={() => setPlaybackChromeVisible(true)}
          onMouseLeave={() => { setPlaybackChromeVisible(false); setSpeedMenuOpen(false); }}
          ref={watchSurfaceRef}
        >
          {playback.kind === "video" && streams.video ? <VideoStream className="block size-full object-contain" muted stream={streams.video} /> : (
            <div className="flex size-full flex-col items-center justify-center px-6 text-center" style={{ background: `radial-gradient(circle at 50% 38%, ${accent}2d, transparent 45%)` }}>
              <RiFileMusicLine aria-hidden="true" className="size-14" style={{ color: accent }} />
              {streams.audio ? <AudioSpectrum accent={accent} active={playback.playing} anchor="bottom" stream={streams.audio} /> : null}
              <p className="mt-2 text-sm font-bold tracking-[0.08em] text-sky-100/60">{copy.noVideo}</p>
            </div>
          )}
          <div className={`absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-5 py-4 transition-opacity duration-200 ${showPlaybackChrome ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            <div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.16em] text-sky-100/55">{copy.current}</p><p className="mt-1 truncate text-sm font-bold tracking-[0.04em] text-sky-50 sm:text-base">{playback.name}</p></div>
            {playback.owner === "remote" ? <span className="shrink-0 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] text-sky-100/70">{copy.remote}</span> : null}
          </div>
          <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pb-4 pt-12 transition-opacity duration-200 ${showPlaybackChrome ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            <label className="block" aria-label={copy.timeline}>
              <input aria-label={copy.timeline} className="h-1.5 w-full cursor-pointer accent-sky-200" disabled={!ready} max={duration} min="0" onChange={(event) => onControl("seek", { currentTime: Number(event.target.value) })} step="0.1" type="range" value={currentTime} />
            </label>
            <div className="mt-2 flex items-center justify-between font-mono text-xs font-semibold tabular-nums text-sky-100/75"><span>{formatPlaybackTime(currentTime)}</span><span>{formatPlaybackTime(playback.duration)}</span></div>
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-white/10 pt-3">
              <div className="relative">
                <button aria-expanded={speedMenuOpen} aria-haspopup="menu" aria-label={copy.speed} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2.5 text-xs font-bold tabular-nums text-sky-100/80 transition-colors hover:bg-white/10 hover:text-sky-50" onClick={() => setSpeedMenuOpen((current) => !current)} type="button"><RiSpeedLine aria-hidden="true" className="size-4" />{playback.playbackRate}×</button>
                {speedMenuOpen ? <div aria-label={copy.speed} className="glass absolute bottom-[calc(100%+0.75rem)] right-0 z-10 grid min-w-32 overflow-hidden !rounded-2xl p-2 text-sky-100" role="menu">{[0.75, 1, 1.25, 1.5].map((rate) => <button className="rounded-xl border border-transparent px-3 py-2.5 text-left text-sm font-semibold tabular-nums text-sky-100/75 transition-colors hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-sky-50" key={rate} onClick={() => { onControl("rate", { playbackRate: rate }); setSpeedMenuOpen(false); }} style={{ backgroundColor: playback.playbackRate === rate ? `${accent}33` : undefined }} type="button">{rate}×</button>)}</div> : null}
              </div>
              {playback.kind === "video" ? <button aria-label={isFullscreen ? copy.exitFullscreen : copy.fullscreen} className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-sky-100/80 transition-colors hover:bg-white/10 hover:text-sky-50" onClick={toggleFullscreen} type="button">{isFullscreen ? <RiFullscreenExitLine aria-hidden="true" className="size-4" /> : <RiFullscreenLine aria-hidden="true" className="size-4" />}</button> : null}
            </div>
            {error ? <p className="mt-3 text-center text-xs font-semibold tracking-[0.03em] text-rose-200">{error}</p> : null}
          </div>
        </div>
      </div>}
      </AutoTransition>
    </div>
  </VideoShell>;
}

function VoiceWorkspace({
  accent,
  locale,
  microphoneActive,
  microphoneError,
  microphoneDeviceId,
  microphonePending,
  media,
  noiseReductionActive,
  onToggleNoiseReduction,
  onSelectMicrophone,
  onOpenSpeakerDialog,
  onToggleMicrophone,
  ready,
  speakerActive,
}: {
  accent: string;
  locale: RoomLocale;
  microphoneActive: boolean;
  microphoneError: string | null;
  microphoneDeviceId: string | null;
  microphonePending: boolean;
  media: MediaTransport | null;
  noiseReductionActive: boolean;
  onToggleNoiseReduction: () => void;
  onSelectMicrophone: (deviceId: string) => Promise<boolean>;
  onOpenSpeakerDialog: () => void;
  onToggleMicrophone: () => void;
  ready: boolean;
  speakerActive: boolean;
}) {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [mediaVersion, setMediaVersion] = useState(0);
  const slotSignatureRef = useRef("");
  const remoteStream = media?.getRemoteStream("camera-audio");
  const localTrack = media?.getLocalTrack("camera-audio") ?? null;
  const localStream = useMemo(() => localTrack ? new MediaStream([localTrack]) : undefined, [localTrack]);
  const copy = locale === "zh"
    ? {
      local: "我",
      noiseReduction: "降噪",
      microphone: "麦克风",
      microphoneInput: "选择麦克风",
      microphoneOff: "开启麦克风",
      microphoneOn: "关闭麦克风",
      remote: "对方",
      speaker: "扬声器",
      voiceChanger: "变声器",
    }
    : {
      local: "YOU",
      noiseReduction: "Noise reduction",
      microphone: "Microphone",
      microphoneInput: "Choose microphone",
      microphoneOff: "Turn microphone on",
      microphoneOn: "Turn microphone off",
      remote: "THEM",
      speaker: "Speaker",
      voiceChanger: "Voice changer",
    };

  useEffect(() => {
    if (!deviceDialogOpen) return;
    let disposed = false;
    const refreshInputs = async () => {
      setDeviceLoading(true);
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!disposed) setAudioInputs(devices.filter((device) => device.kind === "audioinput"));
      } finally {
        if (!disposed) setDeviceLoading(false);
      }
    };
    void refreshInputs();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshInputs);
    return () => {
      disposed = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refreshInputs);
    };
  }, [deviceDialogOpen]);

  const selectMicrophone = async (deviceId: string) => {
    if (await onSelectMicrophone(deviceId)) setDeviceDialogOpen(false);
  };

  useEffect(() => {
    if (!media) return;
    return media.subscribe((slots) => {
      const signature = slots
        .filter((slot) => slot.id === "camera-audio")
        .map((slot) => `${slot.localState}:${slot.remoteState}:${slot.remoteStream?.id ?? ""}:${media.getLocalTrack(slot.id)?.id ?? ""}`)
        .join("|");
      if (signature === slotSignatureRef.current) return;
      slotSignatureRef.current = signature;
      setMediaVersion((version) => version + 1);
    });
  }, [media]);

  return (
    <WorkspaceShell
      footer={(
        <div className="flex h-full items-center justify-center gap-3 sm:gap-10">
          <div className="flex min-w-0 flex-col items-center gap-1 sm:gap-2">
            <Clickable
              aria-label={copy.noiseReduction}
              className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50 transition-[background-color] duration-200"
              disabled={!ready || !microphoneActive || microphonePending}
              hoverScale={1.08}
              onClick={onToggleNoiseReduction}
              style={{ backgroundColor: noiseReductionActive ? `${accent}33` : "rgb(0 0 0 / 0.25)" }}
              tapScale={0.94}
            >
              <RiEqualizerLine aria-hidden="true" className="size-7" />
            </Clickable>
            <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{copy.noiseReduction}</span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 sm:gap-2">
            <Clickable aria-label={copy.speaker} className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50 transition-[background-color] duration-200" hoverScale={1.08} onClick={onOpenSpeakerDialog} style={{ backgroundColor: speakerActive ? `${accent}33` : "rgb(0 0 0 / 0.25)" }} tapScale={0.94}>
              <RiVolumeUpLine aria-hidden="true" className="size-7" />
            </Clickable>
            <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{copy.speaker}</span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 sm:gap-2">
            <Clickable
              aria-label={microphoneActive ? copy.microphoneOn : copy.microphoneOff}
              className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50 transition-[background-color,color,opacity] duration-200"
              disabled={!ready || microphonePending}
              hoverScale={1.08}
              onClick={onToggleMicrophone}
              tapScale={0.94}
              style={{ backgroundColor: microphoneActive ? `${accent}33` : "rgb(0 0 0 / 0.25)" }}
            >
              <AutoTransition
                as="span"
                className="grid place-items-center"
                duration={0.18}
                presenceMode="wait"
                transitionKey={microphoneActive ? "on" : "off"}
                type="fade"
              >
                {microphoneActive
                  ? <RiMicLine aria-hidden="true" className="size-8" />
                  : <RiMicOffLine aria-hidden="true" className="size-8" />}
              </AutoTransition>
            </Clickable>
            <AutoTransition as="span" className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:inline-block" duration={0.18} presenceMode="wait" transitionKey={microphoneActive ? "on" : "off"} type="fade">
              {microphoneActive ? copy.microphoneOn : copy.microphoneOff}
            </AutoTransition>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 sm:gap-2">
            <Clickable aria-label={copy.microphoneInput} className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50" disabled={!ready || !microphoneActive || microphonePending} hoverScale={1.08} onClick={() => setDeviceDialogOpen(true)} tapScale={0.94}>
              <RiMic2Line aria-hidden="true" className="size-7" />
            </Clickable>
            <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{copy.microphoneInput}</span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 sm:gap-2">
            <Clickable aria-label={copy.voiceChanger} className="glass !size-16 !min-h-16 !min-w-16 !rounded-full border border-white/10 text-sky-50" disabled hoverScale={1.08} tapScale={0.94}>
              <RiMagicLine aria-hidden="true" className="size-7" />
            </Clickable>
            <span className="pointer-events-none hidden min-h-4 select-none text-xs font-bold tracking-[0.08em] text-sky-100/55 sm:block">{copy.voiceChanger}</span>
          </div>
        </div>
      )}
      status={microphoneError ? (
        <AutoTransition
          aria-live="polite"
          className="absolute bottom-full left-4 mb-3 text-xs font-medium tracking-[0.04em] text-rose-200/70"
          duration={0.2}
          transitionKey={microphoneError}
          type="fade"
        >
          {microphoneError}
        </AutoTransition>
      ) : undefined}
      scrollKey={mediaVersion}
    >
      <div className="flex h-full min-h-0 flex-col px-2">
        <AudioSpectrum accent={accent} active={Boolean(remoteStream)} anchor="top" fillAvailableHeight stream={remoteStream} />
        <AudioSpectrum accent={accent} active={microphoneActive} anchor="bottom" fillAvailableHeight stream={localStream} />
      </div>
      <Dialog open={deviceDialogOpen} onOpenChange={setDeviceDialogOpen}>
        <DialogContent aria-labelledby="voice-device-title" className="!max-w-md">
          <div className="p-6 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold tracking-[0.12em] text-sky-100/50">{copy.microphone}</p>
                <h2 id="voice-device-title" className="mt-2 text-2xl font-bold tracking-[0.04em] text-sky-50">{copy.microphoneInput}</h2>
              </div>
              <DialogClose aria-label={locale === "zh" ? "关闭" : "Close"} />
            </div>
            <div className="mt-7 divide-y divide-white/10 border-y border-white/10">
              {deviceLoading ? <p className="py-4 text-sm font-medium text-sky-100/50">{locale === "zh" ? "正在查找设备" : "Looking for devices"}</p> : audioInputs.map((device, index) => (
                <button className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold tracking-[0.03em] text-sky-100/75 transition-colors hover:text-sky-50" key={device.deviceId || index} onClick={() => void selectMicrophone(device.deviceId)} type="button">
                  <span className="truncate">{device.label || `${copy.microphone} ${index + 1}`}</span>
                  {device.deviceId === microphoneDeviceId ? <RiCheckLine aria-hidden="true" className="size-5 shrink-0 text-sky-200" /> : null}
                </button>
              ))}
              {!deviceLoading && audioInputs.length === 0 ? <p className="py-4 text-sm font-medium text-sky-100/50">{locale === "zh" ? "未发现可用麦克风" : "No microphone found"}</p> : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}

function fileIcon(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic"].includes(extension)) return RiFileImageLine;
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(extension)) return RiFileMusicLine;
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(extension)) return RiFileZipLine;
  if (extension === "pdf") return RiFilePdf2Line;
  if (["doc", "docx", "odt", "rtf"].includes(extension)) return RiFileWord2Line;
  if (["xls", "xlsx", "csv", "ods"].includes(extension)) return RiFileExcel2Line;
  if (["ppt", "pptx", "odp"].includes(extension)) return RiFilePpt2Line;
  if (["txt", "md", "mdx", "log", "json", "yaml", "yml", "xml"].includes(extension)) return RiFileTextLine;
  if (["js", "ts", "tsx", "jsx", "css", "html", "py", "rs", "go", "java", "c", "cpp", "h", "sh", "sql"].includes(extension)) return RiFileCodeLine;
  return RiFileLine;
}

function FileSizeValue({ bytes, suffix = "" }: { bytes: number; suffix?: string }) {
  const unit = bytes < 1_024 ? "B" : bytes < 1_024 * 1_024 ? "KB" : bytes < 1_024 * 1_024 * 1_024 ? "MB" : "GB";
  const divisor = unit === "B" ? 1 : unit === "KB" ? 1_024 : unit === "MB" ? 1_024 * 1_024 : 1_024 * 1_024 * 1_024;
  const precision = unit === "MB" && bytes < 10 * 1_024 * 1_024 || unit === "GB" ? 1 : 0;
  const displayedValue = displayedNumber(bytes / divisor, precision);
  return (
    <motion.span layout="position" className="inline-flex items-baseline" transition={{ layout: { duration: 0.42, ease: "easeOut" } }}>
      <NumberFlow format={{ maximumFractionDigits: precision, minimumFractionDigits: precision }} value={displayedValue} willChange />
      <motion.span layout="position" className="ml-1" transition={{ layout: { duration: 0.42, ease: "easeOut" } }}>{unit}{suffix}</motion.span>
    </motion.span>
  );
}

function EtaValue({ seconds }: { seconds: number | null }) {
  if (seconds === null) return <motion.span layout="position">--</motion.span>;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  const remainingSeconds = seconds % 60;
  return <motion.span layout="position" className="inline-flex items-baseline">
    {hours > 0 ? <><NumberFlow value={hours} willChange /><motion.span layout="position" className="ml-0.5">h</motion.span><motion.span layout="position" className="mx-1" /></> : null}
    {hours > 0 || minutes > 0 ? <><NumberFlow value={minutes} willChange /><motion.span layout="position" className="ml-0.5">m</motion.span><motion.span layout="position" className="mx-1" /></> : null}
    <NumberFlow value={remainingSeconds} willChange /><motion.span layout="position" className="ml-0.5">s</motion.span>
  </motion.span>;
}

function formatByteCount(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-b border-white/10 py-2.5 first:pt-0 sm:[&:nth-child(-n+3)]:pt-0">
    <p className="text-[0.65rem] font-bold tracking-[0.12em] text-sky-100/45">{label}</p>
    <p className="mt-1 truncate font-mono text-xs font-medium tracking-[0.02em] text-sky-50/85 sm:text-sm">{value}</p>
  </div>;
}

type TransferDiagnostics = {
  file: FileTransferDiagnostics;
  transport: WebRTCTransportDiagnostics;
};

function FileWorkspace({ accent, files, locale, onAccept, onCancel, onDelete, onDiagnostics, onDownload, onOffer, onPause, onResend, ready }: {
  accent: string;
  files: FileTransferSnapshot[];
  locale: RoomLocale;
  onAccept: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onDiagnostics: (id: string) => Promise<TransferDiagnostics | null>;
  onDownload: (id: string) => void;
  onPause: (id: string) => void;
  onOffer: (files: FileList | File[]) => void;
  onResend: (id: string) => void;
  ready: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const [previewFile, setPreviewFile] = useState<FileTransferSnapshot | null>(null);
  const [diagnosticFile, setDiagnosticFile] = useState<FileTransferSnapshot | null>(null);
  const [diagnostics, setDiagnostics] = useState<TransferDiagnostics | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const diagnosticClicksRef = useRef(new Map<string, { count: number; timer: number }>());
  const copy = locale === "zh"
    ? { accept: "接收", reject: "拒绝", cancel: "取消", choose: "拖入、粘贴或选择文件", empty: "选择文件以发送", offered: "对方向你发送了一个文件", sending: "正在发送", waiting: "等待对方确认", receiving: "正在接收", paused: "已暂停", complete: "传输完成", cancelled: "已取消", error: "传输失败", preview: "预览", view: "查看", pause: "暂停", resume: "继续", stop: "停止", save: "保存", remove: "删除", resend: "再次发送", previewUnsupported: "不支持预览此文件类型" }
    : { accept: "Receive", reject: "Reject", cancel: "Cancel", choose: "Drop, paste, or choose files", empty: "Choose files to send", offered: "The other participant wants to send you a file", sending: "Sending", waiting: "Waiting for acceptance", receiving: "Receiving", paused: "Paused", complete: "Transfer complete", cancelled: "Cancelled", error: "Transfer failed", preview: "Preview", view: "View", pause: "Pause", resume: "Resume", stop: "Stop", save: "Save", remove: "Delete", resend: "Send again", previewUnsupported: "This file type cannot be previewed" };

  const stateLabel = (file: FileTransferSnapshot) => file.state === "offered"
    ? file.direction === "incoming" ? copy.offered : copy.waiting
    : file.state === "waiting" ? copy.waiting
    : file.state === "transferring" ? file.paused ? copy.paused : file.direction === "incoming" ? copy.receiving : copy.sending
    : file.state === "complete" ? copy.complete
    : file.state === "cancelled" ? copy.cancelled
    : file.error || copy.error;

  useEffect(() => {
      const onPaste = (event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length || !ready) return;
        event.preventDefault();
        onOffer(files);
      };
      window.addEventListener("paste", onPaste);
      return () => window.removeEventListener("paste", onPaste);
    }, [onOffer, ready]);

  useEffect(() => {
    if (!diagnosticFile) return;
    let cancelled = false;
    const refresh = async () => {
      const snapshot = await onDiagnostics(diagnosticFile.id);
      if (!cancelled) setDiagnostics(snapshot);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [diagnosticFile, onDiagnostics]);

  useEffect(() => () => {
    diagnosticClicksRef.current.forEach(({ timer }) => window.clearTimeout(timer));
    diagnosticClicksRef.current.clear();
  }, []);

  const openDiagnostics = (file: FileTransferSnapshot) => {
    const current = diagnosticClicksRef.current.get(file.id);
    if (current) window.clearTimeout(current.timer);
    const count = (current?.count ?? 0) + 1;
    const timer = window.setTimeout(() => diagnosticClicksRef.current.delete(file.id), 500);
    diagnosticClicksRef.current.set(file.id, { count, timer });
    if (count !== 3) return;
    window.clearTimeout(timer);
    diagnosticClicksRef.current.delete(file.id);
    setDiagnostics(null);
    setDiagnosticFile(file);
  };

  return (
    <WorkspaceShell
      footer={(
        <button
          className={`inline-flex h-full w-full shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-3 text-sm font-semibold tracking-[0.04em] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isDragging ? "border-sky-100/70 bg-white/[0.07] text-sky-50" : "border-sky-100/20 bg-black/15 text-sky-100/70 hover:bg-black/25 hover:text-sky-50"}`}
          disabled={!ready}
          onClick={() => pickerRef.current?.click()}
          type="button"
        >
          <RiAddLine aria-hidden="true" className="size-5" />
          <span>{copy.choose}</span>
        </button>
      )}
      onDragEnter={(event) => {
        if (!ready || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragging(false);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDragging(false);
        if (ready && event.dataTransfer.files.length) onOffer(event.dataTransfer.files);
      }}
      scrollKey={files.map((file) => `${file.id}-${file.state}-${file.transferredBytes}`).join("|")}
    >
      <input className="sr-only" multiple onChange={(event) => { if (event.target.files?.length) onOffer(event.target.files); event.target.value = ""; }} ref={pickerRef} type="file" />
      {files.length === 0 ? <WorkspaceEmptyState icon={<RiFolderTransferLine aria-hidden="true" className="size-10 text-sky-200/55" />} message={copy.empty} /> : <div className="space-y-3 pt-4"><AnimatePresence initial={false}>{files.map((file) => {
        const progress = file.size ? Math.min(100, file.transferredBytes / file.size * 100) : file.state === "complete" ? 100 : 0;
        const confirmed = file.size ? Math.min(100, file.confirmedBytes / file.size * 100) : file.state === "complete" ? 100 : 0;
        const Icon = fileIcon(file.name);
        const eta = file.state === "complete" && file.duration !== null ? Math.max(0, Math.round(file.duration / 1000)) : file.eta;
        const displaySpeed = file.state === "complete" ? file.averageSpeed : file.speed;
        const isIncoming = file.direction === "incoming";
        const active = file.state === "transferring";
        const actionClass = "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 px-2 py-2 text-xs font-semibold tracking-[0.02em] transition-colors disabled:cursor-not-allowed disabled:opacity-35";
        const preview = () => setPreviewFile(file);
        const action = (label: string, IconComponent: typeof RiEyeLine, onClick: () => void, style?: CSSProperties, disabled = false, transitionKey = label) => <Clickable className="h-full w-full min-w-0" disabled={disabled} enableHoverScale hoverScale={1.035} interactive={false} tapScale={0.97}><button className={`${actionClass} h-full w-full`} disabled={disabled} onClick={onClick} style={style} type="button"><AutoTransition as="span" className="inline-flex min-w-0 items-center justify-center gap-1.5" duration={0.18} presenceMode="wait" transitionKey={transitionKey} type="fade"><IconComponent aria-hidden="true" className="size-4 shrink-0" /><span className="truncate">{label}</span></AutoTransition></button></Clickable>;
        let actions: ReactNode[];
        if (isIncoming && file.state === "offered") actions = [action(copy.preview, RiEyeLine, preview, { backgroundColor: `${accent}40` }), action(copy.accept, RiDownload2Line, () => onAccept(file.id), { backgroundColor: "rgba(16, 185, 129, 0.28)" }), action(copy.reject, RiDeleteBinLine, () => onCancel(file.id), { backgroundColor: "rgba(244, 63, 94, 0.28)" })];
        else if (isIncoming && active) actions = [action(copy.preview, RiEyeLine, preview, undefined, true), action(file.paused ? copy.resume : copy.pause, file.paused ? RiPlayLine : RiPauseLine, () => onPause(file.id), { backgroundColor: "rgba(16, 185, 129, 0.28)" }), action(copy.stop, RiStopLine, () => onCancel(file.id), { backgroundColor: "rgba(244, 63, 94, 0.28)" })];
        else if (isIncoming && file.state === "complete") actions = [action(copy.view, RiEyeLine, preview, { backgroundColor: `${accent}40` }), action(copy.save, RiDownload2Line, () => onDownload(file.id), { backgroundColor: "rgba(16, 185, 129, 0.28)" }), action(copy.remove, RiDeleteBinLine, () => onDelete(file.id), { backgroundColor: "rgba(244, 63, 94, 0.28)" })];
        else if (!isIncoming && file.state === "complete") actions = [action(copy.view, RiEyeLine, preview, { backgroundColor: `${accent}40` }), action(copy.resend, RiRefreshLine, () => onResend(file.id), { backgroundColor: "rgba(16, 185, 129, 0.28)" }), action(copy.cancel, RiDeleteBinLine, () => onDelete(file.id), { backgroundColor: "rgba(244, 63, 94, 0.28)" })];
        else actions = [action(copy.view, RiEyeLine, preview), action(active && !file.paused ? copy.pause : copy.resume, file.paused ? RiPlayLine : RiPauseLine, () => onPause(file.id), { backgroundColor: "rgba(16, 185, 129, 0.28)" }, !active), action(copy.cancel, RiCloseCircleFill, () => onCancel(file.id), { backgroundColor: "rgba(244, 63, 94, 0.28)" })];
        return <motion.article animate={{ opacity: 1, y: 0 }} className="overflow-hidden border-b border-white/10 pb-4" exit={{ height: 0, opacity: 0, y: -10, paddingBottom: 0 }} initial={{ opacity: 0, y: 10 }} key={file.id} layout transition={{ layout: { duration: 0.3, ease: "easeOut" }, opacity: { duration: 0.18 }, height: { duration: 0.26, ease: "easeInOut" }, y: { duration: 0.22, ease: "easeOut" } }}><div className="flex min-w-0 items-stretch gap-3"><button aria-label={file.name} className="grid aspect-square w-16 shrink-0 place-items-center text-sky-200/65" onClick={() => openDiagnostics(file)} type="button"><Icon aria-hidden="true" className="size-11" /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold tracking-[0.04em] text-sky-50">{file.name}</p><div className="mt-3 space-y-1.5"><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><motion.div animate={{ width: `${progress}%` }} className="h-full rounded-full" initial={{ width: "0%" }} style={{ backgroundColor: accent }} transition={{ type: "spring", stiffness: 220, damping: 28 }} /></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><motion.div animate={{ width: `${confirmed}%` }} className="h-full rounded-full bg-sky-100/45" initial={{ width: "0%" }} transition={{ type: "spring", stiffness: 220, damping: 28 }} /></div></div><NumberFlowGroup><motion.div layout="position" className="mt-2 flex flex-wrap items-baseline gap-y-1 text-xs font-medium text-sky-100/45" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}><motion.span layout="position" className="inline-flex items-baseline font-mono tabular-nums"><NumberFlow value={Math.round(progress)} willChange /><motion.span layout="position">%</motion.span></motion.span><motion.span layout="position" className="mx-2 font-mono">·</motion.span><motion.span layout="position" className="inline-flex items-baseline font-mono tabular-nums"><FileSizeValue bytes={file.transferredBytes} /><motion.span layout="position" className="mx-1">/</motion.span><FileSizeValue bytes={file.size} /></motion.span><motion.span layout="position" className="mx-2 font-mono">·</motion.span><motion.span layout="position" className="inline-flex items-baseline font-mono tabular-nums">{displaySpeed > 0 ? <FileSizeValue bytes={displaySpeed} suffix="/s" /> : <motion.span layout="position">-- /s</motion.span>}</motion.span><motion.span layout="position" className="mx-2 font-mono">·</motion.span><motion.span layout="position" className="inline-flex items-baseline font-mono tabular-nums"><EtaValue seconds={eta} /></motion.span><motion.span layout="position" className="mx-2 font-mono">·</motion.span><motion.span layout="position" className="inline-flex"><AutoTransition as="span" className="inline-flex tracking-[0.03em]" duration={0.18} presenceMode="wait" transitionKey={`${file.state}-${file.paused}-${file.error ?? ""}`} type="fade">{stateLabel(file)}</AutoTransition></motion.span></motion.div></NumberFlowGroup><div className="mt-3 grid grid-cols-3 gap-2">{actions}</div></div></div></motion.article>;
      })}</AnimatePresence></div>}
      <Dialog open={previewFile !== null} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <DialogContent aria-labelledby="file-preview-title" className="!max-w-md">
          <div className="p-6 sm:p-8">
            <p className="text-xs font-bold tracking-[0.12em] text-sky-100/50">{locale === "zh" ? "文件预览" : "FILE PREVIEW"}</p>
            <h2 className="mt-3 truncate text-xl font-bold tracking-[0.04em] text-sky-50 sm:text-2xl" id="file-preview-title">{previewFile?.name}</h2>
            <p className="mt-5 text-sm font-medium tracking-[0.04em] text-sky-100/60">{copy.previewUnsupported}</p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={diagnosticFile !== null} onOpenChange={(open) => { if (!open) { setDiagnosticFile(null); setDiagnostics(null); } }}>
        <DialogContent aria-labelledby="file-diagnostics-title" className="!max-w-2xl">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-start justify-between gap-5 border-b border-white/10 p-5 sm:p-6">
              <div className="min-w-0">
                <p className="text-[0.65rem] font-bold tracking-[0.14em] text-sky-100/45">{locale === "zh" ? "传输诊断" : "TRANSFER DIAGNOSTICS"}</p>
                <h2 className="mt-2 truncate text-lg font-bold tracking-[0.04em] text-sky-50 sm:text-xl" id="file-diagnostics-title">{diagnosticFile?.name}</h2>
              </div>
              <DialogClose aria-label={locale === "zh" ? "关闭传输诊断" : "Close transfer diagnostics"} data-dialog-autofocus />
            </div>
            {diagnostics ? <div className="grid grid-cols-2 gap-x-6 px-5 py-4 sm:grid-cols-3 sm:px-6">
              <DiagnosticItem label={locale === "zh" ? "连接路径" : "Route"} value={diagnostics.file.connectionRoute === "relay" ? "TURN relay" : "Direct"} />
              <DiagnosticItem label={locale === "zh" ? "ICE RTT" : "ICE RTT"} value={diagnostics.transport.currentRoundTripTime === null ? "--" : `${Math.round(diagnostics.transport.currentRoundTripTime)} ms`} />
              <DiagnosticItem label={locale === "zh" ? "TURN 传输协议" : "TURN transport"} value={diagnostics.transport.relayProtocol?.toUpperCase() ?? "--"} />
              <DiagnosticItem label={locale === "zh" ? "本地 / 远端协议" : "Local / remote protocol"} value={`${diagnostics.transport.localProtocol?.toUpperCase() ?? "--"} / ${diagnostics.transport.remoteProtocol?.toUpperCase() ?? "--"}`} />
              <DiagnosticItem label={locale === "zh" ? "分块 / 分段" : "Block / segment"} value={`${formatByteCount(diagnostics.file.blockSize)} / ${formatByteCount(diagnostics.file.segmentSize)}`} />
              <DiagnosticItem label={locale === "zh" ? "飞行窗口" : "In-flight window"} value={`${diagnostics.file.inFlightBlocks} / ${diagnostics.file.maxInFlightBlocks} blocks`} />
              <DiagnosticItem label={locale === "zh" ? "已确认区块" : "Confirmed blocks"} value={`${diagnostics.file.completedBlocks} / ${diagnostics.file.blockCount}`} />
              <DiagnosticItem label={locale === "zh" ? "远端 Credit" : "Remote credit"} value={formatByteCount(diagnostics.file.remoteCredit)} />
              <DiagnosticItem label={locale === "zh" ? "Bulk 缓冲" : "Bulk buffer"} value={diagnostics.transport.bufferedAmount.bulk === null ? "--" : formatByteCount(diagnostics.transport.bufferedAmount.bulk)} />
              <DiagnosticItem label={locale === "zh" ? "未确认字节" : "Unconfirmed bytes"} value={formatByteCount(diagnostics.file.inFlightBytes)} />
              <DiagnosticItem label={locale === "zh" ? "接收重组队列" : "Receive assembly"} value={`${diagnostics.file.pendingReceiveBlocks} blocks`} />
              <DiagnosticItem label={locale === "zh" ? "完整性重试" : "Integrity retries"} value={String(diagnostics.file.retries)} />
              <DiagnosticItem label={locale === "zh" ? "候选对" : "Candidate pair"} value={`${diagnostics.transport.localCandidateType ?? "--"} -> ${diagnostics.transport.remoteCandidateType ?? "--"}`} />
              <DiagnosticItem label={locale === "zh" ? "可用上行带宽" : "Available uplink"} value={diagnostics.transport.availableOutgoingBitrate === null ? "--" : `${formatByteCount(diagnostics.transport.availableOutgoingBitrate / 8)}/s`} />
              <DiagnosticItem label={locale === "zh" ? "候选对发送 / 接收" : "Pair sent / received"} value={diagnostics.transport.bytesSent === null || diagnostics.transport.bytesReceived === null ? "--" : `${formatByteCount(diagnostics.transport.bytesSent)} / ${formatByteCount(diagnostics.transport.bytesReceived)}`} />
              <DiagnosticItem label={locale === "zh" ? "发送侧丢弃" : "Discarded on send"} value={diagnostics.transport.packetsDiscardedOnSend === null ? "--" : String(diagnostics.transport.packetsDiscardedOnSend)} />
              <DiagnosticItem label={locale === "zh" ? "SCTP 状态" : "SCTP state"} value={diagnostics.transport.sctpState ?? "--"} />
              <DiagnosticItem label={locale === "zh" ? "SCTP 平滑 RTT" : "SCTP smoothed RTT"} value={diagnostics.transport.sctpSmoothedRoundTripTime === null ? "--" : `${Math.round(diagnostics.transport.sctpSmoothedRoundTripTime)} ms`} />
              <DiagnosticItem label={locale === "zh" ? "SCTP 拥塞窗口" : "SCTP congestion window"} value={diagnostics.transport.sctpCongestionWindow === null ? "--" : formatByteCount(diagnostics.transport.sctpCongestionWindow)} />
              <DiagnosticItem label={locale === "zh" ? "SCTP 接收窗口" : "SCTP receiver window"} value={diagnostics.transport.sctpReceiverWindow === null ? "--" : formatByteCount(diagnostics.transport.sctpReceiverWindow)} />
            </div> : <p className="px-5 py-6 text-sm font-medium tracking-[0.04em] text-sky-100/55 sm:px-6">{locale === "zh" ? "正在读取本地传输状态..." : "Reading local transfer state..."}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}

function RoomWorkspace({
  chatMessages,
  fileTransfers,
  locale,
  onExitComplete,
  onLeave,
  onMarkChatMessageRead,
  onChatTyping,
  onAcceptFile,
  onCancelFile,
  onDeleteFile,
  onFileDiagnostics,
  onDownloadFile,
  onOfferFiles,
  onPauseFile,
  onResendFile,
  microphoneActive,
  microphoneDeviceId,
  microphoneError,
  microphonePending,
  media,
  sharedPlayback,
  sharedPlaybackError,
  onOpenSharedPlayback,
  onSharedPlaybackControl,
  noiseReductionActive,
  onToggleNoiseReduction,
  onSelectMicrophone,
  onToggleMicrophone,
  cameraActive,
  cameraDeviceId,
  cameraPending,
  onSelectCamera,
  onToggleCamera,
  onToggleScreenShare,
  onUpdateVideoQuality,
  screenShareActive,
  screenAudioFallbackOpen,
  onCloseScreenAudioFallback,
  onShareScreenWithoutAudio,
  screenShareVolume,
  onScreenShareVolumeChange,
  sharedPlaybackVolume,
  onSharedPlaybackVolumeChange,
  videoQuality,
  volume,
  onVolumeChange,
  peerTyping,
  open,
  progress,
  roomId,
  connectionRoute,
  onSendChatMessage,
  voiceActive,
  videoActive,
}: {
  chatMessages: ChatMessage[];
  fileTransfers: FileTransferSnapshot[];
  locale: RoomLocale;
  onExitComplete?: () => void;
  onLeave: () => void;
  onMarkChatMessageRead: (id: string) => boolean;
  onChatTyping: () => void;
  onAcceptFile: (id: string) => void;
  onCancelFile: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onFileDiagnostics: (id: string) => Promise<TransferDiagnostics | null>;
  onDownloadFile: (id: string) => void;
  onOfferFiles: (files: FileList | File[]) => void;
  onPauseFile: (id: string) => void;
  onResendFile: (id: string) => void;
  microphoneActive: boolean;
  microphoneDeviceId: string | null;
  microphoneError: string | null;
  microphonePending: boolean;
  media: MediaTransport | null;
  sharedPlayback: SharedPlayback | null;
  sharedPlaybackError: string | null;
  onOpenSharedPlayback: (file: File) => Promise<void>;
  onSharedPlaybackControl: (command: SharedPlaybackCommand, options?: { currentTime?: number; playbackRate?: number }) => void;
  noiseReductionActive: boolean;
  onToggleNoiseReduction: () => void;
  onSelectMicrophone: (deviceId: string) => Promise<boolean>;
  onToggleMicrophone: () => void;
  cameraActive: boolean;
  cameraDeviceId: string | null;
  cameraPending: boolean;
  onSelectCamera: (deviceId: string) => Promise<boolean>;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onUpdateVideoQuality: (quality: VideoQuality) => void;
  screenShareActive: boolean;
  screenAudioFallbackOpen: boolean;
  onCloseScreenAudioFallback: () => void;
  onShareScreenWithoutAudio: () => void;
  screenShareVolume: number;
  onScreenShareVolumeChange: (value: number) => void;
  sharedPlaybackVolume: number;
  onSharedPlaybackVolumeChange: (value: number) => void;
  videoQuality: VideoQuality;
  volume: number;
  onVolumeChange: (value: number) => void;
  peerTyping: boolean;
  open: boolean;
  progress: ConnectionProgress;
  roomId: string;
  connectionRoute: ConnectionRoute;
  onSendChatMessage: (text: string) => boolean;
  voiceActive: boolean;
  videoActive: boolean;
}) {
  const copy = roomCopy[locale];
  const { theme } = useTheme();
  const workspace = workspaceCopy[locale];
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId | null>(() => workspaceFromHash());
  const [focusedVideoTileId, setFocusedVideoTileId] = useState<VideoTile["id"] | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isExitDialogOpen, setExitDialogOpen] = useState(false);
  const [isSpeakerDialogOpen, setSpeakerDialogOpen] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [showConnectionRates, setShowConnectionRates] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const observedChatMessageCount = useRef(chatMessages.length);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  useEffect(() => {
    const syncWorkspaceFromHash = () => setActiveWorkspace(workspaceFromHash());
    window.addEventListener("hashchange", syncWorkspaceFromHash);
    return () => window.removeEventListener("hashchange", syncWorkspaceFromHash);
  }, []);

  useEffect(() => {
    const newMessages = chatMessages.slice(observedChatMessageCount.current);
    observedChatMessageCount.current = chatMessages.length;
    if (activeWorkspace === "chat") return;
    const receivedCount = newMessages.filter((message) => message.sender === "remote").length;
    if (receivedCount) setUnreadChatCount((count) => count + receivedCount);
  }, [activeWorkspace, chatMessages]);

  useEffect(() => {
    if (activeWorkspace === "chat") setUnreadChatCount(0);
  }, [activeWorkspace]);

  const requestExit = () => {
    if (isExiting) return;
    setExitDialogOpen(false);
    setIsExiting(true);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      onLeave();
    }, 300);
  };
  const [runningWorkspaces, setRunningWorkspaces] = useState<WorkspaceId[]>([]);

  const activateWorkspace = (workspaceId: WorkspaceId) => {
    setActiveWorkspace(workspaceId);
    if (workspaceId === "chat") setUnreadChatCount(0);
    const hash = `#${workspaceId}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setRunningWorkspaces((current) => current.includes(workspaceId) ? current : [...current, workspaceId]);
  };

  const fileRunning = fileTransfers.some((file) => file.state === "transferring");
  const pendingFileRequests = fileTransfers.filter((file) => file.direction === "incoming" && file.state === "offered").length;
  const speakerActive = volume > 0 || screenShareVolume > 0 || sharedPlaybackVolume > 0;

  const dockItems: DockItemData[] = workspaceOrder.map((workspaceId) => {
    const Icon = workspaceIcons[workspaceId];
    return {
      badge: workspaceId === "chat" ? unreadChatCount : workspaceId === "files" ? pendingFileRequests : undefined,
      icon: <Icon aria-hidden="true" className="size-full" />,
      id: workspaceId,
      isActive: activeWorkspace === workspaceId,
      label: workspace.apps[workspaceId][0],
      running: workspaceId === "files"
        ? activeWorkspace !== "files" && fileRunning
        : workspaceId === "voice"
          ? activeWorkspace !== "voice" && voiceActive
          : workspaceId === "video"
            ? activeWorkspace !== "video" && videoActive
            : workspaceId === "watch" && activeWorkspace !== "watch" && sharedPlayback !== null,
      onClick: () => activateWorkspace(workspaceId),
    };
  });

  dockItems.push({
    icon: <RiLogoutBoxRLine aria-hidden="true" className="size-full" />,
    id: "exit",
    label: workspace.exit,
    onClick: () => setExitDialogOpen(true),
    tone: "danger",
  });

  return (
    <Dialog fullScreen open={open} overlay={false} onExitComplete={onExitComplete} onOpenChange={ignoreDialogOpenChange}>
      <DialogContent
        fadeOnly
        fullScreen
        aria-labelledby="connection-ready-title"
        className="backdrop-blur-[10px]"
        style={{ height: "100dvh", maxHeight: "none", width: "100dvw" }}
      >
        <motion.div
          animate={{ opacity: isExiting ? 0 : 1 }}
          className="zest-room-safe relative flex min-h-full flex-1 flex-col p-5 sm:p-8"
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <header className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <motion.h1
                animate={{ opacity: 1, x: 0 }}
                className="bg-clip-text text-lg font-bold text-transparent sm:text-xl md:text-2xl"
                initial={{ opacity: 0, x: -20 }}
                style={{
                  backgroundImage: `linear-gradient(45deg, ${theme.accent}, ${theme.accent}66)`,
                  fontFamily: "'Aptos Display', 'Segoe UI', sans-serif",
                }}
                transition={{ duration: 0.5 }}
              >
                <a
                  href="https://github.com/RavelloH/ZestSend"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  ZestSend
                </a>
              </motion.h1>
              <p className="truncate text-sm font-bold tracking-[0.06em] text-sky-100/65 sm:text-xl"># {roomId}</p>
            </div>
            <Clickable
              aria-label={showConnectionRates ? "Show connection quality" : "Show transfer rates"}
              className="min-w-0"
              hoverScale={1.025}
              onClick={() => setShowConnectionRates((current) => !current)}
              tapScale={0.98}
            >
              <HeaderConnectionToggle
                connectionRoute={connectionRoute}
                encryptedLabel={copy.encrypted}
                encryptedRelayLabel={copy.encryptedRelay}
                latency={progress.p2p.latency}
                showRates={showConnectionRates}
                transferred={progress.dataChannel.transferred}
              />
            </Clickable>
          </header>

          <main className="relative min-h-0 flex-1">
            <AutoTransition
              className="absolute inset-0 flex min-h-0 w-full"
              duration={0.22}
              presenceMode="sync"
              transitionKey={activeWorkspace ?? "ready"}
              type="fade"
            >
              {activeWorkspace === null ? (
                <section className="flex min-h-0 w-full flex-1 items-center justify-center py-6 text-center">
                  <div className="w-full max-w-2xl">
                    <RiCheckboxCircleFill aria-hidden="true" className="mx-auto size-12 text-emerald-300" />
                    <p className="mt-5 text-xs font-bold tracking-[0.12em] text-sky-100/50">{workspace.room} {roomId}</p>
                    <h1 id="connection-ready-title" className="zest-room-heading mt-2 text-3xl font-bold tracking-[0.04em] text-sky-50">{copy.ready}</h1>
                    <p className="zest-room-copy mx-auto mt-4 max-w-lg text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/65">
                      {copy.readyDescription}
                    </p>
                  </div>
                </section>
              ) : (() => {
                const [title, description] = workspace.apps[activeWorkspace];
                const Icon = workspaceIcons[activeWorkspace];
                const isRunning = runningWorkspaces.includes(activeWorkspace);

                return (
                  <section className={activeWorkspace === "chat" || activeWorkspace === "files" || activeWorkspace === "video" || activeWorkspace === "voice" || activeWorkspace === "watch" || activeWorkspace === "status" ? "flex h-full min-h-0 w-full flex-1 justify-center" : "flex min-h-0 w-full flex-1 items-center justify-center py-6"}>
                    {activeWorkspace === "chat" ? (
                      <ChatWorkspace
                        accent={theme.accent}
                        emptyMessage={workspace.chatEmpty}
                        messages={chatMessages}
                        onMarkRead={onMarkChatMessageRead}
                        onSend={onSendChatMessage}
                        onTyping={onChatTyping}
                        peerTyping={peerTyping}
                        placeholder={workspace.chatPlaceholder}
                        ready={progress.dataChannel.state === "active"}
                        typingLabel={workspace.typing}
                      />
                    ) : activeWorkspace === "files" ? (
                      <FileWorkspace accent={theme.accent} files={fileTransfers} locale={locale} onAccept={onAcceptFile} onCancel={onCancelFile} onDelete={onDeleteFile} onDiagnostics={onFileDiagnostics} onDownload={onDownloadFile} onOffer={onOfferFiles} onPause={onPauseFile} onResend={onResendFile} ready={progress.dataChannel.state === "active"} />
                    ) : activeWorkspace === "watch" ? (
                      <WatchWorkspace
                        accent={theme.accent}
                        error={sharedPlaybackError}
                        locale={locale}
                        media={media}
                        onControl={onSharedPlaybackControl}
                        onOpenFile={onOpenSharedPlayback}
                        onOpenSpeakerDialog={() => setSpeakerDialogOpen(true)}
                        playback={sharedPlayback}
                        ready={progress.dataChannel.state === "active"}
                        speakerActive={speakerActive}
                      />
                    ) : activeWorkspace === "voice" ? (
                      <VoiceWorkspace
                        accent={theme.accent}
                        locale={locale}
                        media={media}
                        microphoneActive={microphoneActive}
                        microphoneDeviceId={microphoneDeviceId}
                        microphoneError={microphoneError}
                        microphonePending={microphonePending}
                        noiseReductionActive={noiseReductionActive}
                        onToggleNoiseReduction={onToggleNoiseReduction}
                        onSelectMicrophone={onSelectMicrophone}
                        onOpenSpeakerDialog={() => setSpeakerDialogOpen(true)}
                        onToggleMicrophone={onToggleMicrophone}
                        ready={progress.dataChannel.state === "active"}
                        speakerActive={speakerActive}
                      />
                    ) : activeWorkspace === "video" ? (
                      <VideoWorkspace
                        accent={theme.accent}
                        cameraActive={cameraActive}
                        cameraDeviceId={cameraDeviceId}
                        focusTileId={focusedVideoTileId}
                        locale={locale}
                        media={media}
                        onSelectCamera={onSelectCamera}
                        onOpenSpeakerDialog={() => setSpeakerDialogOpen(true)}
                        onToggleCamera={onToggleCamera}
                        onToggleScreenShare={onToggleScreenShare}
                        onUpdateVideoQuality={onUpdateVideoQuality}
                        quality={videoQuality}
                        ready={progress.dataChannel.state === "active" && !cameraPending}
                        screenShareActive={screenShareActive}
                        screenAudioFallbackOpen={screenAudioFallbackOpen}
                        onCloseScreenAudioFallback={onCloseScreenAudioFallback}
                        onShareScreenWithoutAudio={onShareScreenWithoutAudio}
                        speakerActive={speakerActive}
                      />
                    ) : activeWorkspace === "status" ? (
                      <div className="flex h-full min-h-0 w-full max-w-2xl flex-col pb-[clamp(6rem,7vh,7rem)] pt-6 lg:max-w-3xl">
                        <OverlayScrollbar
                          className="min-h-0 flex-1 px-2 pr-5 [mask-image:linear-gradient(to_bottom,transparent_0%,black_2rem,black_calc(100%-3rem),transparent_100%)]"
                          syncKey={`${progress.resource.detail}-${progress.websocket.detail}-${progress.p2p.detail}-${progress.dataChannel.detail}`}
                        >
                          <div className="flex min-h-full flex-col justify-center py-7">
                            <div className="px-2">
                              <div className="flex items-start gap-4">
                          <Icon aria-hidden="true" className="mt-1 size-8 text-sky-200" />
                          <div>
                            <h1 id="connection-ready-title" className="zest-room-heading text-3xl font-bold tracking-[0.04em] text-sky-50">{title}</h1>
                            <p className="zest-room-copy mt-2 text-sm font-medium tracking-[0.04em] text-sky-100/60">{workspace.statusHint}</p>
                          </div>
                        </div>
                            </div>
                            <div className="mx-2 mt-8 border-y border-white/10">
                            <StatusMetric icon={RiGlobalLine} label={roomCopy[locale].resource} locale={locale} status={progress.resource} />
                            <StatusMetric icon={RiRouterLine} label={roomCopy[locale].websocket} locale={locale} realtimeConnection status={progress.websocket} />
                            <StatusMetric icon={RiGlobalLine} label={roomCopy[locale].stun} locale={locale} status={progress.stun} />
                            <StatusMetric icon={RiExchange2Line} label={roomCopy[locale].turn} locale={locale} status={progress.turn} />
                            <StatusMetric icon={RiWifiLine} label={roomCopy[locale].p2p} locale={locale} realtimeConnection status={progress.p2p} />
                            <StatusMetric icon={RiRadioButtonLine} label={roomCopy[locale].dataChannel} locale={locale} status={progress.dataChannel} />
                          </div>
                          </div>
                        </OverlayScrollbar>
                      </div>
                    ) : (
                      <div className="mx-auto max-w-xl text-center">
                        <Icon aria-hidden="true" className="mx-auto size-10 text-sky-200" />
                        <h1 id="connection-ready-title" className="zest-room-heading mt-5 text-3xl font-bold tracking-[0.04em] text-sky-50">{title}</h1>
                        <p className="zest-room-copy mx-auto mt-3 max-w-md text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/60">{description}</p>
                        {isRunning ? <p className="mt-6 text-xs font-bold tracking-[0.1em] text-sky-100/40">{workspace.background}</p> : null}
                      </div>
                    )}
                  </section>
                );
              })()}
            </AutoTransition>
          </main>

          {activeWorkspace !== "video" ? <FloatingVideoSidecars media={media} locale={locale} onFocus={(tileId) => {
            setFocusedVideoTileId(tileId);
            activateWorkspace("video");
          }} /> : null}

          <div className="zest-room-dock pointer-events-none absolute inset-x-0 bottom-5 flex justify-center sm:bottom-7">
            <div
              className="pointer-events-auto origin-bottom"
              style={{ transform: "scale(clamp(0.46, calc((100vw - 1.5rem) / 45rem), 1))" }}
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
          <Dialog open={isExitDialogOpen} onOpenChange={setExitDialogOpen}>
            <DialogContent aria-labelledby="exit-room-title" className="!max-w-md">
              <div className="p-7 sm:p-8">
                <RiLogoutBoxRLine aria-hidden="true" className="size-9 text-rose-300" />
                <h2 id="exit-room-title" className="mt-5 text-2xl font-bold tracking-[0.04em] text-sky-50">
                  {workspace.exitTitle}
                </h2>
                <p className="mt-2 text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/60">
                  {workspace.exitDescription}
                </p>
                <div className="mt-8 grid grid-cols-2 gap-3">
                  <button
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/10 px-4 text-base font-semibold tracking-[0.04em] text-sky-100/75 transition-colors hover:bg-white/[0.05] hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60"
                    onClick={() => setExitDialogOpen(false)}
                    type="button"
                  >
                    {workspace.exitCancel}
                  </button>
                  <button
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-rose-500/10 px-4 text-base font-semibold tracking-[0.04em] text-rose-200 transition-colors hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-200/60"
                    onClick={requestExit}
                    type="button"
                  >
                    <RiLogoutBoxRLine aria-hidden="true" className="size-4" />
                    {workspace.exitConfirm}
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <SpeakerVolumeDialog
            locale={locale}
            onOpenChange={setSpeakerDialogOpen}
            onScreenShareVolumeChange={onScreenShareVolumeChange}
            onSharedPlaybackVolumeChange={onSharedPlaybackVolumeChange}
            onVoiceVolumeChange={onVolumeChange}
            open={isSpeakerDialogOpen}
            screenShareVolume={screenShareVolume}
            sharedPlaybackVolume={sharedPlaybackVolume}
            voiceVolume={volume}
          />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

function RoomFullContent({ locale, onLeave, roomId }: { locale: RoomLocale; onLeave: () => void; roomId: string }) {
  const copy = roomCopy[locale];

  return (
    <Dialog open onOpenChange={ignoreDialogOpenChange}>
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
  const [dialogPhase, setDialogPhase] = useState<"connecting" | "closing-for-full" | "closing-for-leave" | "closing-for-ready" | "closing-for-reconnect" | "full" | "ready">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [connectionRoute, setConnectionRoute] = useState<ConnectionRoute>("direct");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [fileTransfers, setFileTransfers] = useState<FileTransferSnapshot[]>([]);
  const [mediaTransport, setMediaTransport] = useState<MediaTransport | null>(null);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | null>(null);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [microphonePending, setMicrophonePending] = useState(false);
  const [noiseReductionActive, setNoiseReductionActive] = useState(true);
  const [remoteVoiceActive, setRemoteVoiceActive] = useState(false);
  const [remoteVideoActive, setRemoteVideoActive] = useState(false);
  const [remoteAudioVersion, setRemoteAudioVersion] = useState(0);
  const [speakerVolume, setSpeakerVolume] = useState(1);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [cameraPending, setCameraPending] = useState(false);
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [screenShareVolume, setScreenShareVolume] = useState(1);
  const [sharedPlaybackVolume, setSharedPlaybackVolume] = useState(1);
  const [screenAudioFallbackOpen, setScreenAudioFallbackOpen] = useState(false);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("balanced");
  const [peerTyping, setPeerTyping] = useState(false);
  const [sharedPlayback, setSharedPlayback] = useState<SharedPlayback | null>(null);
  const [sharedPlaybackError, setSharedPlaybackError] = useState<string | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const fileTransfersRef = useRef<FileTransferSnapshot[]>([]);
  const fileTransferRefreshTimerRef = useRef<number | null>(null);
  const peerTypingTimerRef = useRef<number | null>(null);
  const reconnectDialogTimerRef = useRef<number | null>(null);
  const rawMicrophoneTrackRef = useRef<MediaStreamTrack | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteScreenAudioRef = useRef<HTMLAudioElement>(null);
  const remotePlaybackAudioRef = useRef<HTMLAudioElement>(null);
  const sharedPlaybackElementRef = useRef<HTMLVideoElement>(null);
  const sharedPlaybackRef = useRef<SharedPlayback | null>(null);
  const sharedPlaybackObjectUrlRef = useRef<string | null>(null);
  const sharedPlaybackTransitionRef = useRef(false);
  const sharedPlaybackLastSyncRef = useRef(0);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const [progress, setProgress] = useState<ConnectionProgress>({
    websocket: { state: "pending", detail: "Waiting for signaling socket" },
    resource: { state: "pending", detail: "Waiting to request Cloudflare resources" },
    stun: { state: "pending", detail: "Checking STUN server" },
    turn: { state: "pending", detail: "Checking TURN server" },
    p2p: { state: "pending", detail: "Waiting for the other participant to join the room" },
    dataChannel: { channels: 0, state: "pending", detail: "Waiting for data channel" },
  });
  const sessionRef = useRef<NativeWebRTCSession | null>(null);
  const fileManagerRef = useRef<FileTransferManager | null>(null);
  const lastTypingSentAtRef = useRef(0);

  useEffect(() => {
    const manager = new FileTransferManager({
      onError: (id, message) => setError(message),
      onOffer: () => undefined,
      onRemove: (id) => {
        fileTransfersRef.current = fileTransfersRef.current.filter((file) => file.id !== id);
        setFileTransfers(fileTransfersRef.current);
      },
      onUpdate: (snapshot) => {
        const current = fileTransfersRef.current;
        const index = current.findIndex((item) => item.id === snapshot.id);
        const previous = index < 0 ? undefined : current[index];
        const next = index < 0 ? [...current, snapshot] : current.map((item, itemIndex) => itemIndex === index ? snapshot : item);
        fileTransfersRef.current = next;
        const stateChanged = !previous || previous.state !== snapshot.state || previous.error !== snapshot.error;
        if (stateChanged) {
          if (fileTransferRefreshTimerRef.current !== null) window.clearTimeout(fileTransferRefreshTimerRef.current);
          fileTransferRefreshTimerRef.current = null;
          setFileTransfers(next);
          return;
        }
        if (fileTransferRefreshTimerRef.current === null) {
          fileTransferRefreshTimerRef.current = window.setTimeout(() => {
            fileTransferRefreshTimerRef.current = null;
            setFileTransfers(fileTransfersRef.current);
          }, 1_000);
        }
      },
      sendBulk: (data) => sessionRef.current?.sendBulk(data) ?? false,
      sendControl: (message) => sessionRef.current?.sendControlMessage(message) ?? false,
    });
    fileManagerRef.current = manager;
    return () => {
      if (fileTransferRefreshTimerRef.current !== null) window.clearTimeout(fileTransferRefreshTimerRef.current);
      fileTransferRefreshTimerRef.current = null;
      void manager.dispose();
      fileManagerRef.current = null;
      fileTransfersRef.current = [];
      setFileTransfers([]);
    };
  }, [roomId]);

  const updateChatMessages = (update: (messages: ChatMessage[]) => ChatMessage[]) => {
    setChatMessages((current) => {
      const next = update(current);
      chatMessagesRef.current = next;
      return next;
    });
  };

  const updateSharedPlayback = (next: SharedPlayback | null) => {
    sharedPlaybackRef.current = next;
    setSharedPlayback(next);
  };

  const publishSharedPlaybackState = (force = false) => {
    const playback = sharedPlaybackRef.current;
    const element = sharedPlaybackElementRef.current;
    if (!playback || playback.owner !== "local" || !element || sharedPlaybackTransitionRef.current) return;

    const now = performance.now();
    if (!force && now - sharedPlaybackLastSyncRef.current < 750) return;
    sharedPlaybackLastSyncRef.current = now;
    const next: SharedPlayback = {
      ...playback,
      currentTime: Number.isFinite(element.currentTime) ? Math.max(0, element.currentTime) : 0,
      duration: mediaDuration(element),
      playbackRate: element.playbackRate,
      playing: !element.paused && !element.ended,
    };
    updateSharedPlayback(next);
    sessionRef.current?.sendControlMessage({
      currentTime: next.currentTime,
      duration: next.duration,
      id: next.id,
      kind: next.kind,
      name: next.name,
      playbackRate: next.playbackRate,
      playing: next.playing,
      type: "shared-playback-state",
    });
  };

  const clearLocalSharedPlayback = async (announce = true) => {
    const playback = sharedPlaybackRef.current;
    if (!playback || playback.owner !== "local") return;
    const element = sharedPlaybackElementRef.current;
    const media = sessionRef.current?.media;
    const audioTrack = media?.getLocalTrack("playback-audio") ?? null;
    const videoTrack = media?.getLocalTrack("playback-video") ?? null;
    sharedPlaybackTransitionRef.current = true;

    if (announce) sessionRef.current?.sendControlMessage({ id: playback.id, type: "shared-playback-stopped" });
    updateSharedPlayback(null);
    setSharedPlaybackError(null);
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    await Promise.all([
      media?.replaceLocalTrack("playback-audio", null, "ended"),
      media?.replaceLocalTrack("playback-video", null, "ended"),
    ]);
    audioTrack?.stop();
    videoTrack?.stop();
    if (sharedPlaybackObjectUrlRef.current) URL.revokeObjectURL(sharedPlaybackObjectUrlRef.current);
    sharedPlaybackObjectUrlRef.current = null;
    sharedPlaybackLastSyncRef.current = 0;
    sharedPlaybackTransitionRef.current = false;
  };

  const applyLocalSharedPlaybackCommand = async (command: SharedPlaybackCommand, options?: { currentTime?: number; playbackRate?: number }) => {
    const playback = sharedPlaybackRef.current;
    const element = sharedPlaybackElementRef.current;
    if (!playback || playback.owner !== "local" || !element) return;
    if (command === "stop") {
      await clearLocalSharedPlayback();
      return;
    }
    if (command === "seek" && typeof options?.currentTime === "number") {
      element.currentTime = Math.min(Math.max(0, options.currentTime), mediaDuration(element) || options.currentTime);
      publishSharedPlaybackState(true);
      return;
    }
    if (command === "rate" && typeof options?.playbackRate === "number") {
      element.playbackRate = options.playbackRate;
      publishSharedPlaybackState(true);
      return;
    }
    if (command === "pause") {
      element.pause();
      publishSharedPlaybackState(true);
      return;
    }
    if (command === "play") {
      try {
        await element.play();
        publishSharedPlaybackState(true);
      } catch (cause) {
        setSharedPlaybackError(cause instanceof Error ? cause.message : locale === "zh" ? "无法播放所选媒体。" : "The selected media could not be played.");
      }
    }
  };

  const openSharedPlayback = async (file: File): Promise<void> => {
    const media = sessionRef.current?.media;
    const element = sharedPlaybackElementRef.current;
    const initialKind = localMediaKind(file);
    if (!media || !element) return;
    if (!initialKind) {
      setSharedPlaybackError(locale === "zh" ? "请选择音频或视频文件。" : "Choose an audio or video file.");
      return;
    }
    if (sharedPlaybackRef.current?.owner === "remote") {
      setSharedPlaybackError(locale === "zh" ? "对方正在同播。请先结束当前同播后再打开你的媒体。" : "The other participant is sharing media. End the current session before opening yours.");
      return;
    }

    if (sharedPlaybackRef.current?.owner === "local") await clearLocalSharedPlayback();
    sharedPlaybackTransitionRef.current = true;
    setSharedPlaybackError(null);
    const id = cuid();
    const sourceUrl = URL.createObjectURL(file);
    sharedPlaybackObjectUrlRef.current = sourceUrl;
    updateSharedPlayback({ currentTime: 0, duration: 0, id, kind: initialKind, name: file.name, owner: "local", playbackRate: 1, playing: false });

    try {
      element.pause();
      element.src = sourceUrl;
      element.load();
      await waitForMediaMetadata(element);
      await element.play();
      const stream = captureMediaStream(element);
      if (!stream) throw new Error(locale === "zh" ? "当前浏览器不支持捕获本地媒体播放流。" : "This browser cannot capture local media playback.");
      const audioTrack = stream.getAudioTracks()[0] ?? null;
      const videoTrack = stream.getVideoTracks()[0] ?? null;
      if (!audioTrack && !videoTrack) throw new Error(locale === "zh" ? "无法从所选媒体中读取可共享的音视频轨道。" : "No shareable audio or video track was found in this media.");
      if (videoTrack) videoTrack.contentHint = "detail";
      const [audioAttached, videoAttached] = await Promise.all([
        media.replaceLocalTrack("playback-audio", audioTrack, audioTrack ? "live" : "idle"),
        media.replaceLocalTrack("playback-video", videoTrack, videoTrack ? "live" : "idle"),
      ]);
      if ((audioTrack && !audioAttached) || (videoTrack && !videoAttached)) throw new Error(locale === "zh" ? "无法将媒体添加到端对端连接。" : "The media could not be added to the peer-to-peer connection.");
      const current = sharedPlaybackRef.current;
      if (current?.id === id) updateSharedPlayback({
        ...current,
        duration: mediaDuration(element),
        kind: videoTrack ? "video" : "audio",
        playing: true,
      });
      sharedPlaybackTransitionRef.current = false;
      publishSharedPlaybackState(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : locale === "zh" ? "无法打开所选媒体。" : "The selected media could not be opened.";
      setSharedPlaybackError(message);
      sharedPlaybackTransitionRef.current = false;
      await clearLocalSharedPlayback(false);
    }
  };

  const controlSharedPlayback = (command: SharedPlaybackCommand, options?: { currentTime?: number; playbackRate?: number }) => {
    const playback = sharedPlaybackRef.current;
    if (!playback) return;
    if (playback.owner === "local") {
      void applyLocalSharedPlaybackCommand(command, options);
      return;
    }
    sessionRef.current?.sendControlMessage({
      command,
      currentTime: options?.currentTime,
      id: playback.id,
      playbackRate: options?.playbackRate,
      type: "shared-playback-command",
    });
  };

  const handleSharedPlaybackMessage = (message: SharedPlaybackMessage) => {
    if (message.type === "shared-playback-state") {
      const current = sharedPlaybackRef.current;
      if (current?.owner === "local") return;
      updateSharedPlayback({ ...message, owner: "remote" });
      setSharedPlaybackError(null);
      return;
    }
    if (message.type === "shared-playback-stopped") {
      const current = sharedPlaybackRef.current;
      if (current?.owner === "remote" && current.id === message.id) updateSharedPlayback(null);
      return;
    }
    const current = sharedPlaybackRef.current;
    if (current?.owner === "local" && current.id === message.id) void applyLocalSharedPlaybackCommand(message.command, message);
  };

  useEffect(() => {
    const element = sharedPlaybackElementRef.current;
    if (!element) return;
    const publish = (event: Event) => publishSharedPlaybackState(event.type !== "timeupdate");
    const onEnded = () => { void clearLocalSharedPlayback(); };
    for (const event of ["play", "pause", "ratechange", "seeked", "timeupdate"]) element.addEventListener(event, publish);
    element.addEventListener("ended", onEnded);
    return () => {
      for (const event of ["play", "pause", "ratechange", "seeked", "timeupdate"]) element.removeEventListener(event, publish);
      element.removeEventListener("ended", onEnded);
      sharedPlaybackTransitionRef.current = true;
      element.pause();
      element.removeAttribute("src");
      element.load();
      if (sharedPlaybackObjectUrlRef.current) URL.revokeObjectURL(sharedPlaybackObjectUrlRef.current);
      sharedPlaybackObjectUrlRef.current = null;
    };
  }, [roomId]);

  useEffect(() => () => {
    if (reconnectDialogTimerRef.current !== null) window.clearTimeout(reconnectDialogTimerRef.current);
  }, []);

  const resumeRemoteAudio = () => {
    for (const audio of [remoteAudioRef.current, remoteScreenAudioRef.current, remotePlaybackAudioRef.current]) {
      if (audio) void audio.play().catch(() => undefined);
    }
  };

  useEffect(() => {
    const audio = remoteAudioRef.current;
    const remoteStream = mediaTransport?.getRemoteStream("camera-audio");
    if (!audio) return;
    audio.autoplay = true;
    audio.muted = false;
    audio.volume = speakerVolume;
    if (audio.srcObject !== remoteStream) audio.srcObject = remoteStream ?? null;
    resumeRemoteAudio();
  }, [mediaTransport, remoteAudioVersion, speakerVolume]);

  useEffect(() => {
    const audio = remoteScreenAudioRef.current;
    const remoteStream = mediaTransport?.getRemoteStream("screen-audio");
    if (!audio) return;
    audio.autoplay = true;
    audio.muted = false;
    audio.volume = screenShareVolume;
    if (audio.srcObject !== remoteStream) audio.srcObject = remoteStream ?? null;
    void audio.play().catch(() => undefined);
  }, [mediaTransport, remoteAudioVersion, screenShareVolume]);

  useEffect(() => {
    const audio = remotePlaybackAudioRef.current;
    const remoteStream = mediaTransport?.getRemoteStream("playback-audio");
    if (!audio) return;
    audio.autoplay = true;
    audio.muted = false;
    audio.volume = sharedPlaybackVolume;
    if (audio.srcObject !== remoteStream) audio.srcObject = remoteStream ?? null;
    void audio.play().catch(() => undefined);
  }, [mediaTransport, remoteAudioVersion, sharedPlaybackVolume]);

  useEffect(() => {
    const element = sharedPlaybackElementRef.current;
    if (element) element.volume = sharedPlaybackVolume;
  }, [sharedPlaybackVolume]);

  useEffect(() => {
    const showReconnectDialog = (detail = "Reconnecting signaling socket") => {
      setError(detail);
      setDialogPhase((current) => current === "ready" ? "closing-for-reconnect" : current === "closing-for-reconnect" ? current : "connecting");
      if (reconnectDialogTimerRef.current !== null) window.clearTimeout(reconnectDialogTimerRef.current);
      reconnectDialogTimerRef.current = window.setTimeout(() => {
        reconnectDialogTimerRef.current = null;
        setDialogPhase((current) => current === "closing-for-reconnect" ? "connecting" : current);
      }, 180);
    };
    const session = new NativeWebRTCSession(
      roomId,
      setProgress,
      () => {
        const pendingMessages = chatMessagesRef.current.filter((message) => message.sender === "local" && message.deliveryStatus !== "read" && message.deliveryStatus !== "received");
        const retriedMessageIds = new Set<string>();
        for (const message of pendingMessages) {
          if (session.sendChatMessage(message.id, message.text)) retriedMessageIds.add(message.id);
        }
        if (retriedMessageIds.size) {
          updateChatMessages((current) => current.map((message) => retriedMessageIds.has(message.id)
            ? { ...message, deliveryStatus: "sending", lastAttemptedAt: Date.now() }
            : message));
        }
        fileManagerRef.current?.onTransportReady();
        setError(null);
        setDialogPhase("closing-for-ready");
      },
      setError,
      () => {
        session.close();
        setDialogPhase("closing-for-full");
      },
      () => {
        if (peerTypingTimerRef.current !== null) window.clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = null;
        setPeerTyping(false);
        chatMessagesRef.current = [];
        setChatMessages([]);
        if (fileTransferRefreshTimerRef.current !== null) window.clearTimeout(fileTransferRefreshTimerRef.current);
        fileTransferRefreshTimerRef.current = null;
        fileTransfersRef.current = [];
        setFileTransfers([]);
        void fileManagerRef.current?.clearSession();
        void clearLocalSharedPlayback(false);
        if (sharedPlaybackRef.current?.owner === "remote") updateSharedPlayback(null);
        session.media.stopLocalTracks();
        rawMicrophoneTrackRef.current?.stop();
        rawMicrophoneTrackRef.current = null;
        cameraTrackRef.current?.stop();
        cameraTrackRef.current = null;
        screenVideoTrackRef.current?.stop();
        screenVideoTrackRef.current = null;
        screenAudioTrackRef.current?.stop();
        screenAudioTrackRef.current = null;
        setMicrophoneActive(false);
        setMicrophoneDeviceId(null);
        setCameraActive(false);
        setCameraDeviceId(null);
        setScreenShareActive(false);
        setScreenAudioFallbackOpen(false);
        setConnectionRoute("direct");
        showReconnectDialog("Waiting for the other participant to reconnect");
      },
      setConnectionRoute,
      (message) => {
        if (peerTypingTimerRef.current !== null) window.clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = null;
        setPeerTyping(false);
        updateChatMessages((current) => appendChatMessage(current, {
          id: message.id,
          sender: "remote",
          sentAt: Date.now(),
          text: message.text,
        }));
      },
      (id, status) => {
        updateChatMessages((current) => current.map((message) => {
          if (message.id !== id || message.sender !== "local") return message;
          if (message.deliveryStatus === "read" || (message.deliveryStatus === "received" && status === "received")) return message;
          return { ...message, deliveryStatus: status };
        }));
      },
      () => {
        if (peerTypingTimerRef.current !== null) window.clearTimeout(peerTypingTimerRef.current);
        setPeerTyping(true);
        peerTypingTimerRef.current = window.setTimeout(() => {
          peerTypingTimerRef.current = null;
          setPeerTyping(false);
        }, 3_000);
      },
      handleSharedPlaybackMessage,
      (status: SessionStatus) => {
        if (status.state === "reconnecting" || status.state === "reserved") {
          showReconnectDialog(status.detail);
          return;
        }
        if (status.state === "connected") setError(null);
      },
    );
    sessionRef.current = session;
    setMediaTransport(session.media);
    const unsubscribeMedia = session.media.subscribe((slots) => {
      const remoteAudio = slots.find((slot) => slot.id === "camera-audio");
      const remoteVideo = slots.some((slot) => (slot.id === "camera-video" || slot.id === "screen-video") && slot.remoteState === "live");
      setRemoteAudioVersion((version) => version + 1);
      setRemoteVoiceActive((current) => {
        const next = remoteAudio?.remoteState === "live";
        return current === next ? current : next;
      });
      setRemoteVideoActive((current) => current === remoteVideo ? current : remoteVideo);
    });
    session.attachFileTransferManager(fileManagerRef.current);
    session.connect();
    let pageHidden = false;
    const handlePageHide = () => {
      pageHidden = true;
      session.suspend();
    };
    const handlePageShow = () => {
      pageHidden = false;
      session.resume();
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      if (peerTypingTimerRef.current !== null) window.clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = null;
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      if (pageHidden) session.suspend();
      else session.close();
      unsubscribeMedia();
      rawMicrophoneTrackRef.current?.stop();
      rawMicrophoneTrackRef.current = null;
      cameraTrackRef.current?.stop();
      cameraTrackRef.current = null;
      screenVideoTrackRef.current?.stop();
      screenVideoTrackRef.current = null;
      screenAudioTrackRef.current?.stop();
      screenAudioTrackRef.current = null;
      sessionRef.current = null;
      setMediaTransport(null);
      setMicrophoneActive(false);
      setMicrophoneDeviceId(null);
      setMicrophonePending(false);
      setNoiseReductionActive(true);
      setRemoteVoiceActive(false);
      setRemoteVideoActive(false);
      setSpeakerVolume(1);
      setCameraActive(false);
      setCameraDeviceId(null);
      setCameraPending(false);
      setScreenShareActive(false);
      setScreenShareVolume(1);
      setSharedPlaybackVolume(1);
      setScreenAudioFallbackOpen(false);
      setVideoQuality("balanced");
      updateSharedPlayback(null);
      setSharedPlaybackError(null);
    };
  }, [roomId]);

  const leave = () => {
    sessionRef.current?.close();
    chatMessagesRef.current = [];
    setChatMessages([]);
    void fileManagerRef.current?.dispose();
    if (fileTransferRefreshTimerRef.current !== null) window.clearTimeout(fileTransferRefreshTimerRef.current);
    fileTransferRefreshTimerRef.current = null;
    fileTransfersRef.current = [];
    setFileTransfers([]);
    void navigate({ to: locale === "zh" ? "/zh" : "/en" });
  };

  const offerFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) fileManagerRef.current?.offerFile(file, cuid());
  };

  const acceptFile = (id: string) => { void fileManagerRef.current?.acceptFile(id); };
  const cancelFile = (id: string) => fileManagerRef.current?.cancelFile(id);
  const deleteFile = (id: string) => fileManagerRef.current?.deleteFile(id);
  const downloadFile = (id: string) => { fileManagerRef.current?.downloadFile(id); };
  const pauseFile = (id: string) => { void fileManagerRef.current?.togglePause(id); };
  const resendFile = (id: string) => { fileManagerRef.current?.resendFile(id, cuid()); };
  const getFileDiagnostics = async (id: string): Promise<TransferDiagnostics | null> => {
    const file = fileManagerRef.current?.getDiagnostics(id);
    if (!file) return null;
    return { file, transport: await sessionRef.current?.getTransportDiagnostics() ?? {
      availableOutgoingBitrate: null,
      bufferedAmount: { bulk: null, control: null, interactive: null },
      bytesReceived: null,
      bytesSent: null,
      currentRoundTripTime: null,
      localCandidateType: null,
      localProtocol: null,
      packetsRetransmitted: null,
      packetsDiscardedOnSend: null,
      remoteCandidateType: null,
      remoteProtocol: null,
      relayProtocol: null,
      sctpCongestionWindow: null,
      sctpReceiverWindow: null,
      sctpSmoothedRoundTripTime: null,
      sctpState: null,
    } };
  };

  const sendChatMessage = (text: string): boolean => {
    const message = text.trim();
    const id = cuid();
    if (!sessionRef.current?.sendChatMessage(id, message)) return false;
    updateChatMessages((current) => appendChatMessage(current, {
      deliveryStatus: "sending",
      id,
      lastAttemptedAt: Date.now(),
      sender: "local",
      sentAt: Date.now(),
      text: message,
    }));
    return true;
  };

  const markChatMessageRead = (id: string): boolean => {
    return sessionRef.current?.markChatMessageRead(id) ?? false;
  };

  const sendChatTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentAtRef.current < 1_000) return;
    if (sessionRef.current?.sendChatTyping()) lastTypingSentAtRef.current = now;
  };

  const toggleMicrophone = async () => {
    resumeRemoteAudio();
    const media = sessionRef.current?.media;
    if (!media || microphonePending) return;

    setMicrophonePending(true);
    setMicrophoneError(null);
    try {
      const existingTrack = media.getLocalTrack("camera-audio");
      if (existingTrack) {
        const removed = await media.replaceLocalTrack("camera-audio", null, "ended");
        if (!removed) throw new Error(locale === "zh" ? "无法关闭麦克风。" : "Could not turn off the microphone.");
        existingTrack.stop();
        const rawTrack = rawMicrophoneTrackRef.current;
        if (rawTrack && rawTrack !== existingTrack) rawTrack.stop();
        rawMicrophoneTrackRef.current = null;
        setMicrophoneActive(false);
        setMicrophoneDeviceId(null);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: noiseReductionActive,
          echoCancellation: true,
          noiseSuppression: noiseReductionActive,
        },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error(locale === "zh" ? "没有检测到可用麦克风。" : "No microphone was detected.");
      const attached = await media.replaceLocalTrack("camera-audio", track, "live");
      if (!attached) {
        track.stop();
        throw new Error(locale === "zh" ? "无法将麦克风接入端对端连接。" : "Could not add the microphone to the peer-to-peer connection.");
      }
      track.addEventListener("ended", () => setMicrophoneActive(false), { once: true });
      rawMicrophoneTrackRef.current = track;
      setMicrophoneActive(true);
      setMicrophoneDeviceId(track.getSettings().deviceId ?? null);
    } catch (cause) {
      setMicrophoneActive(false);
      setMicrophoneError(cause instanceof Error ? cause.message : locale === "zh" ? "无法开启麦克风。" : "Could not turn on the microphone.");
    } finally {
      setMicrophonePending(false);
    }
  };

  const selectMicrophone = async (deviceId: string): Promise<boolean> => {
    const media = sessionRef.current?.media;
    if (!media || microphonePending) return false;

    setMicrophonePending(true);
    setMicrophoneError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: noiseReductionActive,
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: noiseReductionActive,
        },
        video: false,
      });
      const replacement = stream.getAudioTracks()[0];
      if (!replacement) throw new Error(locale === "zh" ? "没有检测到可用麦克风。" : "No microphone was detected.");
      const previous = media.getLocalTrack("camera-audio");
      const previousRawTrack = rawMicrophoneTrackRef.current;
      const attached = await media.replaceLocalTrack("camera-audio", replacement, "live");
      if (!attached) {
        replacement.stop();
        throw new Error(locale === "zh" ? "无法切换麦克风。" : "Could not switch microphones.");
      }
      previous?.stop();
      if (previousRawTrack && previousRawTrack !== previous) previousRawTrack.stop();
      rawMicrophoneTrackRef.current = replacement;
      replacement.addEventListener("ended", () => setMicrophoneActive(false), { once: true });
      setMicrophoneActive(true);
      setMicrophoneDeviceId(replacement.getSettings().deviceId ?? deviceId);
      return true;
    } catch (cause) {
      setMicrophoneError(cause instanceof Error ? cause.message : locale === "zh" ? "无法切换麦克风。" : "Could not switch microphones.");
      return false;
    } finally {
      setMicrophonePending(false);
    }
  };

  const toggleNoiseReduction = async () => {
    const track = rawMicrophoneTrackRef.current ?? sessionRef.current?.media.getLocalTrack("camera-audio");
    if (!track || microphonePending) return;

    const next = !noiseReductionActive;
    setMicrophonePending(true);
    setMicrophoneError(null);
    try {
      await track.applyConstraints({
        advanced: [{
          autoGainControl: next,
          noiseSuppression: next,
        }],
      });
      setNoiseReductionActive(next);
    } catch (cause) {
      setMicrophoneError(cause instanceof Error ? cause.message : locale === "zh" ? "无法修改降噪设置。" : "Could not update noise reduction.");
    } finally {
      setMicrophonePending(false);
    }
  };

  const videoConstraints = (quality: VideoQuality): MediaTrackConstraints => {
    if (quality === "low") return { frameRate: { ideal: 24, max: 30 }, height: { ideal: 540, max: 720 }, width: { ideal: 960, max: 1280 } };
    if (quality === "high") return { frameRate: { ideal: 30, max: 60 }, height: { ideal: 1080, max: 1440 }, width: { ideal: 1920, max: 2560 } };
    return { frameRate: { ideal: 30, max: 30 }, height: { ideal: 720, max: 1080 }, width: { ideal: 1280, max: 1920 } };
  };

  const updateVideoQuality = async (quality: VideoQuality) => {
    setVideoQuality(quality);
    const track = cameraTrackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints(videoConstraints(quality));
    } catch {
      // Devices can reject an ideal resolution; WebRTC continues with its current encoder configuration.
    }
  };

  const toggleCamera = async () => {
    const media = sessionRef.current?.media;
    if (!media || cameraPending) return;
    setCameraPending(true);
    try {
      const existing = media.getLocalTrack("camera-video");
      if (existing) {
        const detached = await media.replaceLocalTrack("camera-video", null, "ended");
        if (!detached) return;
        existing.stop();
        cameraTrackRef.current = null;
        setCameraActive(false);
        setCameraDeviceId(null);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(videoQuality) });
      const track = stream.getVideoTracks()[0];
      if (!track || !await media.replaceLocalTrack("camera-video", track, "live")) {
        track?.stop();
        return;
      }
      cameraTrackRef.current = track;
      track.addEventListener("ended", () => {
        cameraTrackRef.current = null;
        setCameraActive(false);
        setCameraDeviceId(null);
        void media.replaceLocalTrack("camera-video", null, "ended");
      }, { once: true });
      setCameraActive(true);
      setCameraDeviceId(track.getSettings().deviceId ?? null);
    } finally {
      setCameraPending(false);
    }
  };

  const selectCamera = async (deviceId: string): Promise<boolean> => {
    const media = sessionRef.current?.media;
    if (!media || cameraPending) return false;
    setCameraPending(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...videoConstraints(videoQuality), deviceId: { exact: deviceId } } });
      const track = stream.getVideoTracks()[0];
      if (!track || !await media.replaceLocalTrack("camera-video", track, "live")) {
        track?.stop();
        return false;
      }
      const previous = cameraTrackRef.current;
      cameraTrackRef.current = track;
      previous?.stop();
      track.addEventListener("ended", () => {
        if (cameraTrackRef.current !== track) return;
        cameraTrackRef.current = null;
        setCameraActive(false);
        setCameraDeviceId(null);
        void media.replaceLocalTrack("camera-video", null, "ended");
      }, { once: true });
      setCameraActive(true);
      setCameraDeviceId(track.getSettings().deviceId ?? deviceId);
      return true;
    } finally {
      setCameraPending(false);
    }
  };

  const startScreenShare = async (withAudio: boolean) => {
    const media = sessionRef.current?.media;
    if (!media || cameraPending) return;
    setCameraPending(true);
    try {
      let stream: MediaStream;
      try {
        // Do not apply microphone constraints or Chromium-only hints here.
        // System-audio capture is chosen by the picker and must be requested
        // through the portable display-capture shape.
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: withAudio, video: true });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        const audioSourceFailed = /audio source|audio capture|system audio/i.test(message);
        if (withAudio && audioSourceFailed) {
          setScreenAudioFallbackOpen(true);
          return;
        }
        throw cause;
      }
      const video = stream.getVideoTracks()[0];
      const audio = stream.getAudioTracks()[0] ?? null;
      if (!video || !await media.replaceLocalTrack("screen-video", video, "live")) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (audio && !await media.replaceLocalTrack("screen-audio", audio, "live")) {
        audio.stop();
      }
      screenVideoTrackRef.current = video;
      screenAudioTrackRef.current = audio?.readyState === "live" ? audio : null;
      video.addEventListener("ended", () => {
        if (screenVideoTrackRef.current !== video) return;
        screenVideoTrackRef.current = null;
        screenAudioTrackRef.current?.stop();
        screenAudioTrackRef.current = null;
        setScreenShareActive(false);
        void media.replaceLocalTrack("screen-video", null, "ended");
        void media.replaceLocalTrack("screen-audio", null, "ended");
      }, { once: true });
      setScreenShareActive(true);
    } finally {
      setCameraPending(false);
    }
  };

  const toggleScreenShare = async () => {
    const media = sessionRef.current?.media;
    if (!media || cameraPending) return;
    if (!media.getLocalTrack("screen-video")) {
      await startScreenShare(true);
      return;
    }
    setCameraPending(true);
    try {
      const [videoRemoved, audioRemoved] = await Promise.all([
        media.replaceLocalTrack("screen-video", null, "ended"),
        media.replaceLocalTrack("screen-audio", null, "ended"),
      ]);
      if (!videoRemoved || !audioRemoved) return;
      screenVideoTrackRef.current?.stop();
      screenAudioTrackRef.current?.stop();
      screenVideoTrackRef.current = null;
      screenAudioTrackRef.current = null;
      setScreenShareActive(false);
    } finally {
      setCameraPending(false);
    }
  };

  const shareScreenWithoutAudio = () => {
    setScreenAudioFallbackOpen(false);
    void startScreenShare(false);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const timeoutAt = Date.now() - 12_000;
      updateChatMessages((current) => current.map((message) => {
        if (message.sender !== "local" || message.deliveryStatus !== "sending" || (message.lastAttemptedAt ?? message.sentAt) > timeoutAt) return message;
        return { ...message, deliveryStatus: "error" };
      }));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Layout title={dialogPhase === "ready" ? roomCopy[locale].roomTitle(roomId) : roomCopy[locale].pageTitle(roomId)}>
      <div className="contents" onClickCapture={resumeRemoteAudio}>
      <audio className="sr-only" autoPlay playsInline ref={remoteAudioRef} />
      <audio className="sr-only" autoPlay playsInline ref={remoteScreenAudioRef} />
      <audio className="sr-only" autoPlay playsInline ref={remotePlaybackAudioRef} />
      <video aria-hidden="true" className="sr-only" playsInline ref={sharedPlaybackElementRef} />
      {dialogPhase === "full" ? (
        <RoomFullContent locale={locale} onLeave={leave} roomId={roomId} />
      ) : dialogPhase === "ready" || dialogPhase === "closing-for-reconnect" ? (
        <RoomWorkspace
          chatMessages={chatMessages}
          fileTransfers={fileTransfers}
          locale={locale}
          onLeave={leave}
          onChatTyping={sendChatTyping}
          onAcceptFile={acceptFile}
          onCancelFile={cancelFile}
          onDeleteFile={deleteFile}
          onFileDiagnostics={getFileDiagnostics}
          onDownloadFile={downloadFile}
          onOfferFiles={offerFiles}
          onPauseFile={pauseFile}
          onResendFile={resendFile}
          media={mediaTransport}
          sharedPlayback={sharedPlayback}
          sharedPlaybackError={sharedPlaybackError}
          onOpenSharedPlayback={openSharedPlayback}
          onSharedPlaybackControl={controlSharedPlayback}
          microphoneActive={microphoneActive}
          microphoneDeviceId={microphoneDeviceId}
          microphoneError={microphoneError}
          microphonePending={microphonePending}
          noiseReductionActive={noiseReductionActive}
          onMarkChatMessageRead={markChatMessageRead}
          onSendChatMessage={sendChatMessage}
          onToggleNoiseReduction={toggleNoiseReduction}
          onSelectMicrophone={selectMicrophone}
          onToggleMicrophone={toggleMicrophone}
          volume={speakerVolume}
          onVolumeChange={setSpeakerVolume}
          cameraActive={cameraActive}
          cameraDeviceId={cameraDeviceId}
          cameraPending={cameraPending}
          onSelectCamera={selectCamera}
          onToggleCamera={toggleCamera}
          onToggleScreenShare={toggleScreenShare}
          onUpdateVideoQuality={updateVideoQuality}
          screenShareActive={screenShareActive}
          screenAudioFallbackOpen={screenAudioFallbackOpen}
          onCloseScreenAudioFallback={() => setScreenAudioFallbackOpen(false)}
          onShareScreenWithoutAudio={shareScreenWithoutAudio}
          screenShareVolume={screenShareVolume}
          onScreenShareVolumeChange={setScreenShareVolume}
          sharedPlaybackVolume={sharedPlaybackVolume}
          onSharedPlaybackVolumeChange={setSharedPlaybackVolume}
          videoQuality={videoQuality}
          open={dialogPhase === "ready"}
          peerTyping={peerTyping}
          progress={progress}
          roomId={roomId}
          connectionRoute={connectionRoute}
          voiceActive={microphoneActive || remoteVoiceActive}
          videoActive={cameraActive || screenShareActive || remoteVideoActive}
        />
      ) : (
        <ConnectionDialog
          error={error}
          locale={locale}
          onExitComplete={() => {
            if (dialogPhase === "closing-for-full") setDialogPhase("full");
            if (dialogPhase === "closing-for-leave") leave();
            if (dialogPhase === "closing-for-ready") setDialogPhase("ready");
          }}
          onRequestLeave={() => setDialogPhase("closing-for-leave")}
          open={dialogPhase === "connecting"}
          progress={progress}
          roomId={roomId}
        />
      )}
      </div>
    </Layout>
  );
}
