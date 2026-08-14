import CharacterCount from "@tiptap/extension-character-count";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiBold,
  RiCodeLine,
  RiCodeSSlashLine,
  RiDoubleQuotesL,
  RiH1,
  RiH2,
  RiItalic,
  RiLink,
  RiListCheck2,
  RiListOrdered,
  RiListUnordered,
  RiStrikethrough,
} from "@remixicon/react";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { P2PCollaborationProvider } from "../lib/p2p-collaboration";

type Locale = "en" | "zh";

type ToolButtonProps = {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

function ToolButton({ active = false, children, disabled = false, label, onClick }: ToolButtonProps) {
  return (
    <button
      aria-label={label}
      className={`zest-collaboration-tool ${active ? "zest-collaboration-tool-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function positionRemoteCaret(caret: HTMLElement) {
  const visual = caret.querySelector<HTMLElement>(".zest-collaboration-caret-visual");
  if (!visual) return;
  const rect = caret.getBoundingClientRect();
  visual.style.setProperty("--zest-collaboration-caret-x", `${rect.left}px`);
  visual.style.setProperty("--zest-collaboration-caret-y", `${rect.top}px`);
  if (visual.dataset.positioned !== "true") {
    visual.dataset.positioned = "true";
    window.requestAnimationFrame(() => {
      if (!visual.isConnected) return;
      visual.classList.add("zest-collaboration-caret-motion-ready", "zest-collaboration-caret-visible");
    });
    return;
  }
  visual.classList.add("zest-collaboration-caret-visible");
}

function CollaborationEditor({ accent, locale, onFeatureUsed, provider }: { accent: string; locale: Locale; onFeatureUsed: () => void; provider: P2PCollaborationProvider }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [version, setVersion] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const documentEditedRef = useRef(false);
  const user = useMemo(() => ({ color: "#67d5ff", name: "Peer" }), []);
  const reportDocumentEdited = () => {
    if (documentEditedRef.current) return;
    documentEditedRef.current = true;
    onFeatureUsed();
  };

  const tiptap = useEditor({
    editorProps: {
      attributes: {
        class: "zest-collaboration-editor",
        spellcheck: "true",
      },
      handleDOMEvents: {
        input: () => {
          reportDocumentEdited();
          return false;
        },
      },
    },
    extensions: [
      StarterKit.configure({
        link: false,
        undoRedo: false,
      }),
      Link.configure({
        HTMLAttributes: {
          class: "zest-collaboration-link",
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
        openOnClick: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: locale === "zh" ? "开始共同书写…" : "Start writing together…" }),
      CharacterCount,
      Collaboration.configure({ document: provider.document }),
      CollaborationCaret.configure({
        provider,
        render: () => {
          const caret = document.createElement("span");
          caret.className = "zest-collaboration-caret";
          const visual = document.createElement("span");
          visual.className = "zest-collaboration-caret-visual";
          visual.style.setProperty("--zest-collaboration-accent", accent);
          const label = document.createElement("span");
          label.className = "zest-collaboration-caret-label";
          label.textContent = locale === "zh" ? "对方" : "Peer";
          visual.append(label);
          caret.append(visual);
          return caret;
        },
        selectionRender: () => ({
          class: "zest-collaboration-selection",
          style: "background-color: color-mix(in srgb, var(--zest-collaboration-accent) 20%, transparent);",
        }),
        user,
      }),
    ],
    immediatelyRender: false,
    onCreate: ({ editor: createdEditor }) => setEditor(createdEditor),
  }, [accent, locale, provider, user]);

  useEffect(() => {
    if (!tiptap) return;
    const refresh = () => setVersion((current) => current + 1);
    tiptap.on("transaction", refresh);
    return () => {
      tiptap.off("transaction", refresh);
    };
  }, [tiptap]);

  useEffect(() => {
    if (!tiptap) return;
    const editorRoot = tiptap.view.dom;
    const exitLayer = document.createElement("div");
    exitLayer.className = "zest-collaboration-caret-exit-layer";
    document.body.append(exitLayer);
    const removedCarets = new Set<HTMLElement>();
    let frame = 0;

    const positionCarets = () => {
      frame = 0;
      for (const caret of removedCarets) {
        if (caret.isConnected) continue;
        const visual = caret.querySelector<HTMLElement>(".zest-collaboration-caret-visual");
        if (!visual?.classList.contains("zest-collaboration-caret-visible")) continue;
        const fadingVisual = visual.cloneNode(true) as HTMLElement;
        exitLayer.append(fadingVisual);
        window.requestAnimationFrame(() => fadingVisual.classList.remove("zest-collaboration-caret-visible"));
        window.setTimeout(() => fadingVisual.remove(), 220);
      }
      removedCarets.clear();

      for (const caret of editorRoot.querySelectorAll<HTMLElement>(".zest-collaboration-caret")) {
        positionRemoteCaret(caret);
      }
    };
    const schedulePosition = () => {
      if (!frame) frame = window.requestAnimationFrame(positionCarets);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches(".zest-collaboration-caret")) removedCarets.add(node);
          node.querySelectorAll<HTMLElement>(".zest-collaboration-caret").forEach((caret) => removedCarets.add(caret));
        }
      }
      schedulePosition();
    });
    const scrollContainer = editorRoot.closest(".zest-collaboration-page");
    observer.observe(editorRoot, { childList: true, subtree: true });
    scrollContainer?.addEventListener("scroll", schedulePosition, { passive: true });
    window.addEventListener("resize", schedulePosition);
    schedulePosition();

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      scrollContainer?.removeEventListener("scroll", schedulePosition);
      window.removeEventListener("resize", schedulePosition);
      exitLayer.remove();
    };
  }, [tiptap]);

  useEffect(() => {
    if (!tiptap) return;
    const frame = window.requestAnimationFrame(() => {
      for (const caret of tiptap.view.dom.querySelectorAll<HTMLElement>(".zest-collaboration-caret")) {
        positionRemoteCaret(caret);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tiptap, version]);

  const submitLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tiptap) return;
    const href = linkValue.trim();
    if (!href) tiptap.chain().focus().extendMarkRange("link").unsetLink().run();
    else tiptap.chain().focus().extendMarkRange("link").setLink({ href: /^https?:\/\//i.test(href) ? href : `https://${href}` }).run();
    reportDocumentEdited();
    setLinkOpen(false);
  };

  const command = (callback: (instance: Editor) => void) => () => {
    if (tiptap) {
      callback(tiptap);
      reportDocumentEdited();
    }
  };
  const characters = tiptap?.storage.characterCount?.characters() ?? 0;
  const words = tiptap?.storage.characterCount?.words() ?? 0;
  void version;

  return (
    <div className="zest-collaboration-shell" style={{ "--zest-collaboration-accent": accent } as CSSProperties}>
      <div className="zest-collaboration-toolbar">
        <div className="zest-collaboration-tools" role="toolbar" aria-label={locale === "zh" ? "协作文档工具栏" : "Collaborative document toolbar"}>
          <ToolButton disabled={!tiptap?.can().undo()} label={locale === "zh" ? "撤销" : "Undo"} onClick={command((instance) => instance.chain().focus().undo().run())}><RiArrowGoBackLine /></ToolButton>
          <ToolButton disabled={!tiptap?.can().redo()} label={locale === "zh" ? "重做" : "Redo"} onClick={command((instance) => instance.chain().focus().redo().run())}><RiArrowGoForwardLine /></ToolButton>
          <span className="zest-collaboration-divider" />
          <ToolButton active={tiptap?.isActive("heading", { level: 1 })} label={locale === "zh" ? "标题 1" : "Heading 1"} onClick={command((instance) => instance.chain().focus().toggleHeading({ level: 1 }).run())}><RiH1 /></ToolButton>
          <ToolButton active={tiptap?.isActive("heading", { level: 2 })} label={locale === "zh" ? "标题 2" : "Heading 2"} onClick={command((instance) => instance.chain().focus().toggleHeading({ level: 2 }).run())}><RiH2 /></ToolButton>
          <span className="zest-collaboration-divider" />
          <ToolButton active={tiptap?.isActive("bold")} label={locale === "zh" ? "加粗" : "Bold"} onClick={command((instance) => instance.chain().focus().toggleBold().run())}><RiBold /></ToolButton>
          <ToolButton active={tiptap?.isActive("italic")} label={locale === "zh" ? "斜体" : "Italic"} onClick={command((instance) => instance.chain().focus().toggleItalic().run())}><RiItalic /></ToolButton>
          <ToolButton active={tiptap?.isActive("strike")} label={locale === "zh" ? "删除线" : "Strike"} onClick={command((instance) => instance.chain().focus().toggleStrike().run())}><RiStrikethrough /></ToolButton>
          <ToolButton active={tiptap?.isActive("link")} label={locale === "zh" ? "链接" : "Link"} onClick={() => { setLinkValue(tiptap?.getAttributes("link").href ?? ""); setLinkOpen((current) => !current); }}><RiLink /></ToolButton>
          <span className="zest-collaboration-divider" />
          <ToolButton active={tiptap?.isActive("bulletList")} label={locale === "zh" ? "无序列表" : "Bullet list"} onClick={command((instance) => instance.chain().focus().toggleBulletList().run())}><RiListUnordered /></ToolButton>
          <ToolButton active={tiptap?.isActive("orderedList")} label={locale === "zh" ? "有序列表" : "Ordered list"} onClick={command((instance) => instance.chain().focus().toggleOrderedList().run())}><RiListOrdered /></ToolButton>
          <ToolButton active={tiptap?.isActive("taskList")} label={locale === "zh" ? "待办清单" : "Task list"} onClick={command((instance) => instance.chain().focus().toggleTaskList().run())}><RiListCheck2 /></ToolButton>
          <ToolButton active={tiptap?.isActive("blockquote")} label={locale === "zh" ? "引用" : "Quote"} onClick={command((instance) => instance.chain().focus().toggleBlockquote().run())}><RiDoubleQuotesL /></ToolButton>
          <ToolButton active={tiptap?.isActive("codeBlock")} label={locale === "zh" ? "代码块" : "Code block"} onClick={command((instance) => instance.chain().focus().toggleCodeBlock().run())}><RiCodeSSlashLine /></ToolButton>
          <ToolButton active={tiptap?.isActive("code")} label={locale === "zh" ? "行内代码" : "Inline code"} onClick={command((instance) => instance.chain().focus().toggleCode().run())}><RiCodeLine /></ToolButton>
        </div>
        {linkOpen ? (
          <form className="zest-collaboration-link-popover" onSubmit={submitLink}>
            <input autoFocus onChange={(event) => setLinkValue(event.target.value)} placeholder="https://" value={linkValue} />
            <button type="submit">{locale === "zh" ? "应用" : "Apply"}</button>
          </form>
        ) : null}
      </div>
      <div className="zest-collaboration-page">
        <EditorContent editor={tiptap} />
      </div>
      <footer className="zest-collaboration-footer">
        <span>{locale === "zh" ? `${words} 词 · ${characters} 字符` : `${words} words · ${characters} characters`}</span>
      </footer>
    </div>
  );
}

export function CollaborationWorkspace({ accent, locale, onFeatureUsed, provider }: { accent: string; locale: Locale; onFeatureUsed: () => void; provider: P2PCollaborationProvider | null }) {
  if (!provider) {
    return <div className="flex size-full items-center justify-center text-sm font-medium tracking-[0.05em] text-sky-100/55">{locale === "zh" ? "正在准备协作文档…" : "Preparing collaborative document…"}</div>;
  }
  return <CollaborationEditor accent={accent} key={provider.document.clientID} locale={locale} onFeatureUsed={onFeatureUsed} provider={provider} />;
}
