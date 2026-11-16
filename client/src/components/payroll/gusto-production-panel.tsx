// Going live with Gusto: the gates in order, the next step in plain words,
// and the one-time form that creates the real company. Replaces the Demo
// tools panel once GUSTO_ENV is production.
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, Circle, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ProductionReadiness {
  environment: "demo" | "production";
  gates: { productionEnvironment: boolean; applicationCredentials: boolean; companyCreationEnabled: boolean; webhookSecret: boolean; livePayrollEnabled: boolean };
  company: { attached: boolean; companyId: string | null; state: string | null; environment: string | null; creationPending: boolean };
  employees: { active: number; linked: number };
  nextStep: string;
}

export const READINESS_URL = "/api/gusto/production/readiness";

const GATES: Array<{ key: keyof ProductionReadiness["gates"]; label: string; hint: string }> = [
  { key: "productionEnvironment", label: "GUSTO_ENV is production", hint: "Points the app at api.gusto.com instead of the demo host." },
  { key: "applicationCredentials", label: "Production client ID and secret", hint: "Issued by Gusto once the app is approved for production." },
  { key: "companyCreationEnabled", label: "Company creation unlocked", hint: "GUSTO_LIVE_COMPANY_CREATION_ENABLED=true, only while creating the real company." },
  { key: "webhookSecret", label: "Webhook registered", hint: "https://jobsoxo.app/api/gusto/webhook with its verification token in GUSTO_WEBHOOK_SECRET." },
  { key: "livePayrollEnabled", label: "Live payroll enabled", hint: "GUSTO_LIVE_PAYROLL_ENABLED=true, set only for the first real run after onboarding and funding are verified." },
];

export default function GustoProductionPanel({ panel, buttonStyle, busy }: { panel: React.CSSProperties; buttonStyle: React.CSSProperties; busy: boolean }) {
  const query = useQuery<ProductionReadiness>({ queryKey: [READINESS_URL], staleTime: 10_000 });
  const data = query.data;
  if (query.isLoading) return <div style={panel} data-testid="gusto-production-loading"><p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>Checking production readiness…</p></div>;
  if (query.isError || !data) return <div style={panel} role="alert"><p style={{ margin: 0, fontSize: "12px", color: "var(--jx-orange-ink)" }}>Production readiness couldn’t be loaded.</p></div>;
  const canCreate = data.gates.productionEnvironment && data.gates.applicationCredentials && data.gates.companyCreationEnabled && !data.company.attached && !data.company.creationPending && data.company.environment !== "demo";
  return (
    <section aria-labelledby="gusto-production-title" style={{ ...panel, borderStyle: "dashed" }} data-testid="gusto-production">
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 700 }}>
        <Building2 aria-hidden="true" style={{ width: "15px", height: "15px" }} /><span id="gusto-production-title">Going live with Gusto</span>
      </div>
      <p style={{ margin: "6px 0 10px", fontSize: "12px", fontWeight: 600, color: "var(--jx-ink)" }} data-testid="gusto-production-next">Next: {data.nextStep}</p>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "6px", fontSize: "12px" }} data-testid="gusto-production-gates">
        {GATES.map((gate) => {
          const on = data.gates[gate.key];
          return <li key={gate.key} data-testid={`gate-${gate.key}`} data-state={on ? "on" : "off"} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
            {on ? <CheckCircle2 aria-hidden="true" style={{ width: "15px", height: "15px", color: "var(--jx-green-ink)", flexShrink: 0, marginTop: "1px" }} /> : <Circle aria-hidden="true" style={{ width: "15px", height: "15px", color: "var(--muted)", flexShrink: 0, marginTop: "1px" }} />}
            <span><strong>{gate.label}</strong>{on ? " · on" : " · off"}<br /><span style={{ color: "var(--muted)" }}>{gate.hint}</span></span>
          </li>;
        })}
        <li data-testid="gate-company" data-state={data.company.attached ? "on" : "off"} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          {data.company.attached ? <CheckCircle2 aria-hidden="true" style={{ width: "15px", height: "15px", color: "var(--jx-green-ink)", flexShrink: 0, marginTop: "1px" }} /> : <Circle aria-hidden="true" style={{ width: "15px", height: "15px", color: "var(--muted)", flexShrink: 0, marginTop: "1px" }} />}
          <span><strong>Real company attached</strong>{data.company.attached ? ` · ${data.company.environment}` : data.company.environment === "demo" && data.company.companyId ? " · demo company still attached" : " · not yet"}<br /><span style={{ color: "var(--muted)" }}>{data.employees.linked} of {data.employees.active} active employees linked to Gusto.</span></span>
        </li>
      </ol>
      {canCreate && <CreateProductionCompany buttonStyle={buttonStyle} busy={busy} />}
    </section>
  );
}

function CreateProductionCompany({ buttonStyle, busy }: { buttonStyle: React.CSSProperties; busy: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [legalName, setLegalName] = useState("");
  const [confirmLegalName, setConfirmLegalName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const valid = legalName.trim().length >= 2 && legalName.trim() === confirmLegalName.trim() && firstName.trim() && lastName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && confirmed;
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/gusto/production/company", { legalName: legalName.trim(), confirmLegalName: confirmLegalName.trim(), firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), confirmProduction: true })).json(),
    onSuccess: async () => {
      toast({ title: "Company created in Gusto", description: "Next: company onboarding, funding and employees in Gusto's screens." });
      await Promise.all([queryClient.invalidateQueries({ queryKey: [READINESS_URL] }), queryClient.invalidateQueries({ queryKey: ["/api/gusto/status"] })]);
    },
    onError: (err: Error) => setError(err.message.replace(/^\d+:\s*/, "")),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); setError(""); if (valid && !create.isPending) create.mutate(); };
  const input: React.CSSProperties = { ...buttonStyle, cursor: "text", width: "100%", textAlign: "left", fontWeight: 500 };
  return (
    <form onSubmit={submit} style={{ marginTop: "12px", padding: "12px", borderRadius: "10px", background: "var(--jx-gold-tint)", display: "grid", gap: "8px", fontSize: "12px" }} aria-label="Create the real company in Gusto" data-testid="gusto-production-create">
      <p style={{ margin: 0, display: "flex", gap: "6px", alignItems: "flex-start", color: "var(--jx-gold-ink)" }}><ShieldAlert aria-hidden="true" style={{ width: "15px", height: "15px", flexShrink: 0 }} />This creates a real Gusto company for a real business, once. Use the exact legal name on the business's tax filings; it can't be renamed from here.</p>
      <label>Legal business name<input value={legalName} onChange={(e) => setLegalName(e.target.value)} style={input} data-testid="input-live-legal-name" autoComplete="organization" /></label>
      <label>Type the legal name again<input value={confirmLegalName} onChange={(e) => setConfirmLegalName(e.target.value)} style={input} data-testid="input-live-legal-name-confirm" autoComplete="off" /></label>
      {confirmLegalName && legalName.trim() !== confirmLegalName.trim() && <p role="alert" style={{ margin: 0, color: "var(--jx-orange-ink)" }}>The two names don’t match.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <label>Signatory first name<input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={input} data-testid="input-live-first-name" /></label>
        <label>Signatory last name<input value={lastName} onChange={(e) => setLastName(e.target.value)} style={input} data-testid="input-live-last-name" /></label>
      </div>
      <label>Signatory email (Gusto sends onboarding here)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} data-testid="input-live-email" /></label>
      <label style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="checkbox-live-confirm" /><span>I understand this creates the real company in Gusto. Terms, tax setup, funding and payroll approval still happen in Gusto, by the signatory.</span></label>
      {error && <p role="alert" style={{ margin: 0, color: "var(--jx-orange-ink)" }} data-testid="gusto-production-error">{error}</p>}
      <div><button type="submit" style={{ ...buttonStyle, background: "var(--jox-primary)", color: "#fff", border: 0 }} disabled={!valid || busy || create.isPending} data-testid="button-create-live-company">{create.isPending ? "Creating…" : "Create the real company in Gusto"}</button></div>
    </form>
  );
}
