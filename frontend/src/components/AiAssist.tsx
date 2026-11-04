"use client";

import { useState } from "react";
import { aiRoute, useAi } from "@/lib/ai";
import type { Action, ProductDetail } from "@/lib/api";
import { askAboutAction, draftSupplierMessage, FALLBACK, type Lang, QUESTIONS } from "@/lib/assist";
import { ModelError } from "@/lib/model";
import { ArrowUpIcon } from "./icons";

interface QA { q: string; a: string | null; error?: boolean }

/** Flat paper section shared by the detail sheet (no shadow: it does not float). */
export const CARD = "rounded-[12px] border border-[var(--border)] bg-paper shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
const PRIMARY = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-ink px-4 text-[15px] font-medium text-white transition-colors hover:bg-[#27272a]";
const SECONDARY = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] bg-paper px-4 text-[15px] font-medium text-ink transition-colors hover:bg-[#fafafa]";

const HEADING = "mb-2 px-1 text-[15px] font-semibold leading-[20px]";
const SEG = (on: boolean) =>
  `min-h-[38px] max-md:min-h-[44px] whitespace-nowrap rounded-[8px] px-3 text-[14px] font-medium transition-colors ${on ? "bg-paper text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08),0_1px_3px_rgba(16,24,40,0.06)]" : "text-muted hover:text-ink"}`;

const errorText = (e: unknown) => (e instanceof ModelError ? e.message : FALLBACK);

/** "Ask" about one action: chips, a text field and a short answer history kept per action. */
export function AskSection({ action, product }: { action: Action; product?: ProductDetail }) {
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
      push({ q, a: await askAboutAction(aiRoute(), action, product, q) });
    } catch (e) {
      push({ q, a: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  // No AI on this device (or its status is still loading): leave the section out, never ask for a key.
  if (!hasKey) return null;

  return (
    <section aria-label="Ask about this">
      <h3 className={HEADING}>Ask</h3>
        <div className={`${CARD} p-4`}>
          {items.length === 0 && (
            <p className="t-subhead mb-3 text-muted">Ask anything about this item. Answers use only the store data.</p>
          )}
          {items.length > 0 && (
            <ol className="mb-4 space-y-3" aria-label="Answers">
              {items.map((it, i) => (
                <li key={i} className="space-y-1.5">
                  <div className="flex justify-end">
                    <p className="t-subhead max-w-[85%] rounded-[12px] rounded-br-[4px] bg-[#f4f4f5] px-3 py-2 text-ink">{it.q}</p>
                  </div>
                  <div className="flex">
                    {it.a === null ? (
                      <p className="t-subhead animate-pulse rounded-[12px] px-0 py-2 text-muted" role="status">
                        Thinking…
                      </p>
                    ) : (
                      <p
                        className={`t-subhead max-w-[90%] px-0 py-1 ${it.error ? "text-muted" : "text-label"}`}
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
                className="min-h-[44px] rounded-full border border-[var(--border)] bg-paper px-4 text-left text-[14px] font-medium text-ink hover:bg-[#fafafa] active:bg-[#f4f4f5] disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-paper py-1 pl-3 pr-1 transition-shadow focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgba(24,24,27,0.12)]"
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
              className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--text-3)]"
            />
            <button
              disabled={busy || !text.trim()}
              className="flex min-h-[44px] items-center gap-1 rounded-[8px] bg-ink px-3.5 text-[15px] font-medium text-white transition-colors disabled:bg-[#f4f4f5] disabled:text-[var(--text-3)]"
            >
              Ask
              <ArrowUpIcon size={12} />
            </button>
          </form>
        </div>
    </section>
  );
}

/** A message to the supplier for ORDER and CHECK_DELIVERY actions. Never sent from here. */
export function SupplierDraft({ action }: { action: Action }) {
  const { hasKey } = useAi();
  const [lang, setLang] = useState<Lang>("uk");
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string } | string>>({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const k = `${action.id}:${lang}:${action.proposal.order_qty ?? ""}`;
  const draft = drafts[k];

  const write = async () => {
    setBusy(true);
    setCopied(false);
    try {
      const d = await draftSupplierMessage(aiRoute(), action, lang);
      setDrafts((m) => ({ ...m, [k]: d ?? "The draft used numbers that are not in the store data, so it was not shown. Try again." }));
    } catch (e) {
      setDrafts((m) => ({ ...m, [k]: errorText(e) }));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (typeof draft !== "object") return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const supplier = action.proposal.supplier ?? action.facts.supplier;
  // No AI on this device (or its status is still loading): leave the section out, never ask for a key.
  if (!hasKey) return null;

  return (
    <section aria-label="Draft message to supplier">
      <h3 className={HEADING}>Message to supplier</h3>
        <div className={`${CARD} p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Language" className="flex rounded-[10px] bg-[#f4f4f5] p-[3px]">
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
              className={`${typeof draft === "object" ? SECONDARY : PRIMARY} ml-auto disabled:opacity-50`}
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
            <p role="status" className="t-subhead mt-3 animate-pulse rounded-[10px] border border-[var(--divider)] bg-[#fafafa] p-4 text-muted">
              Writing the message…
            </p>
          )}
          {typeof draft === "string" && (
            <p className="t-subhead mt-3 rounded-[10px] border border-[var(--divider)] bg-[#fafafa] p-4 text-muted" role="alert">
              {draft}
            </p>
          )}
          {typeof draft === "object" && (
            <>
              <div className="mt-3 rounded-[10px] border border-[var(--divider)] bg-[#fafafa] p-4" data-testid="supplier-draft" lang={lang}>
                <div className="t-footnote text-muted">Subject</div>
                <div className="t-subhead font-semibold">{draft.subject}</div>
                <div className="my-3 h-px bg-separator" />
                <p className="t-subhead whitespace-pre-line">{draft.body}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className={PRIMARY}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                  className={SECONDARY}
                >
                  Open in Mail
                </a>
                <span className="t-footnote ml-auto text-muted">Not sent automatically</span>
              </div>
            </>
          )}
        </div>
    </section>
  );
}
