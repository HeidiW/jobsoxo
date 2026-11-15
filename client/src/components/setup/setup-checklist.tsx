// "Set up your business": shown at the top of the dashboard until the basics
// exist, so a new account knows what to do first and in what order. Each
// step links to where it's done. The card hides itself once every step is
// complete, or when an admin dismisses it for the whole team.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Check, ClipboardCheck, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface SetupStatus {
  companyDetails: boolean;
  clients: number;
  jobs: number;
  invoices: number;
  dismissed: boolean;
  complete: boolean;
}

export const SETUP_STATUS_URL = "/api/setup/status";

export function setupSteps(status: SetupStatus) {
  return [
    { key: "company", label: "Add your company details", hint: "Name, email and address go on every invoice.", href: "/settings", done: status.companyDetails },
    { key: "client", label: "Add your first client", hint: "Jobs and invoices belong to a client, so this comes first.", href: "/clients?new=1", done: status.clients > 0 },
    { key: "job", label: "Create a job for that client", hint: "Hours, materials and scheduling all hang off a job.", href: "/jobs?new=1", done: status.jobs > 0 },
    { key: "invoice", label: "Send your first invoice", hint: "Build it from the job and email it to the client.", href: "/invoices/new", done: status.invoices > 0 },
  ];
}

function isSetupStatus(value: unknown): value is SetupStatus {
  return !!value && typeof value === "object" && "clients" in value && "complete" in value;
}

export function SetupChecklist() {
  const { user } = useAuth();
  const query = useQuery<SetupStatus>({ queryKey: [SETUP_STATUS_URL] });
  const dismiss = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/setup/dismiss")).json(),
    onSuccess: (next) => queryClient.setQueryData([SETUP_STATUS_URL], next),
  });
  const status = query.data;
  if (!isSetupStatus(status) || status.complete || status.dismissed) return null;

  const steps = setupSteps(status);
  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);

  return (
    <section aria-labelledby="setup-checklist-title" className="rounded-[24px] border-2 border-jx-green bg-jx-green-tint p-5 sm:p-6" data-testid="setup-checklist">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-jx-green text-white"><ClipboardCheck className="h-5 w-5" aria-hidden="true" /></div>
          <div>
            <h2 id="setup-checklist-title" className="font-display text-2xl !font-bold tracking-[-.03em] text-jx-ink">Set up your business</h2>
            <p className="mt-1 text-sm text-jx-ink-2">{doneCount} of {steps.length} done. Do these in order and everything else in JobsOxo falls into place.</p>
          </div>
        </div>
        {user?.isAdmin && (
          <button type="button" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} aria-label="Dismiss setup checklist"
            className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-xs font-semibold text-jx-ink-2 hover:bg-white/60" data-testid="button-dismiss-setup">
            <X className="h-4 w-4" aria-hidden="true" />Hide for everyone
          </button>
        )}
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.key} data-testid={`setup-step-${step.key}`} data-done={step.done}>
            <Link href={step.href} className={`flex min-h-[72px] items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${step.done ? "border-transparent bg-white/50 text-jx-ink-3" : step === next ? "border-jx-green bg-white shadow-sm" : "border-transparent bg-white/70"}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.done ? "bg-jx-green text-white" : "bg-jx-surface text-jx-ink"}`} aria-hidden="true">
                {step.done ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${step.done ? "line-through" : "text-jx-ink"}`}>{step.label}</span>
                {!step.done && <span className="mt-0.5 block text-xs text-jx-ink-2">{step.hint}</span>}
              </span>
              {step === next && <ArrowRight className="h-4 w-4 shrink-0 text-jx-green-ink" aria-hidden="true" />}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
