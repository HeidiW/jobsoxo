// Whether each client email about this invoice arrived, and if not, why.
// Keeps checking while any email is still on its way.
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, MailX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmailDelivery } from "@shared/schema";
import {
  DELIVERY_KIND_LABELS, DELIVERY_LABELS, FINAL_STATUSES, PROBLEM_STATUSES, type DeliveryStatus,
} from "@shared/email-delivery";

const isProblem = (status: string) => (PROBLEM_STATUSES as readonly string[]).includes(status);
const isFinal = (status: string) => (FINAL_STATUSES as readonly string[]).includes(status);

function StatusBadge({ status }: { status: string }) {
  const label = DELIVERY_LABELS[status as DeliveryStatus] ?? status;
  const tone = isProblem(status)
    ? "bg-red-50 text-red-700 border-red-200"
    : status === "delivered" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : status === "complained" || status === "delayed" ? "bg-amber-50 text-amber-800 border-amber-200"
    : "bg-slate-50 text-slate-600 border-slate-200";
  const Icon = isProblem(status) ? MailX : status === "delivered" ? CheckCircle2 : status === "sent" || status === "delayed" ? Clock : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`} data-testid="badge-delivery-status">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </span>
  );
}

export function EmailDeliveryPanel({ invoiceId }: { invoiceId: string }) {
  const { data: deliveries = [] } = useQuery<EmailDelivery[]>({
    queryKey: ["/api/invoices", invoiceId, "deliveries"],
    refetchInterval: (query) => (query.state.data ?? []).some((row) => !isFinal(row.status)) ? 15_000 : false,
  });
  if (deliveries.length === 0) return null;

  const latestInvoiceEmail = deliveries.find((row) => row.kind === "invoice");
  const problem = latestInvoiceEmail && isProblem(latestInvoiceEmail.status) ? latestInvoiceEmail : null;

  return (
    <div className="space-y-3 mb-6 print:hidden">
      {problem && (
        <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" data-testid="alert-invoice-email-problem">
          <MailX className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold">The client didn't get this invoice by email ({DELIVERY_LABELS[problem.status as DeliveryStatus]?.toLowerCase()}).</p>
            {problem.detail && <p className="mt-1">{problem.detail}</p>}
            <p className="mt-1 text-red-700/80">Sent to {problem.recipients.join(", ")}. Fix the address under "Sends to" if needed, then send again.</p>
          </div>
        </div>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Email delivery</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y" data-testid="list-email-deliveries">
            {deliveries.map((row) => (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0" data-testid={`delivery-${row.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold">{DELIVERY_KIND_LABELS[row.kind] ?? row.kind}</span>
                    <span className="text-muted-foreground"> · {format(new Date(row.createdAt), "MMM d, h:mm a")} · to {row.recipients.join(", ")}</span>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                {row.detail && (
                  <p className={`mt-1 text-sm ${isProblem(row.status) ? "text-red-700" : "text-muted-foreground"}`} data-testid="text-delivery-detail">{row.detail}</p>
                )}
                {row.status === "sent" && (
                  <p className="mt-1 text-xs text-muted-foreground">Accepted by the email service; waiting for the client's mail server to confirm.</p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
