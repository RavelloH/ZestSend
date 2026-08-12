import {
  RiCastFill,
  RiBrushFill,
  RiFileFill,
  RiFolderSharedFill,
  RiGithubFill,
  RiGlobalLine,
  RiInformationLine,
  RiLock2Fill,
  RiMarkdownFill,
  RiMessage3Fill,
  RiMovieFill,
  RiMusicFill,
  RiPhoneFill,
  RiCheckLine,
  RiRadarLine,
  RiSettings3Line,
  RiVideoChatFill,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { motion } from "framer-motion";
import Layout from "../components/Layout";
import { appThemes, useTheme } from "../components/theme";
import { CursorDrivenParticleTypography } from "../components/ui/cursor-driven-particle-typography";
import { AutoResizer } from "../components/ui/auto-resizer";
import { AutoTransition } from "../components/ui/auto-transition";
import { Clickable } from "../components/ui/clickable";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { LetterCascade } from "../components/ui/letter-cascade";
import { Signature } from "../components/ui/signature";
import { TextRepel } from "../components/ui/text-repel";
import { prepareIceServers, preloadIceServers, type IceDiagnosticEntry, type IcePreparationResult } from "../lib/webrtc";

type HomeLocale = "en" | "zh";
type ActivityIcon =
  | "chat"
  | "file"
  | "screen"
  | "video"
  | "voice"
  | "watch"
  | "write"
  | "draw"
  | "folder"
  | "music";
type Activity = { word: string; icon: ActivityIcon };

const activityIcons = {
  chat: RiMessage3Fill,
  file: RiFileFill,
  screen: RiCastFill,
  video: RiVideoChatFill,
  voice: RiPhoneFill,
  watch: RiMovieFill,
  write: RiMarkdownFill,
  draw: RiBrushFill,
  folder: RiFolderSharedFill,
  music: RiMusicFill,
};

const homeCopy: Record<
  HomeLocale,
  {
    title: string;
    heading: string;
    language: string;
    prefix: string;
    activities: Activity[];
    codeInputLabel: string;
    codeHint: string;
    footerLinks: string[];
    languageDialog: {
      close: string;
      description: string;
      title: string;
    };
    settingsDialog: {
      close: string;
      description: string;
      title: string;
    };
    aboutDialog: {
      close: string;
      description: string;
      diagnostics: {
        checking: string;
        empty: string;
        failed: string;
        latency: (latency: number) => string;
        measurement: string;
        measuredAt: (time: string) => string;
        providerCount: (count: number) => string;
        resource: string;
        resourceUnavailable: string;
        supported: string;
        unsupported: string;
        selected: string;
        stun: string;
        title: string;
        turn: string;
        unavailable: string;
      };
      intro: string;
      title: string;
    };
  }
> = {
  en: {
    title: "ZestSend — Private P2P file transfer",
    heading: "ZestSend — Private P2P file transfer",
    language: "en",
    prefix: "Anonymously",
    codeInputLabel: "Connection code digit",
    codeHint: "Connect by entering any four digits that match someone else's.",
    footerLinks: ["Language", "Settings", "About"],
    languageDialog: {
      close: "Close language picker",
      description: "Choose the language used on the ZestSend home page.",
      title: "Language",
    },
    settingsDialog: {
      close: "Close settings",
      description: "Choose the colors used throughout ZestSend.",
      title: "Appearance",
    },
    aboutDialog: {
      close: "Close about ZestSend",
      description: "An open-source P2P connection tool for secure, private data transfer.",
      diagnostics: {
        checking: "Measuring available ICE servers...",
        empty: "No ICE measurements are available yet.",
        failed: "ICE measurements could not be completed.",
        latency: (latency) => `${latency} ms`,
        measurement: "Measurement",
        measuredAt: (time) => `Measured ${time}`,
        providerCount: (count) => `${count} selected STUN providers`,
        resource: "Cloudflare ICE",
        resourceUnavailable: "Unavailable",
        supported: "Supported",
        unsupported: "Unavailable",
        selected: "Selected",
        stun: "STUN",
        title: "Connection diagnostics",
        turn: "TURN",
        unavailable: "Unavailable",
      },
      intro: "ZestSend is a WebRTC-powered peer-to-peer (P2P) data transfer website that lets you send data securely and privately, without server relays or storage.",
      title: "About ZestSend",
    },
    activities: [
      { word: "chat in real time", icon: "chat" },
      { word: "send files", icon: "file" },
      { word: "share your screen", icon: "screen" },
      { word: "make a video call", icon: "video" },
      { word: "talk anytime", icon: "voice" },
      { word: "watch videos together", icon: "watch" },
      { word: "write together", icon: "write" },
      { word: "draw together", icon: "draw" },
      { word: "share a folder", icon: "folder" },
      { word: "listen together", icon: "music" },
    ],
  },
  zh: {
    title: "ZestSend — 私密 P2P 文件传输",
    heading: "ZestSend — 私密 P2P 文件传输",
    language: "zh-CN",
    prefix: "匿名",
    codeInputLabel: "连接数字第",
    codeHint: "与其他人输入任意四位相同数字来连接",
    footerLinks: ["语言", "设置", "关于"],
    languageDialog: {
      close: "关闭语言选择",
      description: "选择 ZestSend 首页使用的语言。",
      title: "语言",
    },
    settingsDialog: {
      close: "关闭设置",
      description: "选择 ZestSend 使用的背景和强调色。",
      title: "外观",
    },
    aboutDialog: {
      close: "关闭关于 ZestSend",
      description: "开源的 P2P 连接工具，提供安全、私密的 P2P 数据传输。",
      diagnostics: {
        checking: "正在测速可用的 ICE 服务器...",
        empty: "尚无可用的 ICE 测速结果。",
        failed: "ICE 服务器测速未能完成。",
        latency: (latency) => `${latency} ms`,
        measurement: "测速",
        measuredAt: (time) => `测速于 ${time}`,
        providerCount: (count) => `已选用 ${count} 家 STUN 供应商`,
        resource: "Cloudflare ICE",
        resourceUnavailable: "不可用",
        supported: "支持",
        unsupported: "不可用",
        selected: "已选用",
        stun: "STUN",
        title: "连接诊断",
        turn: "TURN",
        unavailable: "不可用",
      },
      intro: "ZestSend 是一个基于 WebRTC 的点对点（P2P）数据传输网站，支持安全、私密地传输数据，无需通过服务器中转或存储。",
      title: "关于 ZestSend",
    },
    activities: [
      { word: "畅聊", icon: "chat" },
      { word: "传文件", icon: "file" },
      { word: "共享屏幕", icon: "screen" },
      { word: "发起视频通话", icon: "video" },
      { word: "语音通话", icon: "voice" },
      { word: "一起追剧看电影", icon: "watch" },
      { word: "共同协作", icon: "write" },
      { word: "一起涂鸦", icon: "draw" },
      { word: "分享整个文件夹", icon: "folder" },
      { word: "同步听一首歌", icon: "music" },
    ],
  },
};

function shuffled<T>(values: readonly T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function ActivityTransition({ activities }: { activities: readonly Activity[] }) {
  const [activityIndex, setActivityIndex] = useState(0);
  const activity = activities[activityIndex] ?? activities[0];

  useEffect(() => {
    setActivityIndex(0);
    if (activities.length < 2) return;

    const timer = window.setInterval(() => {
      setActivityIndex((index) => (index + 1) % activities.length);
    }, 2_400);

    return () => window.clearInterval(timer);
  }, [activities]);

  if (!activity) return null;
  const Icon = activityIcons[activity.icon];

  return (
    <AutoResizer animateHeight={false} animateWidth duration={0.38} className="inline-flex !bg-transparent align-middle">
      <AutoTransition
        as="span"
        className="inline-flex !bg-transparent items-center gap-1.5 py-[0.08em] whitespace-nowrap sm:gap-3"
        duration={0.38}
        transitionKey={activity.word}
        type="fade"
      >
        <span>{activity.word}</span>
        <Icon aria-hidden="true" className="size-[0.9em] shrink-0" />
      </AutoTransition>
    </AutoResizer>
  );
}

function ConnectionCodeInput({
  length,
  inputLabel,
  hint,
  links,
  onAboutClick,
  onComplete,
  onLanguageClick,
  onSettingsClick,
}: {
  length: number;
  inputLabel: string;
  hint: string;
  links: readonly string[];
  onAboutClick: () => void;
  onComplete: (roomId: string) => void;
  onLanguageClick: () => void;
  onSettingsClick: () => void;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [code, setCode] = useState(() => Array.from({ length }, () => ""));
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const completedRoomRef = useRef<string | null>(null);

  const focusAt = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      const input = inputRefs.current[index];
      input?.focus();
    });
  }, []);

  useEffect(() => {
    focusAt(0);
  }, [focusAt]);

  useEffect(() => {
    const roomId = code.join("");
    if (roomId.length === length && completedRoomRef.current !== roomId) {
      completedRoomRef.current = roomId;
      onComplete(roomId);
    }
    if (roomId.length < length) completedRoomRef.current = null;
  }, [code, length, onComplete]);

  const distributeDigits = useCallback(
    (startIndex: number, rawValue: string) => {
      const incoming = rawValue.replace(/\D/g, "").slice(0, length - startIndex);
      if (!incoming) return;

      setCode((current) => {
        const next = [...current];
        [...incoming].forEach((digit, offset) => {
          next[startIndex + offset] = digit;
        });
        return next;
      });

      focusAt(Math.min(startIndex + incoming.length, length - 1));
    },
    [length, focusAt],
  );

  const handleChange = useCallback(
    (index: number, event: ChangeEvent<HTMLInputElement>) => {
      const incoming = event.currentTarget.value.replace(/\D/g, "");
      if (incoming.length > 1) {
        distributeDigits(index, incoming);
        return;
      }

      const digit = incoming.slice(-1);
      setCode((current) => {
        const next = [...current];
        next[index] = digit;
        return next;
      });

      if (digit) {
        if (index < length - 1) focusAt(index + 1);
      }
    },
    [length, distributeDigits, focusAt],
  );

  const handlePaste = useCallback(
    (index: number, event: ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault();
      distributeDigits(index, event.clipboardData.getData("text"));
    },
    [distributeDigits],
  );

  const handleKeyDown = useCallback(
    (index: number, event: KeyboardEvent<HTMLInputElement>) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        setCode((current) => {
          const next = [...current];
          next[index] = event.key;
          return next;
        });

        if (index < length - 1) focusAt(index + 1);
        return;
      }

      if (event.key !== "Backspace") return;

      event.preventDefault();
      setCode((current) => {
        const next = [...current];
        const clearIndex = current[index] ? index : Math.max(index - 1, 0);
        next[clearIndex] = "";
        return next;
      });

      if (index > 0) focusAt(index - 1);
    },
    [length, focusAt],
  );

  return (
    <div className="mt-14 flex flex-col items-center sm:mt-20" role="group" aria-label={hint}>
      <div className="flex items-center justify-center gap-3 sm:gap-5">
        {Array.from({ length }, (_, index) => {
          const isFilled = Boolean(code[index]);
          const displayedDigit = code[index];
          const progressPosition = isFilled ? "0%" : "100%";

          return (
            <div key={index} className="relative h-14 w-12 sm:h-20 sm:w-20">
              <input
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                aria-label={`${inputLabel} ${index + 1}`}
                autoComplete="one-time-code"
                className="absolute inset-0 z-10 h-full w-full appearance-none border-0 bg-transparent p-0 text-transparent caret-transparent outline-none placeholder:text-transparent selection:bg-transparent selection:text-transparent"
                inputMode="numeric"
                maxLength={1}
                onBlur={() => setFocusedIndex(null)}
                onChange={(event) => handleChange(index, event)}
                onFocus={(event) => {
                  setFocusedIndex(index);
                }}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={(event) => handlePaste(index, event)}
                onSelect={(event) => event.currentTarget.setSelectionRange(0, 0)}
                type="text"
                value={code[index]}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 text-center text-4xl font-[inherit] font-bold leading-none sm:text-6xl"
              >
                <motion.span
                  animate={{ backgroundPositionX: progressPosition }}
                  className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-clip-text bg-[length:200%_100%] text-transparent"
                  initial={false}
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, #6ee7b7 0%, #6ee7b7 50%, rgba(224, 242, 254, 0.48) 50%, rgba(224, 242, 254, 0.48) 100%)",
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 620,
                    damping: 45,
                    mass: 0.25,
                    delay: index * 0.035,
                  }}
                >
                  {displayedDigit}
                </motion.span>
                <motion.span
                  animate={{ backgroundPositionX: progressPosition }}
                  className="absolute inset-x-0 bottom-0 h-[6px] bg-[length:200%_100%]"
                  initial={false}
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, #6ee7b7 0%, #6ee7b7 50%, rgba(224, 242, 254, 0.48) 50%, rgba(224, 242, 254, 0.48) 100%)",
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 620,
                    damping: 45,
                    mass: 0.25,
                    delay: index * 0.035,
                  }}
                />
                {focusedIndex === index ? (
                  <motion.span
                    animate={{ opacity: [0, 1, 1, 0, 0] }}
                    className={`absolute top-1/2 z-20 h-[0.9em] w-[2px] -translate-y-1/2 ${
                      isFilled ? "bg-emerald-300" : "bg-sky-100"
                    }`}
                    initial={{ opacity: 0 }}
                    style={{ left: isFilled ? "calc(50% + 0.34em)" : "50%" }}
                    transition={{
                      duration: 0.7,
                      ease: "linear",
                      repeat: Infinity,
                      times: [0, 0.06, 0.46, 0.52, 1],
                    }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-center text-[clamp(0.8rem,3.4vw,1.25rem)] font-semibold tracking-[0.06em] text-sky-100/85 sm:tracking-[0.1em]">
        {hint}
      </p>
      <FooterLinks
        links={links}
        onAboutClick={onAboutClick}
        onLanguageClick={onLanguageClick}
        onSettingsClick={onSettingsClick}
      />
      <ProjectAttribution />
    </div>
  );
}

function ProjectAttribution() {
  return (
    <p className="mt-7 inline-flex items-center gap-1.5 text-center text-[clamp(0.7rem,1.6vw,0.95rem)] font-semibold tracking-[0.08em] text-sky-100/75 sm:mt-9">
      <a
        aria-label="GitHub: RavelloH/ZestSend"
        className="inline-flex items-center hover:text-sky-100"
        href="https://github.com/ravelloh/zestsend"
        rel="noreferrer"
        target="_blank"
      >
        <RiGithubFill aria-hidden="true" className="size-[1.15em]" />
        <LetterCascade
          text="RavelloH/ZestSend"
          className="ml-1.5 text-inherit"
          staggerFrom="center"
        />
      </a>
      <span>. Made by </span>
      <a
        className="hover:text-sky-100"
        href="https://ravelloh.com"
        rel="noreferrer"
        target="_blank"
      >
        <LetterCascade
          text="RavelloH"
          className="text-inherit"
          staggerFrom="center"
        />
      </a>
    </p>
  );
}

function FooterLinks({
  links,
  onAboutClick,
  onLanguageClick,
  onSettingsClick,
}: {
  links: readonly string[];
  onAboutClick: () => void;
  onLanguageClick: () => void;
  onSettingsClick: () => void;
}) {
  const icons = [RiGlobalLine, RiSettings3Line, RiInformationLine];
  const actions = [onLanguageClick, onSettingsClick, onAboutClick];

  return (
    <nav aria-label="Footer navigation" className="mt-7 flex justify-center sm:mt-8">
      <div className="flex items-center gap-5 text-[clamp(0.7rem,1.6vw,0.95rem)] font-semibold text-sky-100/75 sm:gap-7">
        {links.map((link, index) => (
          <Clickable
            key={link}
            aria-label={link}
            className="size-7 text-inherit sm:size-8"
            onClick={actions[index]}
          >
            {(() => {
              const Icon = icons[index] ?? RiInformationLine;
              return <Icon aria-hidden="true" className="size-full" />;
            })()}
          </Clickable>
        ))}
      </div>
    </nav>
  );
}

function LanguageDialog({
  locale,
  onOpenChange,
  open,
  onSelect,
}: {
  locale: HomeLocale;
  onOpenChange: (open: boolean) => void;
  onSelect: (locale: HomeLocale) => void;
  open: boolean;
}) {
  const copy = homeCopy[locale].languageDialog;
  const { theme } = useTheme();
  const options: Array<{ locale: HomeLocale; name: string; preview: string }> = [
    {
      locale: "zh",
      name: "简体中文",
      preview: "我能吞下玻璃而不伤身体",
    },
    {
      locale: "en",
      name: "English",
      preview: "I can eat glass and it doesn't hurt me.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="language-dialog-description"
        aria-labelledby="language-dialog-title"
        className="!max-w-xl"
      >
        <DialogHeader className="p-5 sm:p-6">
          <div>
            <DialogTitle id="language-dialog-title" className="text-xl sm:text-2xl">{copy.title}</DialogTitle>
            <DialogDescription id="language-dialog-description" className="mt-1 text-xs sm:text-sm">{copy.description}</DialogDescription>
          </div>
          <DialogClose aria-label={copy.close} data-dialog-autofocus />
        </DialogHeader>
        <div className="flex flex-col divide-y divide-white/10">
          {options.map((option) => {
            const selected = option.locale === locale;

            return (
              <button
                key={option.locale}
                aria-pressed={selected}
                className={`relative flex min-h-24 flex-col justify-center gap-2 px-5 py-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-100/60 sm:px-6 sm:py-6 ${
                  selected
                    ? "text-sky-50"
                    : "text-sky-50 hover:bg-white/[0.04]"
                }`}
                onClick={() => onSelect(option.locale)}
                style={selected ? { backgroundColor: `${theme.accent}1A`, color: theme.accent } : undefined}
                type="button"
              >
                {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5" style={{ backgroundColor: theme.accent }} /> : null}
                <span className="text-lg font-bold tracking-[0.04em] sm:text-xl">{option.name}</span>
                <span className="flex w-full items-center justify-between gap-4 text-sm font-medium leading-relaxed tracking-[0.04em] text-sky-100/60 sm:text-base">
                  <span>{option.preview}</span>
                  {selected ? <RiCheckLine aria-label="Selected" className="size-5 shrink-0" style={{ color: theme.accent }} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  locale,
  onOpenChange,
  open,
}: {
  locale: HomeLocale;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const copy = homeCopy[locale].settingsDialog;
  const { setThemeId, themeId } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="settings-dialog-description"
        aria-labelledby="settings-dialog-title"
        className="!max-w-xl"
      >
        <DialogHeader className="p-5 sm:p-6">
          <div>
            <DialogTitle id="settings-dialog-title" className="text-xl sm:text-2xl">{copy.title}</DialogTitle>
            <DialogDescription id="settings-dialog-description" className="mt-1 text-xs sm:text-sm">{copy.description}</DialogDescription>
          </div>
          <DialogClose aria-label={copy.close} data-dialog-autofocus />
        </DialogHeader>
        <div className="flex flex-col divide-y divide-white/10">
          {appThemes.map((theme) => {
            const selected = theme.id === themeId;

            return (
              <button
                key={theme.id}
                aria-pressed={selected}
                className={`relative grid min-h-24 grid-cols-[minmax(0,1fr)_1.5rem_6rem] items-stretch text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-100/60 sm:grid-cols-[minmax(0,1fr)_1.5rem_9rem] ${
                  selected ? "text-sky-50" : "text-sky-50 hover:bg-white/[0.04]"
                }`}
                onClick={() => setThemeId(theme.id)}
                style={selected ? { backgroundColor: `${theme.accent}1A`, color: theme.accent } : undefined}
                type="button"
              >
                {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5" style={{ backgroundColor: theme.accent }} /> : null}
                <span className="flex min-w-0 flex-col justify-center gap-0.5 px-5 py-4 sm:px-6">
                  <span className="text-base font-bold tracking-[0.04em] sm:text-lg">{theme.name[locale]}</span>
                  <span className="text-xs font-medium leading-snug tracking-[0.03em] text-sky-100/55">{theme.description[locale]}</span>
                </span>
                <span className="flex items-center justify-center">
                  {selected ? <RiCheckLine aria-label="Selected" className="size-5" style={{ color: theme.accent }} /> : null}
                </span>
                <span aria-hidden="true" className="flex">
                  {[theme.deep, theme.mid, theme.highlight].map((color) => (
                    <span key={color} className="h-full aspect-[1/2]" style={{ backgroundColor: color }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AboutDialog({
  locale,
  onOpenChange,
  onDiagnosticsClick,
  open,
}: {
  locale: HomeLocale;
  onOpenChange: (open: boolean) => void;
  onDiagnosticsClick: () => void;
  open: boolean;
}) {
  const copy = homeCopy[locale].aboutDialog;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="about-dialog-description"
        aria-labelledby="about-dialog-title"
        className="!max-w-xl"
      >
        <DialogHeader className="p-5 sm:p-6">
          <div>
            <DialogTitle id="about-dialog-title" className="text-xl sm:text-2xl">{copy.title}</DialogTitle>
            <DialogDescription id="about-dialog-description" className="mt-1 text-xs sm:text-sm">{copy.description}</DialogDescription>
          </div>
          <DialogClose aria-label={copy.close} data-dialog-autofocus />
        </DialogHeader>
        <div className="space-y-7 p-5 text-sm leading-relaxed text-sky-100/75 sm:p-6 sm:text-base">
          <p>{copy.intro}</p>
          <div className="flex w-full items-center gap-4">
            <a
              className="inline-flex w-fit items-center gap-2 font-semibold text-sky-100 transition-colors hover:text-white"
              href="https://github.com/ravelloh/zestsend"
              rel="noreferrer"
              target="_blank"
            >
              <RiGithubFill aria-hidden="true" className="size-5" />
              RavelloH/ZestSend
            </a>
            <button
              aria-label={copy.diagnostics.title}
              className="ml-auto inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-sky-100/70 transition-colors hover:text-sky-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60"
              onClick={onDiagnosticsClick}
              type="button"
            >
              <RiRadarLine aria-hidden="true" className="size-5" />
              <span>{copy.diagnostics.title}</span>
            </button>
          </div>
          <div className="border-t border-white/10 pt-10 sm:pt-12">
            <a
              aria-label="Visit RavelloH"
              className="group flex justify-center py-1 text-sky-100/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60"
              href="https://ravelloh.com"
              rel="noreferrer"
              target="_blank"
            >
              <Signature
                className="transition-opacity duration-300 group-hover:opacity-100"
                color="currentColor"
                duration={3}
                fontSize={24}
                fontUrl="/LastoriaBoldRegular.otf"
                text="RavelloH"
              />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiagnosticsDialog({
  locale,
  onOpenChange,
  open,
}: {
  locale: HomeLocale;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const copy = homeCopy[locale].aboutDialog;
  const [preparation, setPreparation] = useState<IcePreparationResult | null>(null);
  const [failed, setFailed] = useState(false);
  const groups: Array<{ kind: IceDiagnosticEntry["kind"]; label: string }> = [
    { kind: "stun", label: copy.diagnostics.stun },
    { kind: "turn", label: copy.diagnostics.turn },
  ];

  useEffect(() => {
    if (!open) return;
    let active = true;
    setFailed(false);
    void prepareIceServers()
      .then((result) => {
        if (active) setPreparation(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const diagnostics = preparation?.diagnostics ?? null;
  const selectedProviderCount = diagnostics
    ? new Set(diagnostics.filter((entry) => entry.kind === "stun" && entry.selected).map((entry) => entry.provider)).size
    : 0;
  const webRtcSupported = typeof RTCPeerConnection !== "undefined" && typeof RTCDataChannel !== "undefined";
  const measuredAt = preparation
    ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(preparation.completedAt)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="diagnostics-dialog-title" className="!max-w-2xl">
        <div className="flex min-w-0 flex-col">
          <DialogHeader className="w-full p-5 sm:p-6">
            <div>
              <DialogTitle id="diagnostics-dialog-title" className="text-xl sm:text-2xl">{copy.diagnostics.title}</DialogTitle>
              <DialogDescription className="mt-1 text-xs sm:text-sm">
                {failed
                  ? copy.diagnostics.failed
                  : diagnostics === null
                    ? copy.diagnostics.checking
                    : diagnostics.length === 0
                      ? copy.diagnostics.empty
                      : `${diagnostics.filter((entry) => entry.kind === "stun").length} ${copy.diagnostics.stun} · ${diagnostics.filter((entry) => entry.kind === "turn").length} ${copy.diagnostics.turn}`}
              </DialogDescription>
            </div>
            <DialogClose aria-label={copy.close} data-dialog-autofocus />
          </DialogHeader>
          {diagnostics && diagnostics.length > 0 && preparation ? (
            <div className="w-full divide-y divide-white/10 px-5 pb-5 sm:px-6 sm:pb-6">
              <section className="grid grid-cols-2 gap-x-6 gap-y-3 py-4 text-xs font-mono sm:grid-cols-3">
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-sky-100/45">{copy.diagnostics.resource}</p>
                  <p className={`mt-1 truncate ${preparation.resource.state === "ready" ? "text-emerald-300" : "text-amber-300"}`}>
                    {preparation.resource.latency !== undefined ? copy.diagnostics.latency(preparation.resource.latency) : copy.diagnostics.resourceUnavailable}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-sky-100/45">{copy.diagnostics.measurement}</p>
                  <p className="mt-1 truncate text-sky-100/70">{preparation.duration} ms</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-sky-100/45">WebRTC / DataChannel</p>
                  <p className={`mt-1 truncate ${webRtcSupported ? "text-emerald-300" : "text-amber-300"}`}>{webRtcSupported ? copy.diagnostics.supported : copy.diagnostics.unsupported}</p>
                </div>
                <p className="col-span-2 truncate text-sky-100/55 sm:col-span-3">{copy.diagnostics.providerCount(selectedProviderCount)}</p>
                {measuredAt ? <p className="col-span-2 truncate text-sky-100/55 sm:col-span-3">{copy.diagnostics.measuredAt(measuredAt)}</p> : null}
              </section>
              {groups.map((group) => {
                const entries = diagnostics.filter((entry) => entry.kind === group.kind);
                if (entries.length === 0) return null;
                return (
                  <section key={group.kind} className="py-4 first:pt-0 last:pb-0" aria-label={group.label}>
                    <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-sky-100/45">{group.label}</p>
                    <div className="space-y-2">
                      {entries.map((entry) => (
                        <div key={`${entry.kind}-${entry.provider}-${entry.url}`} className="flex items-center gap-3 font-mono text-xs sm:text-sm">
                          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${entry.state === "ready" ? "bg-emerald-300" : "bg-amber-300"}`} />
                          <span className="min-w-0 flex-1 truncate font-medium text-sky-100/70">{entry.provider} · {entry.url}</span>
                          {entry.selected ? <span className="shrink-0 text-emerald-300">{copy.diagnostics.selected}</span> : null}
                          <span className="shrink-0 text-sky-100/60">{entry.latency !== undefined ? copy.diagnostics.latency(entry.latency) : copy.diagnostics.unavailable}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Home({ locale = "en" }: { locale?: HomeLocale }) {
  const copy = homeCopy[locale];
  const morphActivities = useMemo(() => shuffled(copy.activities), [copy.activities]);
  const [isAboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [isLanguageDialogOpen, setLanguageDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [isDiagnosticsDialogOpen, setDiagnosticsDialogOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.lang = copy.language;
    window.localStorage.setItem("zestsend_locale", locale);
  }, [copy.language, locale]);

  useEffect(() => {
    preloadIceServers();
  }, []);

  const handleLanguageSelect = useCallback(
    (nextLocale: HomeLocale) => {
      setLanguageDialogOpen(false);
      if (nextLocale === locale) return;
      void navigate({ to: nextLocale === "zh" ? "/zh" : "/en" });
    },
    [locale, navigate],
  );

  const handleRoomCodeComplete = useCallback(
    (roomId: string) => {
      void navigate({
        to: locale === "zh" ? "/zh/room/$roomId" : "/en/room/$roomId",
        params: { roomId },
      });
    },
    [locale, navigate],
  );

  return (
    <Layout title={copy.title}>
      <section className="relative min-h-screen w-full overflow-hidden" aria-labelledby="home-title">
        <h1 id="home-title" className="sr-only">{copy.heading}</h1>
        <div className="absolute inset-x-0 top-[calc(50%_-_26rem)] h-[400px] sm:top-[calc(50%_-_27rem)]" aria-hidden="true">
          <CursorDrivenParticleTypography
            text="ZestSend"
            particleDensity={2}
            particleSize={1}
            fontSize={180}
            fontFamily="Aptos Display, Segoe UI, sans-serif"
            color="#d9f4ff"
            className="h-full !min-h-0"
          />
        </div>
        <div className="absolute inset-x-0 top-[calc(50%_-_1rem)] flex min-h-[7.5rem] flex-col items-center justify-center px-3 text-center text-[clamp(0.72rem,4.2vw,3rem)] font-bold leading-[1.15] tracking-[0.02em] text-slate-100 sm:top-[calc(50%_-_7rem)] sm:px-6 sm:tracking-[0.08em]">
          {locale === "zh" ? (
            <>
              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap sm:gap-3">
                <TextRepel
                  text="端对端加密"
                  radius={160}
                  strength={70}
                  className="text-emerald-300"
                />
                <RiLock2Fill
                  aria-hidden="true"
                  className="size-[0.8em] shrink-0 self-center text-emerald-300"
                />
                <span>的</span>
              </div>
              <div className="mt-2 flex items-center justify-center gap-1.5 whitespace-nowrap text-sky-100 sm:gap-3">
                <span>{copy.prefix}</span>
                <ActivityTransition activities={morphActivities} />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap text-sky-100 sm:gap-3">
                <span>{copy.prefix}</span>
                <ActivityTransition activities={morphActivities} />
              </div>
              <div className="mt-2 flex items-center justify-center gap-1.5 whitespace-nowrap sm:gap-3">
                <span>with</span>
                <TextRepel
                  text="end-to-end encryption"
                  radius={160}
                  strength={70}
                  className="text-emerald-300"
                />
                <RiLock2Fill
                  aria-hidden="true"
                  className="size-[0.8em] shrink-0 self-center text-emerald-300"
                />
              </div>
            </>
          )}
          <ConnectionCodeInput
            length={4}
            hint={copy.codeHint}
            inputLabel={copy.codeInputLabel}
            links={copy.footerLinks}
            onAboutClick={() => setAboutDialogOpen(true)}
            onComplete={handleRoomCodeComplete}
            onLanguageClick={() => setLanguageDialogOpen(true)}
            onSettingsClick={() => setSettingsDialogOpen(true)}
          />
        </div>
        <LanguageDialog
          locale={locale}
          onOpenChange={setLanguageDialogOpen}
          onSelect={handleLanguageSelect}
          open={isLanguageDialogOpen}
        />
        <SettingsDialog
          locale={locale}
          onOpenChange={setSettingsDialogOpen}
          open={isSettingsDialogOpen}
        />
        <AboutDialog
          locale={locale}
          onDiagnosticsClick={() => {
            setAboutDialogOpen(false);
            setDiagnosticsDialogOpen(true);
          }}
          onOpenChange={setAboutDialogOpen}
          open={isAboutDialogOpen}
        />
        <DiagnosticsDialog
          locale={locale}
          onOpenChange={setDiagnosticsDialogOpen}
          open={isDiagnosticsDialogOpen}
        />
      </section>
    </Layout>
  );
}
