import {
  RiArrowLeftLine,
  RiCheckboxCircleFill,
  RiCheckDoubleLine,
  RiCheckLine,
  RiChat3Line,
  RiCloseCircleFill,
  RiErrorWarningLine,
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
  RiSendPlane2Fill,
  RiLogoutBoxRLine,
  RiLock2Fill,
  RiLoader4Line,
  RiBrushLine,
  RiVideoOnLine,
  RiWifiLine,
} from "@remixicon/react";
import NumberFlow, { continuous, NumberFlowGroup } from "@number-flow/react";
import { useNavigate } from "@tanstack/react-router";
import cuid from "cuid";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import Layout from "../components/Layout";
import { useTheme } from "../components/theme";
import { AutoTransition } from "../components/ui/auto-transition";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { MagneticDock, type DockItemData } from "../components/ui/magnetic-dock";
import { OverlayScrollbar } from "../components/ui/overlay-scrollbar";
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

type ChatMessage = {
  deliveryStatus?: "sending" | "received" | "read" | "error";
  id: string;
  lastAttemptedAt?: number;
  text: string;
  sender: "local" | "remote";
  sentAt: number;
};

function appendChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return [...messages, message].sort((left, right) => left.id.localeCompare(right.id));
}

const continuousNumberFlow = [continuous];
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

function LatencyValue({ latency, realtimeConnection = false }: { latency: number; realtimeConnection?: boolean }) {
  return (
    <NumberFlowGroup>
      <motion.span
        layout="position"
        className={`inline-flex items-center ${latencyColor(latency, realtimeConnection)}`}
        transition={{ layout: { duration: 0.42, ease: "easeOut" } }}
      >
        <NumberFlow
          className="inline-flex leading-none"
          plugins={continuousNumberFlow}
          value={latency}
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

function TransferAmount({ bytes }: { bytes: number }) {
  const { precision, unit, value } = transferredValue(bytes);
  return (
    <motion.span
      layout="position"
      className="ml-1 inline-flex items-center"
      transition={{ layout: { duration: 0.42, ease: "easeOut" } }}
    >
      <NumberFlow
        className="inline-flex leading-none"
        format={{ maximumFractionDigits: precision, minimumFractionDigits: precision }}
        plugins={continuousNumberFlow}
        value={value}
        willChange
      />
      <motion.span layout="position" className="ml-1" transition={{ layout: { duration: 0.42, ease: "easeOut" } }}>{unit}</motion.span>
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
        <NumberFlowGroup>
          <motion.span
            layout
            className="inline-flex shrink-0 items-center font-mono text-xs font-semibold leading-none tabular-nums text-sky-100/55 sm:text-sm"
            transition={{ layout: { duration: 0.42, ease: "easeOut" } }}
          >
            <motion.span layout="position" className="text-sky-200/70" transition={{ layout: { duration: 0.42, ease: "easeOut" } }}>↑</motion.span><TransferAmount bytes={status.transferred.sent} />
            <motion.span layout="position" className="mx-2 text-sky-100/35" transition={{ layout: { duration: 0.42, ease: "easeOut" } }}>·</motion.span>
            <motion.span layout="position" className="text-sky-200/70" transition={{ layout: { duration: 0.42, ease: "easeOut" } }}>↓</motion.span><TransferAmount bytes={status.transferred.received} />
          </motion.span>
        </NumberFlowGroup>
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
    <section className="flex h-full min-h-0 w-full max-w-2xl flex-col pb-[clamp(6rem,7vh,7rem)] pt-6 lg:max-w-3xl">
      <OverlayScrollbar
        className="min-h-0 flex-1 px-2 pb-7 pt-4 pr-5 [mask-image:linear-gradient(to_bottom,transparent_0%,black_4rem,black_calc(100%-3rem),transparent_100%)]"
        syncKey={messages.length}
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
      </OverlayScrollbar>
      <form
        className="relative shrink-0 border-t border-white/10 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <AutoTransition
          as="span"
          aria-live="polite"
          className="absolute -top-5 left-4 text-xs font-medium tracking-[0.04em] text-sky-100/45"
          duration={0.2}
          transitionKey={peerTyping ? "typing" : "idle"}
          type="fade"
        >
          {peerTyping ? typingLabel : null}
        </AutoTransition>
        <textarea
          aria-label={placeholder}
          className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 pr-14 text-sm font-medium leading-relaxed tracking-[0.03em] text-sky-50 outline-none transition-colors placeholder:text-sky-100/35 focus:border-sky-100/35 focus:bg-black/30 disabled:cursor-not-allowed disabled:opacity-45"
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
      </form>
    </section>
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

function RoomWorkspace({
  chatMessages,
  locale,
  onExitComplete,
  onLeave,
  onMarkChatMessageRead,
  onChatTyping,
  peerTyping,
  open,
  progress,
  roomId,
  connectionRoute,
  onSendChatMessage,
}: {
  chatMessages: ChatMessage[];
  locale: RoomLocale;
  onExitComplete?: () => void;
  onLeave: () => void;
  onMarkChatMessageRead: (id: string) => boolean;
  onChatTyping: () => void;
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

  const dockItems: DockItemData[] = workspaceOrder.map((workspaceId) => {
    const Icon = workspaceIcons[workspaceId];
    return {
      badge: workspaceId === "chat" ? unreadChatCount : undefined,
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
    onClick: () => setExitDialogOpen(true),
    tone: "danger",
  });

  return (
    <Dialog fullScreen open={open} overlay={false} onExitComplete={onExitComplete} onOpenChange={ignoreDialogOpenChange}>
      <DialogContent
        fadeOnly
        fullScreen
        aria-labelledby="connection-ready-title"
        style={{ height: "100dvh", maxHeight: "none", width: "100dvw" }}
      >
        <motion.div
          animate={{ opacity: isExiting ? 0 : 1 }}
          className="relative flex min-h-full flex-1 flex-col p-5 sm:p-8"
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
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
                  <section className={activeWorkspace === "chat" || activeWorkspace === "status" ? "flex h-full min-h-0 w-full flex-1 justify-center" : "flex min-h-0 w-full flex-1 items-center justify-center py-6"}>
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
  const [peerTyping, setPeerTyping] = useState(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
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
  const lastTypingSentAtRef = useRef(0);

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
    void navigate({ to: locale === "zh" ? "/zh" : "/en" });
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
          locale={locale}
          onExitComplete={() => {
            if (dialogPhase === "closing-for-reconnect") setDialogPhase("connecting");
          }}
          onLeave={leave}
          onChatTyping={sendChatTyping}
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
