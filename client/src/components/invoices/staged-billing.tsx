// The two blocks a staged invoice prints: the contract scope for context
// ("Pricing covers") and the billing summary that ends in what is due now.
// Shared by the builder's live preview and the invoice document.
import type { CSSProperties } from "react";
import { INVOICE_STAGE_LABELS, type ContractScopeLine, type InvoiceStage, type StageBasis } from "@shared/invoice-stages";

const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const mono: CSSProperties = { fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", fontVariantNumeric: "tabular-nums" };
const label: CSSProperties = { fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: "6px" };

export interface StagedBillingFigures {
  stage: InvoiceStage | string;
  basis?: StageBasis | null;
  contractScope?: ContractScopeLine[] | null;
  contractTotal?: number | string | null;
  previouslyInvoiced?: number | string | null;
  previouslyPaid?: number | string | null;
}

export function stageTitle(stage: string): string {
  return INVOICE_STAGE_LABELS[stage as InvoiceStage] ?? "Invoice";
}

/** The whole scope with prices, so a deposit or final invoice still shows what the money is for. */
export function PricingCovers({ scope, contractTotal }: { scope: ContractScopeLine[]; contractTotal: number | string }) {
  const sections = [...new Set(scope.map((line) => line.section || ""))];
  return (
    <div style={{ marginTop: "24px" }} data-testid="pricing-covers">
      <div style={label}>Pricing covers</div>
      {sections.map((section) => (
        <div key={section || "general"} style={{ marginBottom: "6px" }}>
          {section && <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", padding: "6px 0 2px" }}>{section}</div>}
          {scope.filter((line) => (line.section || "") === section).map((line, index) => (
            <div key={`${section}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: "16px", padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontSize: "12.5px" }}>
              <span style={{ color: "#0f172a" }}>{line.description}</span>
              <span style={{ ...mono, color: "#475569", flexShrink: 0 }}>{money(line.amount)}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", fontSize: "12.5px", fontWeight: 800, color: "#0f172a" }}>
        <span>Contract total</span>
        <span style={mono} data-testid="text-contract-total">{money(contractTotal)}</span>
      </div>
    </div>
  );
}

/** Contract total, what's been billed and paid before this invoice, and the amount this one asks for. */
export function BillingBlock({ figures, dueNow }: { figures: StagedBillingFigures; dueNow: number | string }) {
  const previouslyInvoiced = Number(figures.previouslyInvoiced) || 0;
  const previouslyPaid = Number(figures.previouslyPaid) || 0;
  const contractTotal = Number(figures.contractTotal) || 0;
  const row: CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" };
  const dueLabel = figures.stage === "deposit" ? "Deposit due now" : figures.stage === "final" ? "Final balance due" : "Due now";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} data-testid="billing-block">
      <div style={row}><span>Contract total</span><span style={{ ...mono, color: "#0f172a" }}>{money(contractTotal)}</span></div>
      {previouslyInvoiced > 0 && <div style={row}><span>Invoiced before this</span><span style={{ ...mono, color: "#0f172a" }}>{money(previouslyInvoiced)}</span></div>}
      {previouslyPaid > 0 && <div style={row}><span>Paid to date</span><span style={{ ...mono, color: "#0f172a" }}>−{money(previouslyPaid)}</span></div>}
      {figures.stage === "final" && contractTotal - previouslyInvoiced > 0 && (
        <div style={row}><span>Remaining on contract</span><span style={{ ...mono, color: "#0f172a" }}>{money(contractTotal - previouslyInvoiced)}</span></div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 800, color: "#fff", background: "#2563eb", padding: "11px 13px", borderRadius: "8px" }}>
        <span>{dueLabel}</span>
        <span style={mono} data-testid="text-due-now">{money(dueNow)}</span>
      </div>
    </div>
  );
}
