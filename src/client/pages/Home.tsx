import {
  RiCastFill,
  RiFileFill,
  RiGithubFill,
  RiGlobalLine,
  RiInformationLine,
  RiLock2Fill,
  RiMessage3Fill,
  RiPhoneFill,
  RiSettings3Line,
  RiVideoOnFill,
} from "@remixicon/react";
import { Check } from "lucide-react";
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
import { CursorDrivenParticleTypography } from "../components/ui/cursor-driven-particle-typography";
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
import { TextMorph } from "../components/ui/text-morph";
import { TextRepel } from "../components/ui/text-repel";

type HomeLocale = "en" | "zh";
type ActivityIcon = "file" | "message" | "screen" | "video" | "voice";
type Activity = { word: string; icon: ActivityIcon };

const activityIcons = {
  file: RiFileFill,
  message: RiMessage3Fill,
  screen: RiCastFill,
  video: RiVideoOnFill,
  voice: RiPhoneFill,
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
    activities: [
      { word: "share files", icon: "file" },
      { word: "send files", icon: "file" },
      { word: "receive files", icon: "file" },
      { word: "share messages", icon: "message" },
      { word: "send messages", icon: "message" },
      { word: "receive messages", icon: "message" },
      { word: "share your screen", icon: "screen" },
      { word: "send a screen share", icon: "screen" },
      { word: "receive a screen share", icon: "screen" },
      { word: "make a video call", icon: "video" },
      { word: "receive a video call", icon: "video" },
      { word: "make a voice call", icon: "voice" },
      { word: "receive a voice call", icon: "voice" },
    ],
  },
  zh: {
    title: "ZestSend — 私密 P2P 文件传输",
    heading: "ZestSend — 私密 P2P 文件传输",
    language: "zh-CN",
    prefix: "匿名",
    codeInputLabel: "连接数字第",
    codeHint: "与其他人输入任意四位相同数字来连接。",
    footerLinks: ["语言", "设置", "关于"],
    languageDialog: {
      close: "关闭语言选择",
      description: "选择 ZestSend 首页使用的语言。",
      title: "语言",
    },
    activities: [
      { word: "共享文件", icon: "file" },
      { word: "发送文件", icon: "file" },
      { word: "接收文件", icon: "file" },
      { word: "共享消息", icon: "message" },
      { word: "发送消息", icon: "message" },
      { word: "接收消息", icon: "message" },
      { word: "共享屏幕", icon: "screen" },
      { word: "发送屏幕共享", icon: "screen" },
      { word: "接收屏幕共享", icon: "screen" },
      { word: "发起视频通话", icon: "video" },
      { word: "接收视频通话", icon: "video" },
      { word: "发起语音通话", icon: "voice" },
      { word: "接收语音通话", icon: "voice" },
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

function ActivityIcon({ icon }: { icon: ActivityIcon }) {
  const Icon = activityIcons[icon];

  return (
    <AutoTransition
      as="span"
      aria-hidden="true"
      className="inline-flex shrink-0 self-center"
      duration={0.34}
      type="fade"
      transitionKey={icon}
    >
      <Icon className="size-[0.9em]" />
    </AutoTransition>
  );
}

function ConnectionCodeInput({
  length,
  inputLabel,
  hint,
  links,
  onLanguageClick,
}: {
  length: number;
  inputLabel: string;
  hint: string;
  links: readonly string[];
  onLanguageClick: () => void;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [code, setCode] = useState(() => Array.from({ length }, () => ""));
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const focusAt = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      const input = inputRefs.current[index];
      input?.focus();
    });
  }, []);

  useEffect(() => {
    focusAt(0);
  }, [focusAt]);

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
      <FooterLinks links={links} onLanguageClick={onLanguageClick} />
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

function FooterLinks({ links, onLanguageClick }: { links: readonly string[]; onLanguageClick: () => void }) {
  const icons = [RiGlobalLine, RiSettings3Line, RiInformationLine];

  return (
    <nav aria-label="Footer navigation" className="mt-7 flex justify-center sm:mt-8">
      <div className="flex items-center gap-5 text-[clamp(0.7rem,1.6vw,0.95rem)] font-semibold text-sky-100/75 sm:gap-7">
        {links.map((link, index) => (
          <Clickable
            key={link}
            aria-label={link}
            className="size-7 text-inherit sm:size-8"
            onClick={index === 0 ? onLanguageClick : undefined}
            title={link}
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
  const options: Array<{ description: string; locale: HomeLocale; name: string }> = [
    {
      locale: "zh",
      name: "简体中文",
      description: locale === "zh" ? "使用简体中文浏览 ZestSend" : "Use Simplified Chinese",
    },
    {
      locale: "en",
      name: "English",
      description: locale === "zh" ? "使用 English 浏览 ZestSend" : "Use English to browse ZestSend",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="language-dialog-description"
        aria-labelledby="language-dialog-title"
        className="min-h-[26rem]"
      >
        <DialogHeader>
          <div>
            <DialogTitle id="language-dialog-title">{copy.title}</DialogTitle>
            <DialogDescription id="language-dialog-description">{copy.description}</DialogDescription>
          </div>
          <DialogClose aria-label={copy.close} data-dialog-autofocus title={copy.close} />
        </DialogHeader>
        <div className="grid gap-3 p-6 sm:grid-cols-2 sm:gap-4 sm:p-9">
          {options.map((option) => {
            const selected = option.locale === locale;

            return (
              <button
                key={option.locale}
                aria-pressed={selected}
                className={`flex min-h-36 flex-col items-start justify-between rounded-md border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-100/60 sm:p-6 ${
                  selected
                    ? "border-emerald-300/55 bg-emerald-300/10 text-emerald-100"
                    : "border-sky-100/12 bg-sky-100/[0.03] text-sky-50 hover:border-sky-100/35 hover:bg-sky-100/[0.07]"
                }`}
                onClick={() => onSelect(option.locale)}
                type="button"
              >
                <span className="text-xl font-bold tracking-[0.04em]">{option.name}</span>
                <span className="flex w-full items-end justify-between gap-4 text-sm font-medium tracking-[0.04em] text-sky-100/60">
                  {option.description}
                  {selected ? <Check aria-label="Selected" className="size-5 shrink-0 text-emerald-300" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Home({ locale = "en" }: { locale?: HomeLocale }) {
  const copy = homeCopy[locale];
  const morphActivities = useMemo(() => shuffled(copy.activities), [copy.activities]);
  const morphWords = useMemo(
    () => morphActivities.map((activity) => activity.word),
    [morphActivities],
  );
  const prefixWords = useMemo(() => [copy.prefix], [copy.prefix]);
  const [activeActivity, setActiveActivity] = useState(morphActivities[0]!);
  const [isLanguageDialogOpen, setLanguageDialogOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setActiveActivity(morphActivities[0]!);
  }, [morphActivities]);

  const handleActivityChange = useCallback(
    (word: string) => {
      const activity = morphActivities.find((candidate) => candidate.word === word);
      if (activity) setActiveActivity(activity);
    },
    [morphActivities],
  );

  useEffect(() => {
    document.documentElement.lang = copy.language;
  }, [copy.language]);

  const handleLanguageSelect = useCallback(
    (nextLocale: HomeLocale) => {
      setLanguageDialogOpen(false);
      if (nextLocale === locale) return;
      void navigate({ to: nextLocale === "zh" ? "/zh" : "/en" });
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
        <div className="absolute inset-x-0 top-[calc(50%_-_1rem)] flex min-h-[7.5rem] flex-col items-center justify-center px-3 text-center text-[clamp(0.72rem,4.2vw,3rem)] font-bold leading-[1.15] tracking-[0.02em] text-slate-100 [text-shadow:0_2px_26px_rgba(2,6,23,0.9)] sm:top-[calc(50%_-_7rem)] sm:px-6 sm:tracking-[0.08em]">
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
              <p className="mt-2 inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sky-100 sm:gap-3">
                <TextMorph words={prefixWords} interval={2400} morphDuration={680} className="leading-[1.15]" />
                <TextMorph
                  words={morphWords}
                  interval={2400}
                  morphDuration={680}
                  className="leading-[1.15]"
                  onMorphStart={handleActivityChange}
                />
                <ActivityIcon icon={activeActivity.icon} />
              </p>
            </>
          ) : (
            <>
              <p className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sky-100 sm:gap-3">
                <TextMorph words={prefixWords} interval={2400} morphDuration={680} className="leading-[1.15]" />
                <TextMorph
                  words={morphWords}
                  interval={2400}
                  morphDuration={680}
                  className="leading-[1.15]"
                  onMorphStart={handleActivityChange}
                />
                <ActivityIcon icon={activeActivity.icon} />
              </p>
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
            onLanguageClick={() => setLanguageDialogOpen(true)}
          />
        </div>
        <LanguageDialog
          locale={locale}
          onOpenChange={setLanguageDialogOpen}
          onSelect={handleLanguageSelect}
          open={isLanguageDialogOpen}
        />
      </section>
    </Layout>
  );
}
