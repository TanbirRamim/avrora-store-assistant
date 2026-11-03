"use client";

import { useState } from "react";
import { savedKey, useAi } from "@/lib/ai";
import type { Action, ProductDetail } from "@/lib/api";
import { askAboutAction, draftSupplierMessage, FALLBACK, type Lang, QUESTIONS } from "@/lib/assist";
import { ModelError } from "@/lib/ollama";
import { ArrowUpIcon, SparkleIcon } from "./icons";

interface QA { q: string; a: string | null; error?: boolean }

/** Flat paper section shared by the detail sheet (no shadow: it does not float). */
export const CARD = "rounded-[14px] bg-paper";

const HEADING = "t-headline mb-2 px-1";
const SEG = (on: boolean) =>
  `min-h-[44px] whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-colors ${on ? "bg-ink text-white" : "text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]"}`;

const errorText = (e: unknown) => (e instanceof ModelError ? e.message : FALLBACK);

function NoKey({ onAddKey }: { onAddKey?: () => void }) {
  return (
    <div className={`${CARD} flex items-start gap-3 p-4`}>
      <span className="mt-0.5 shrink-0 text-ink">
        <SparkleIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="t-subhead text-muted">
          Add your Open WebUI key to ask questions and draft messages.
          {!onAddKey && (
            <>
              {" "}Use <span className="font-medium text-label">Write with AI</span> on the Today screen.
            </>
          )}
        </p>
        {onAddKey && (
          <button
            type="button"
            onClick={onAddKey}
            className="btn-ink mt-3 min-h-[44px] px-5 text-[15px]"
          >
            Add key
          </button>
        )}
      </div>
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
      <h3 className={HEADING}>Ask</h3>
      {!hasKey ? (
        <NoKey onAddKey={onAddKey} />
      ) : (
        <div className={`${CARD} p-4`}>
          {items.length === 0 && (
            <p className="t-subhead mb-3 text-muted">Ask anything about this item. Answers use only the store data.</p>
          )}
          {items.length > 0 && (
            <ol className="mb-4 space-y-3" aria-label="Answers">
              {items.map((it, i) => (
                <li key={i} className="space-y-1.5">
                  <div className="flex justify-end">
                    <p className="t-subhead max-w-[85%] rounded-[18px] rounded-br-[6px] bg-ink px-3.5 py-2 text-white">{it.q}</p>
                  </div>
                  <div className="flex">
                    {it.a === null ? (
                      <p className="t-subhead animate-pulse rounded-[18px] rounded-bl-[6px] bg-fill px-3.5 py-2 text-muted" role="status">
                        Thinking…
                      </p>
                    ) : (
                      <p
                        className={`t-subhead max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-floor px-3.5 py-2 ${it.error ? "text-muted" : "text-label"}`}
                        data-testid="ask-answer"
                      >
                        {it.a}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            {QUESTIONS[action.type].map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => ask(q)}
                className="t-subhead min-h-[44px] rounded-full px-4 text-left font-medium text-ink shadow-[inset_0_0_0_1.5px_var(--ink)] hover:bg-fill active:bg-fill-2 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex items-center gap-1.5 rounded-full bg-floor py-1 pl-4 pr-1"
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
              className="t-body min-h-[44px] min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            />
            <button
              disabled={busy || !text.trim()}
              className="flex min-h-[44px] items-center gap-1 rounded-full bg-ink px-4 text-[15px] font-semibold text-white transition-opacity disabled:bg-fill-2 disabled:text-muted"
            >
              Ask
              <ArrowUpIcon size={12} />
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

  const supplier = action.proposal.supplier ?? action.facts.supplier;

  return (
    <section aria-label="Draft message to supplier">
      <h3 className={HEADING}>Message to supplier</h3>
      {!hasKey ? (
        <NoKey onAddKey={onAddKey} />
      ) : (
        <div className={`${CARD} p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Language" className="flex gap-1.5">
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
                  className={SEG(lang === l)}
                >
                  {l === "uk" ? "Українська" : "English"}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={write}
              className={`${typeof draft === "object" ? "btn-ghost" : "btn-ink"} ml-auto min-h-[44px] px-5 text-[15px] disabled:opacity-50`}
            >
              {busy ? "Writing…" : draft ? "Rewrite" : "Write draft"}
            </button>
          </div>

          {!draft && !busy && (
            <p className="t-subhead mt-3 text-muted">
              A short, polite message{supplier ? ` to ${supplier}` : ""}. You review it and send it yourself.
            </p>
          )}
          {busy && !draft && (
            <p role="status" className="t-subhead mt-3 animate-pulse rounded-[12px] bg-floor p-4 text-muted">
              Writing the message…
            </p>
          )}
          {typeof draft === "string" && (
            <p className="t-subhead mt-3 rounded-[12px] bg-floor p-4 text-muted" role="alert">
              {draft}
            </p>
          )}
          {typeof draft === "object" && (
            <>
              <div className="mt-3 rounded-[12px] bg-floor p-4" data-testid="supplier-draft" lang={lang}>
                <div className="t-footnote text-muted">Subject</div>
                <div className="t-subhead font-semibold">{draft.subject}</div>
                <div className="my-3 h-px bg-separator" />
                <p className="t-subhead whitespace-pre-line">{draft.body}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="btn-ink min-h-[44px] px-5 text-[15px]"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                  className="btn-ghost min-h-[44px] px-5 text-[15px]"
                >
                  Open in Mail
                </a>
                <span className="t-footnote ml-auto text-muted">Not sent automatically</span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
