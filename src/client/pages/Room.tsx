import {
  RiArrowLeftLine,
  RiAddLine,
  RiCheckboxCircleFill,
  RiCheckDoubleLine,
  RiCheckLine,
  RiChat3Line,
  RiCloseCircleFill,
  RiDeleteBinLine,
  RiDownload2Line,
  RiEyeLine,
  RiErrorWarningLine,
  RiExchange2Line,
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
  RiLogoutBoxRLine,
  RiLock2Fill,
  RiLoader4Line,
  RiBrushLine,
  RiVideoOnLine,
  RiWifiLine,
} from "@remixicon/react";
import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useNavigate } from "@tanstack/react-router";
import cuid from "cuid";
import { AnimatePresence, motion } from "framer-motion";
import { type CSSProperties, type DragEventHandler, type ReactNode, useEffect, useRef, useState } from "react";

import Layout from "../components/Layout";
import { useTheme } from "../components/theme";
import { AutoTransition } from "../components/ui/auto-transition";
import { Clickable } from "../components/ui/clickable";
import { Dialog, DialogClose, DialogContent } from "../components/ui/dialog";
import { MagneticDock, type DockItemData } from "../components/ui/magnetic-dock";
import { OverlayScrollbar } from "../components/ui/overlay-scrollbar";
import { FileTransferManager, type FileTransferDiagnostics, type FileTransferSnapshot } from "../lib/file-transfer";
import {
  NativeWebRTCSession,
  type ConnectionRoute,
  type ConnectionProgress,
  type ConnectionState,
  type ConnectionStep,
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
  return <TransferStatsDisplay mode={mode} rates={rates} transferred={transferred} />;
}

function TransferStatsDisplay({ rates, transferred, mode = "totals" }: { rates: { received: number; sent: number }; transferred?: { received: number; sent: number }; mode?: "rates" | "totals" }) {
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
        className="flex shrink-0 flex-wrap items-baseline gap-y-1 whitespace-nowrap text-xs font-medium text-sky-100/55 sm:text-sm"
        transition={{ layout: { duration: 0.42, ease: "easeOut" } }}
      >
        {mode === "totals" ? <>{metric("up", sent)}{separator}{metric("down", received)}{separator}<motion.span layout="position" className="inline-flex items-baseline font-mono tabular-nums"><FileSizeValue bytes={rates.sent + rates.received} suffix="/s" /></motion.span></> : <>{metric("up", rates.sent, "/s")}{separator}{metric("down", rates.received, "/s")}</>}
      </motion.div>
    </NumberFlowGroup>
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
        <div ref={messageListRef} className="flex min-h-full flex-col justify-end pt-8">
          <AnimatePresence initial={false} mode="popLayout">
            {messages.length === 0 ? (
              <motion.div
                key="empty-chat"
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-1 flex-col items-center justify-center pb-8 text-center"
                exit={{ opacity: 0, y: -8 }}
                initial={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <RiChat3Line aria-hidden="true" className="size-9 text-sky-200/55" />
                <p className="mt-4 max-w-xs text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/50">{emptyMessage}</p>
              </motion.div>
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
      {files.length === 0 ? <div className="flex min-h-full flex-col items-center justify-center px-6 pb-8 text-center"><RiFolderTransferLine aria-hidden="true" className="size-10 text-sky-200/55" /><p className="mt-4 max-w-sm text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/50">{copy.empty}</p></div> : <div className="space-y-3 pt-4"><AnimatePresence initial={false}>{files.map((file) => {
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
  peerTyping,
  open,
  progress,
  roomId,
  connectionRoute,
  onSendChatMessage,
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
  peerTyping: boolean;
  open: boolean;
  progress: ConnectionProgress;
  roomId: string;
  connectionRoute: ConnectionRoute;
  onSendChatMessage: (text: string) => boolean;
}) {
  const copy = roomCopy[locale];
  const { theme } = useTheme();
  const workspace = workspaceCopy[locale];
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId | null>(() => workspaceFromHash());
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isExitDialogOpen, setExitDialogOpen] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [showConnectionRates, setShowConnectionRates] = useState(false);
  const connectionRates = useTransferRates(progress.dataChannel.transferred);
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

  const dockItems: DockItemData[] = workspaceOrder.map((workspaceId) => {
    const Icon = workspaceIcons[workspaceId];
    return {
      badge: workspaceId === "chat" ? unreadChatCount : workspaceId === "files" ? pendingFileRequests : undefined,
      icon: <Icon aria-hidden="true" className="size-full" />,
      id: workspaceId,
      isActive: activeWorkspace === workspaceId,
      label: workspace.apps[workspaceId][0],
      running: workspaceId === "files" && activeWorkspace !== "files" && fileRunning,
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
          className="relative flex min-h-full flex-1 flex-col p-5 sm:p-8"
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <header className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <motion.h1
                animate={{ opacity: 1, x: 0 }}
                className="bg-clip-text text-xl font-bold text-transparent md:text-2xl"
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
              <p className="truncate text-lg font-bold tracking-[0.06em] text-sky-100/65 sm:text-xl"># {roomId}</p>
            </div>
            <Clickable
              aria-label={showConnectionRates ? "Show connection quality" : "Show transfer rates"}
              className="shrink-0"
              hoverScale={1.025}
              onClick={() => setShowConnectionRates((current) => !current)}
              tapScale={0.98}
            >
              <AutoTransition as="span" className="inline-flex shrink-0 items-center" duration={0.2} presenceMode="wait" transitionKey={showConnectionRates ? "rates" : "connection"} type="fade">
                {showConnectionRates ? <TransferStatsDisplay mode="rates" rates={connectionRates} transferred={progress.dataChannel.transferred} /> : (
            <motion.div
              layout="position"
              className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold tracking-[0.05em]"
              transition={{ layout: { duration: 0.32, ease: "easeOut" } }}
            >
              <RiLock2Fill aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />
              <motion.span layout="position" className="whitespace-nowrap text-emerald-300" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>
                {connectionRoute === "relay" ? copy.encryptedRelay : copy.encrypted}
              </motion.span>
              <motion.span layout="position" className="text-slate-400/60" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>|</motion.span>
              <motion.span layout="position" className={progress.p2p.latency === undefined ? "text-slate-400" : latencyColor(progress.p2p.latency, true)} transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>
                <SignalIcon className="size-4 shrink-0" level={signalLevel(progress.p2p.latency)} />
              </motion.span>
              <NumberFlowGroup>
                <motion.span
                  layout="position"
                  className={`inline-flex shrink-0 items-baseline font-mono tabular-nums ${progress.p2p.latency === undefined ? "text-slate-400" : latencyColor(progress.p2p.latency, true)}`}
                  transition={{ layout: { duration: 0.32, ease: "easeOut" } }}
                >
                  {progress.p2p.latency === undefined ? <motion.span layout="position">--</motion.span> : <NumberFlow value={Math.round(progress.p2p.latency)} willChange />}
                  <motion.span layout="position" className="ml-1" transition={{ layout: { duration: 0.32, ease: "easeOut" } }}>ms</motion.span>
                </motion.span>
              </NumberFlowGroup>
            </motion.div>
                )}
              </AutoTransition>
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
                    <h1 id="connection-ready-title" className="mt-2 text-3xl font-bold tracking-[0.04em] text-sky-50">{copy.ready}</h1>
                    <p className="mx-auto mt-4 max-w-lg text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/65">
                      {copy.readyDescription}
                    </p>
                  </div>
                </section>
              ) : (() => {
                const [title, description] = workspace.apps[activeWorkspace];
                const Icon = workspaceIcons[activeWorkspace];
                const isRunning = runningWorkspaces.includes(activeWorkspace);

                return (
                  <section className={activeWorkspace === "chat" || activeWorkspace === "files" || activeWorkspace === "status" ? "flex h-full min-h-0 w-full flex-1 justify-center" : "flex min-h-0 w-full flex-1 items-center justify-center py-6"}>
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
                            <h1 id="connection-ready-title" className="text-3xl font-bold tracking-[0.04em] text-sky-50">{title}</h1>
                            <p className="mt-2 text-sm font-medium tracking-[0.04em] text-sky-100/60">{workspace.statusHint}</p>
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
                        <h1 id="connection-ready-title" className="mt-5 text-3xl font-bold tracking-[0.04em] text-sky-50">{title}</h1>
                        <p className="mx-auto mt-3 max-w-md text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/60">{description}</p>
                        {isRunning ? <p className="mt-6 text-xs font-bold tracking-[0.1em] text-sky-100/40">{workspace.background}</p> : null}
                      </div>
                    )}
                  </section>
                );
              })()}
            </AutoTransition>
          </main>

          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center sm:bottom-7">
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
  const [peerTyping, setPeerTyping] = useState(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const fileTransfersRef = useRef<FileTransferSnapshot[]>([]);
  const fileTransferRefreshTimerRef = useRef<number | null>(null);
  const peerTypingTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
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
        setDialogPhase("closing-for-ready");
      },
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
    );
    sessionRef.current = session;
    session.attachFileTransferManager(fileManagerRef.current);
    session.connect();

    return () => {
      if (peerTypingTimerRef.current !== null) window.clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = null;
      session.close();
      sessionRef.current = null;
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
      {dialogPhase === "full" ? (
        <RoomFullContent locale={locale} onLeave={leave} roomId={roomId} />
      ) : dialogPhase === "ready" || dialogPhase === "closing-for-reconnect" ? (
        <RoomWorkspace
          chatMessages={chatMessages}
          fileTransfers={fileTransfers}
          locale={locale}
          onExitComplete={() => {
            if (dialogPhase === "closing-for-reconnect") setDialogPhase("connecting");
          }}
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
          onMarkChatMessageRead={markChatMessageRead}
          onSendChatMessage={sendChatMessage}
          open={dialogPhase === "ready"}
          peerTyping={peerTyping}
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
            if (dialogPhase === "closing-for-leave") leave();
            if (dialogPhase === "closing-for-ready") setDialogPhase("ready");
          }}
          onRequestLeave={() => setDialogPhase("closing-for-leave")}
          open={dialogPhase === "connecting"}
          progress={progress}
          roomId={roomId}
        />
      )}
    </Layout>
  );
}
