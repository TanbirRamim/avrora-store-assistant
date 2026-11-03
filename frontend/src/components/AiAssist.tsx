"use client";

import { useState } from "react";
import { savedKey, useAi } from "@/lib/ai";
import type { Action, ProductDetail } from "@/lib/api";
import { askAboutAction, draftSupplierMessage, FALLBACK, type Lang, QUESTIONS } from "@/lib/assist";
import { ModelError } from "@/lib/ollama";
import { SparkleIcon } from "./icons";

interface QA { q: string; a: string | null; error?: boolean }

const errorText = (e: unknown) => (e instanceof ModelError ? e.message : FALLBACK);

function NoKey({ onAddKey }: { onAddKey?: () => void }) {
  return (
    <div className="group-list flex items-start gap-3 px-4 py-3">
      <SparkleIcon size={18} className="mt-[1px] shrink-0 text-tint" />
      <p className="t-subhead text-label-2">
        Add your Open WebUI key to ask questions and draft messages.{" "}
        {onAddKey ? (
          <button type="button" onClick={onAddKey} className="font-medium text-tint">Add key</button>
        ) : (
          <>Use <span className="font-medium text-label">Write with AI</span> on the Today screen.</>
        )}
      </p>
    </div>
  );
}

/** "Ask" about one action: chips, a text field and a short answer history kept per action. */
export function AskSection({ action, product, onAddKey }: { action: Action; product?: ProductDetail; onAddKey?: () => void }) {
  const { hasKey } = useAi();
  const [log, setLog] = useState<Record<string, QA[]>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const items = log[action.id] ?? [];

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    const id = action.id;
    const push = (qa: QA) => setLog((l) => ({ ...l, [id]: [...(l[id] ?? []).filter((x) => x.a !== null || x.q !== q), qa].slice(-4) }));
    push({ q, a: null });
    setText("");
    setBusy(true);
    try {
      push({ q, a: await askAboutAction(savedKey(), action, product, q) });
    } catch (e) {
      push({ q, a: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Ask about this">
      <h3 className="group-header">Ask</h3>
      {!hasKey ? (
        <NoKey onAddKey={onAddKey} />
      ) : (
        <div className="group-list">
          {items.map((it, i) => (
            <div key={i} className="cell px-4 py-3">
              <div className="t-subhead font-semibold">{it.q}</div>
              {it.a === null ? (
                <p className="t-subhead mt-1 animate-pulse text-label-2" role="status">Thinking…</p>
              ) : (
                <p className={`t-subhead mt-1 ${it.error ? "text-label-2" : ""}`} data-testid="ask-answer">{it.a}</p>
              )}
            </div>
          ))}
          <div className="cell flex flex-wrap gap-2 px-4 pb-1 pt-3">
            {QUESTIONS[action.type].map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => ask(q)}
                className="rounded-full bg-fill px-3 py-1.5 text-[13px] font-medium text-tint hover:bg-fill-2 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2 px-4 pb-3 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask about this item"
              aria-label="Question about this item"
              maxLength={200}
              className="t-body min-w-0 flex-1 rounded-[10px] bg-fill px-3 py-2 outline-none placeholder:text-label-3"
            />
            <button disabled={busy || !text.trim()} className="text-[15px] font-semibold text-tint disabled:text-label-3">
              Ask
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

/** A message to the supplier for ORDER and CHECK_DELIVERY actions. Never sent from here. */
export function SupplierDraft({ action, onAddKey }: { action: Action; onAddKey?: () => void }) {
  const { hasKey } = useAi();
  const [lang, setLang] = useState<Lang>("uk");
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string } | string>>({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const k = `${action.id}:${lang}`;
  const draft = drafts[k];

  const write = async () => {
    setBusy(true);
    setCopied(false);
    try {
      const d = await draftSupplierMessage(savedKey(), action, lang);
      setDrafts((m) => ({ ...m, [k]: d ?? "The draft used numbers that are not in the store data, so it was not shown. Try again." }));
    } catch (e) {
      setDrafts((m) => ({ ...m, [k]: errorText(e) }));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (typeof draft !== "object") return;
    await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
    setCopied(true);
  };

  return (
    <section aria-label="Draft message to supplier">
      <h3 className="group-header">Message to supplier</h3>
      {!hasKey ? (
        <NoKey onAddKey={onAddKey} />
      ) : (
        <div className="group-list">
          <div className="cell flex items-center gap-3 px-4 py-3">
            <div role="radiogroup" aria-label="Language" className="flex rounded-[9px] bg-fill p-[2px]">
              {(["uk", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={lang === l}
                  onClick={() => {
                    setLang(l);
                    setCopied(false);
                  }}
                  className={`rounded-[7px] px-3 py-1 text-[13px] font-medium ${lang === l ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-label-2"}`}
                >
                  {l === "uk" ? "Українська" : "English"}
                </button>
              ))}
            </div>
            <button type="button" disabled={busy} onClick={write} className="ml-auto text-[15px] font-semibold text-tint disabled:text-label-3">
              {busy ? "Writing…" : draft ? "Rewrite" : "Write draft"}
            </button>
          </div>
          {busy && !draft && <p role="status" className="cell t-subhead animate-pulse px-4 py-3 text-label-2">Writing the message…</p>}
          {typeof draft === "string" && <p className="cell t-subhead px-4 py-3 text-label-2" role="alert">{draft}</p>}
          {typeof draft === "object" && (
            <>
              <div className="cell px-4 py-3" data-testid="supplier-draft" lang={lang}>
                <div className="t-subhead font-semibold">{draft.subject}</div>
                <p className="t-subhead mt-1 whitespace-pre-line">{draft.body}</p>
              </div>
              <div className="cell flex items-center gap-5 px-4 py-[11px]">
                <button type="button" onClick={copy} className="text-[15px] font-semibold text-tint">
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                  className="text-[15px] font-semibold text-tint"
                >
                  Open in Mail
                </a>
                <span className="t-footnote ml-auto text-label-2">Not sent automatically</span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
