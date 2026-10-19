import { useQuery } from "@tanstack/react-query";
import { Landmark, RefreshCw } from "lucide-react";
import { usePlaidLink } from "@/hooks/use-plaid-link";
import { useToast } from "@/hooks/use-toast";

type BankSummary = {
  connected?: boolean;
  institutionName?: string;
  accountMask?: string;
  current?: number;
  available?: number;
  refreshedAt?: string;
  stale?: boolean;
  error?: string;
  transactions?: Array<{ id?: string; date?: string; name?: string; amount?: number; pending?: boolean; status?: string }>;
};

const money = (amount?: number) => typeof amount === "number"
  ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
  : "—";

/** Independent, read-only Plaid business account view. It never gates or funds payroll. */
export default function GustoBankView() {
  const { toast } = useToast();
  const { data: bank, isLoading, isError, refetch, isFetching } = useQuery<BankSummary>({
    queryKey: ["/api/plaid/bank-summary"],
    queryFn: async () => {
      const response = await fetch("/api/plaid/bank-summary", { credentials: "include" });
      if (!response.ok) throw new Error("Bank summary is unavailable.");
      return response.json();
    },
    staleTime: 30_000,
    retry: false,
  });
  const plaid = usePlaidLink({
    entityType: "business",
    onSuccess: () => {
      void refetch();
      toast({ title: "Bank view connected" });
    },
  });
  const panel: React.CSSProperties = {
    border: "1px solid var(--panel-bd)", borderRadius: "10px", padding: "14px",
    background: "var(--panel)",
  };
  const action: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "7px", border: "1px solid var(--panel-bd)",
    borderRadius: "8px", padding: "8px 12px", background: "var(--panel)", color: "var(--fg)",
    fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  };
  const transactions = [...(bank?.transactions ?? [])]
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 10);

  return (
    <section style={{ ...panel, marginBottom: "18px" }} aria-label="Independent bank balance view" data-testid="plaid-bank-view">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          <Landmark aria-hidden="true" style={{ color: "var(--jox-primary)", width: "18px", marginTop: "2px" }} />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700 }}>Bank balance · read only</div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px" }}>
              {isLoading ? "Loading independent account view…" : bank?.connected
                ? `${bank.institutionName || "Connected account"}${bank.accountMask ? ` · ••••${bank.accountMask}` : ""}`
                : "No account connected. This view is independent of Gusto payroll."}
            </div>
            {bank?.refreshedAt && <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "3px" }}>Updated {new Date(bank.refreshedAt).toLocaleString()}{bank.stale ? " · data may be stale" : ""}</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {bank?.connected && <><div><div style={{ fontSize: "10px", color: "var(--muted)" }}>Current</div><strong>{money(bank.current)}</strong></div><div><div style={{ fontSize: "10px", color: "var(--muted)" }}>Available</div><strong>{money(bank.available)}</strong></div></>}
          <button type="button" style={action} onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh read-only bank view">
            <RefreshCw aria-hidden="true" style={{ width: "13px", height: "13px" }} />{isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" style={action} onClick={plaid.open} disabled={plaid.isLoading}>
            {plaid.isLoading ? "Opening…" : bank?.connected ? "Reconnect view" : "Connect bank view"}
          </button>
        </div>
      </div>
      {isError && <p role="alert" style={{ color: "#b91c1c", fontSize: "12px", margin: "10px 0 0" }}>The read-only bank view could not load. Gusto payroll remains available independently.</p>}
      {bank?.error && <p role="status" style={{ color: "#9a3412", fontSize: "12px", margin: "10px 0 0" }}>{bank.error}</p>}
      {bank?.connected && !transactions.length && !isLoading && !isError && <p style={{ color: "var(--muted)", fontSize: "12px", margin: "12px 0 0" }}>No recent transactions in this read-only view.</p>}
      {transactions.length > 0 && (
        <div style={{ border: "1px solid var(--panel-bd)", borderRadius: "8px", overflow: "hidden", marginTop: "12px" }}>
          <div style={{ padding: "9px 12px", fontSize: "10px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", background: "var(--track)" }}>Latest 10 transactions</div>
          {transactions.map((transaction, index) => <div key={transaction.id || `${transaction.date}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: "10px", padding: "8px 12px", borderTop: "1px solid var(--panel-bd)", fontSize: "12px" }}>
            <span>{transaction.name || "Bank transaction"} <span style={{ color: "var(--muted)" }}>· {transaction.date || "Date unavailable"}{transaction.pending ? " · Pending" : " · Posted"}</span></span>
            <strong>{money(transaction.amount)}</strong>
          </div>)}
        </div>
      )}
      <p style={{ color: "var(--muted)", fontSize: "11px", margin: "10px 0 0" }}>Balance and transactions do not determine Gusto funding readiness or payroll submission.</p>
    </section>
  );
}
