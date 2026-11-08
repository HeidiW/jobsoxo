import type { StatusItem } from "./payroll-next-step";

const DOT: Record<StatusItem["state"], string> = {
  done: "var(--jx-green)",
  todo: "hsl(var(--destructive))",
  unknown: "var(--muted)",
  info: "var(--jx-ink-3, var(--muted))",
};

/** A compact strip answering "is payroll ready?" before anything else on the page. */
export function PayrollStatus({ items, note }: { items: StatusItem[]; note?: string }) {
  return (
    <section aria-label="Payroll status" data-testid="payroll-status" style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        {items.map((item) => (
          <div key={item.key} data-testid={`status-${item.key}`} data-state={item.state}
            style={{ flex: "1 1 220px", display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", border: "1px solid var(--panel-bd)", borderRadius: "12px", background: "var(--panel)" }}>
            <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "50%", background: DOT[item.state], flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)" }}>{item.label}</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: item.state === "todo" ? "hsl(var(--destructive))" : "var(--fg)" }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>
      {note && <p style={{ margin: "8px 2px 0", fontSize: "12px", color: "var(--muted)" }}>{note}</p>}
    </section>
  );
}
