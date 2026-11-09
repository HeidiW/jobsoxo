// "Fix before sending": the list of wording problems the proofreader found.
// Every issue has to be fixed or deliberately kept before the invoice goes
// out, so a real word the checker misread can never trap anyone.
import { Check, SpellCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProofreadField, ProofreadIssue } from "@shared/invoice-proofread";

export type ProofreadDecision = "fixed" | "kept";

interface ProofreadDialogProps {
  open: boolean;
  fields: ProofreadField[];
  issues: ProofreadIssue[];
  decisions: Record<string, ProofreadDecision>;
  /** What happens after the list is clear: "Send invoice" or "Save draft". */
  continueLabel: string;
  onFix: (issue: ProofreadIssue) => void;
  onKeep: (issue: ProofreadIssue) => void;
  onFixAll: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

export const issueKey = (issue: ProofreadIssue) => `${issue.fieldId}\u0000${issue.original}`;

const KIND_LABELS: Record<ProofreadIssue["kind"], string> = {
  spelling: "Spelling", punctuation: "Punctuation", capitalization: "Capitalization", grammar: "Grammar",
};

export function ProofreadDialog({ open, fields, issues, decisions, continueLabel, onFix, onKeep, onFixAll, onContinue, onCancel }: ProofreadDialogProps) {
  const labels = new Map(fields.map((field) => [field.id, field.label]));
  const remaining = issues.filter((issue) => !decisions[issueKey(issue)]);
  const allResolved = remaining.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-xl !flex flex-col max-h-[85dvh] overflow-hidden" data-testid="dialog-proofread">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><SpellCheck size={18} aria-hidden="true" /> Fix before you continue</DialogTitle>
          <DialogDescription>
            {allResolved
              ? "Everything's sorted. The invoice is ready."
              : `${remaining.length} thing${remaining.length === 1 ? "" : "s"} to look at. Fix each one, or keep it if it's right as written (a name or product, for example).`}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1" data-testid="proofread-issues">
          {issues.map((issue) => {
            const key = issueKey(issue);
            const decision = decisions[key];
            return (
              <li key={key} className={`rounded-xl border p-3 ${decision ? "opacity-60" : ""}`} data-testid={`proofread-issue-${issue.fieldId}`}>
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                  <span>{labels.get(issue.fieldId) ?? issue.fieldId}</span>
                  <span>{KIND_LABELS[issue.kind]}</span>
                </div>
                <p className="mt-1 text-sm">
                  <span className="line-through decoration-red-500/70">{issue.original}</span>
                  {" → "}
                  <span className="font-semibold">{issue.replacement || <em>remove</em>}</span>
                </p>
                {issue.note && <p className="text-xs text-muted-foreground mt-0.5">{issue.note}</p>}
                {decision ? (
                  <p className="mt-2 text-xs font-semibold text-muted-foreground" data-testid={`proofread-decision-${issue.fieldId}`}>
                    {decision === "fixed" ? "Fixed" : "Kept as written"}
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => onFix(issue)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground" data-testid={`button-fix-${issue.fieldId}`}>
                      <Check size={14} aria-hidden="true" /> Fix
                    </button>
                    <button type="button" onClick={() => onKeep(issue)} className="rounded-lg border px-3 py-1.5 text-xs font-bold" data-testid={`button-keep-${issue.fieldId}`}>
                      Keep as written
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm font-bold" data-testid="button-proofread-cancel">Back to editing</button>
          {!allResolved && (
            <button type="button" onClick={onFixAll} className="rounded-lg border px-4 py-2 text-sm font-bold" data-testid="button-proofread-fix-all">Fix all</button>
          )}
          <button type="button" onClick={onContinue} disabled={!allResolved} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-proofread-continue">
            {continueLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
