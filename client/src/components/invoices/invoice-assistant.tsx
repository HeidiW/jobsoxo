// Chat panel for the invoice builder. The conversation lives here in the
// browser (the API is stateless); every message carries the live invoice so
// the assistant can see what's on it. Proposed changes arrive as cards the
// person applies or dismisses — the assistant never edits the invoice itself.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Send, Sparkles, X } from "lucide-react";
import type { AssistantHistory, InvoiceProposal, InvoiceSnapshot } from "@shared/invoice-assistant";
import { invoiceProposalSchema } from "@shared/invoice-assistant";

type ProposalCard = { id: string; proposal: InvoiceProposal; status: "pending" | "applied" | "dismissed" };
type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; proposalIds: string[] };

interface InvoiceAssistantPanelProps {
  open: boolean;
  onClose: () => void;
  snapshot: InvoiceSnapshot;
  onApply: (proposal: InvoiceProposal) => void;
}

const STARTERS = [
  "What's missing from this invoice?",
  "Tighten up my line item descriptions",
  "Suggest payment terms for this job",
];

const money = (n: number) => `$${n.toFixed(2)}`;

export function InvoiceAssistantPanel({ open, onClose, snapshot, onApply }: InvoiceAssistantPanelProps) {
  const [history, setHistory] = useState<AssistantHistory>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposals, setProposals] = useState<Record<string, ProposalCard>>({});
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const statusQuery = useQuery<{ available: boolean }>({
    queryKey: ["/api/invoices/assistant/status"],
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const available = statusQuery.data?.available ?? true;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  const busy = streaming !== null;

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setDraft("");

    // Every proposal from the previous reply needs an answer before the next
    // message, so the assistant knows what the person did with it.
    const lastAssistant = history[history.length - 1];
    const toolResults = lastAssistant?.role === "assistant"
      ? lastAssistant.content.filter((block) => block.type === "tool_use").map((block) => {
        const status = proposalsRef.current[block.id]?.status ?? "pending";
        const content = status === "applied" ? "The person applied this proposal to the invoice."
          : status === "dismissed" ? "The person dismissed this proposal."
          : "The person hasn't applied this proposal yet.";
        return { type: "tool_result" as const, tool_use_id: block.id, content };
      })
      : [];
    const userMessage = { role: "user" as const, content: [...toolResults, { type: "text" as const, text: trimmed }] };
    const nextHistory: AssistantHistory = [...history, userMessage];
    setHistory(nextHistory);
    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setStreaming("");

    let replyText = "";
    const proposalIds: string[] = [];
    try {
      const res = await fetch("/api/invoices/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messages: nextHistory, invoice: snapshotRef.current }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "The assistant isn't available right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "text") {
            replyText += event.text;
            setStreaming(replyText);
          } else if (event.type === "proposal") {
            const parsed = invoiceProposalSchema.safeParse(event.input);
            if (!parsed.success) continue;
            proposalIds.push(event.id);
            setProposals((prev) => ({ ...prev, [event.id]: { id: event.id, proposal: parsed.data, status: "pending" } }));
          } else if (event.type === "error") {
            throw new Error(event.message);
          } else if (event.type === "done") {
            finished = true;
            setHistory([...nextHistory, { role: "assistant", content: event.content }]);
          }
        }
      }
      if (!finished) throw new Error("The assistant's reply was cut off. Try again.");
      setTurns((prev) => [...prev, { role: "assistant", text: replyText, proposalIds }]);
    } catch (err) {
      // Put things back so the person can simply try again.
      setHistory(history);
      setTurns((prev) => prev.slice(0, -1));
      setDraft(trimmed);
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setStreaming(null);
    }
  }

  function apply(card: ProposalCard) {
    onApply(card.proposal);
    setProposals((prev) => ({ ...prev, [card.id]: { ...card, status: "applied" } }));
  }
  function dismiss(card: ProposalCard) {
    setProposals((prev) => ({ ...prev, [card.id]: { ...card, status: "dismissed" } }));
  }

  if (!open) return null;

  return (
    <aside className="invoice-assistant" role="dialog" aria-label="Invoice assistant" data-testid="invoice-assistant">
      <header className="invoice-assistant-header">
        <Sparkles aria-hidden="true" size={16} />
        <h2>Invoice assistant</h2>
        <button type="button" onClick={onClose} aria-label="Close assistant" data-testid="button-close-assistant"><X size={16} aria-hidden="true" /></button>
      </header>

      {!available ? (
        <p className="invoice-assistant-note" data-testid="assistant-unavailable">
          The assistant isn't set up on this server yet. An admin needs to connect JobsOxo to Claude.
        </p>
      ) : (
        <>
          <div className="invoice-assistant-messages" ref={scrollRef} aria-live="polite">
            {turns.length === 0 && (
              <div className="invoice-assistant-intro">
                <p>Ask anything about this invoice — what to include, how to word a line item, what to charge for. I can see what you've entered so far and can suggest changes for you to approve.</p>
                <div className="invoice-assistant-starters">
                  {STARTERS.map((starter) => (
                    <button key={starter} type="button" onClick={() => send(starter)} data-testid="assistant-starter">{starter}</button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={i} className={`invoice-assistant-turn is-${turn.role}`} data-testid={`assistant-turn-${turn.role}`}>
                {turn.text && <p>{turn.text}</p>}
                {turn.role === "assistant" && turn.proposalIds.map((id) => proposals[id] && (
                  <ProposalCardView key={id} card={proposals[id]} onApply={() => apply(proposals[id])} onDismiss={() => dismiss(proposals[id])} />
                ))}
              </div>
            ))}
            {streaming !== null && (
              <div className="invoice-assistant-turn is-assistant" data-testid="assistant-turn-streaming">
                {streaming ? <p>{streaming}</p> : <p className="invoice-assistant-thinking"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Thinking…</p>}
              </div>
            )}
            {error && <p className="invoice-assistant-error" role="alert" data-testid="assistant-error">{error}</p>}
          </div>

          <form
            className="invoice-assistant-compose"
            onSubmit={(e) => { e.preventDefault(); void send(draft); }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
              placeholder="Ask about this invoice…"
              rows={2}
              disabled={busy}
              data-testid="input-assistant-message"
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" data-testid="button-assistant-send">
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </aside>
  );
}

function ProposalCardView({ card, onApply, onDismiss }: { card: ProposalCard; onApply: () => void; onDismiss: () => void }) {
  const { proposal, status } = card;
  const changes: string[] = [];
  if (proposal.dueDate) changes.push(`Due date → ${proposal.dueDate}`);
  if (proposal.taxRate !== null) changes.push(`Tax rate → ${proposal.taxRate}%`);
  if (proposal.notes !== null) changes.push(`Scope of work → “${proposal.notes}”`);
  if (proposal.termsAndConditions !== null) changes.push(`Terms → “${proposal.termsAndConditions}”`);
  return (
    <div className={`invoice-assistant-proposal is-${status}`} data-testid={`assistant-proposal-${card.id}`}>
      <p className="invoice-assistant-proposal-summary">{proposal.summary}</p>
      {proposal.lineItems && proposal.lineItems.length > 0 && (
        <ul>
          {proposal.lineItems.map((item, i) => (
            <li key={i}>
              <span>{item.section ? `${item.section}: ` : ""}{item.description}</span>
              <span className="invoice-assistant-proposal-amount">{item.quantity} {item.unit} × {money(item.rate)} = {money(item.quantity * item.rate)}</span>
            </li>
          ))}
        </ul>
      )}
      {changes.length > 0 && <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul>}
      {status === "pending" ? (
        <div className="invoice-assistant-proposal-actions">
          <button type="button" onClick={onApply} className="is-primary" data-testid={`button-apply-${card.id}`}><Check size={14} aria-hidden="true" /> Add to invoice</button>
          <button type="button" onClick={onDismiss} data-testid={`button-dismiss-${card.id}`}>Dismiss</button>
        </div>
      ) : (
        <p className="invoice-assistant-proposal-status">{status === "applied" ? "Added to the invoice" : "Dismissed"}</p>
      )}
    </div>
  );
}
