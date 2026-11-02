import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";

export type GustoDemoSetupStatus = {
  configured: boolean;
  companyId?: string;
  state?: string;
  environment?: string;
  setup?: {
    clientConfigured: boolean;
    canCreateDemoCompany: boolean;
    creationState: string | null;
  };
};

const controlStyle: CSSProperties = {
  border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "8px 12px",
  background: "var(--panel)", color: "var(--fg)", fontSize: "12px", fontFamily: "inherit",
};

const invalidInputMessage = "Enter a company name, administrator name and valid email, and confirm demo setup.";
const rejectedMessages = [
  "Gusto rejected the developer credentials or application permissions. Verify these are Embedded Payroll demo credentials.",
  "Gusto did not create the demo company. Check the application credentials and entered company details before retrying.",
];
const pendingCreationStates = new Set(["demo_creating", "demo_creation_unknown"]);

function definiteRejection(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  // apiRequest currently discards JSON error codes. Only the exact safe
  // messages/status pairs emitted for invalid_input and creation_rejected
  // qualify; unknown 400/502 responses must remain conservatively locked.
  const message = error.message.replace(new RegExp(`^${error.status}: `), "");
  if (error.status === 400 && message === invalidInputMessage) return message;
  if (error.status === 502 && rejectedMessages.includes(message)) return message;
  return null;
}

export default function GustoDemoCompanySetup({ status, statusReady }: { status: GustoDemoSetupStatus; statusReady: boolean }) {
  const queryClient = useQueryClient();
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [failed, setFailed] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const disconnected = !status.configured && !status.companyId && status.state !== "connected";
  const eligible = status.environment === "demo" && disconnected
    && status.setup?.canCreateDemoCompany === true;
  const blocked = status.environment === "demo" && disconnected
    && pendingCreationStates.has(status.setup?.creationState ?? "");
  const canRetry = rejected && statusReady && eligible && !blocked && !pending;
  const valid = companyName.trim().length >= 2 && companyName.trim().length <= 200
    && firstName.trim().length >= 1 && firstName.trim().length <= 100
    && lastName.trim().length >= 1 && lastName.trim().length <= 100
    && email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && confirmed;

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eligible || blocked || !valid || submitted.current) return;
    submitted.current = true;
    setPending(true);
    setOutcome("");
    setRejected(false);
    try {
      const response = await apiRequest("POST", "/api/gusto/demo-company", {
        companyName: companyName.trim(), firstName: firstName.trim(), lastName: lastName.trim(),
        email: email.trim(), confirmDemo: true,
      });
      const result = await response.json();
      if (response.status !== 201 || !result.companyId || result.environment !== "demo" || result.state !== "connected") {
        throw new Error("Unexpected setup response");
      }
      setOutcome("Demo company created and connected. Refresh Gusto status if the company details have not updated.");
    } catch (error) {
      setFailed(true);
      const safeMessage = definiteRejection(error);
      setRejected(!!safeMessage);
      // Never expose provider responses, credentials, or personal data in errors.
      setOutcome(safeMessage
        ? `${safeMessage} Nothing will be retried automatically. Once status confirms setup is available, choose Try again to review your details.`
        : "Demo company creation could not be confirmed. Do not submit again. Refresh Gusto status or contact support to reconcile the company before trying another request.");
    } finally {
      // A failed request may still have created the company. Lock this form and
      // refresh authoritative eligibility on every outcome; never auto-retry.
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["/api/gusto/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/gusto/employees/readiness"] }),
      ]);
      setPending(false);
    }
  }

  if (!eligible && !blocked && !outcome) return null;

  return (
    <div style={{ border: "1px solid var(--panel-bd)", borderRadius: "10px", padding: "14px", background: "var(--panel)", fontSize: "12px" }}>
      <h4 style={{ margin: "0 0 6px", fontSize: "13px" }}>Gusto demo company setup</h4>
      {blocked && <p role="status" style={{ color: "var(--jx-orange-ink)", margin: "6px 0" }}>Demo company creation is blocked while an existing setup request is reconciled. Do not create another company. Refresh Gusto status or contact support.</p>}
      {outcome && <p role={failed ? "alert" : "status"} style={{ color: failed ? "var(--jx-orange-ink)" : "var(--muted)", margin: "6px 0" }}>{outcome}</p>}
      {canRetry && <button type="button" style={{ ...controlStyle, fontWeight: 700, cursor: "pointer" }} onClick={() => {
        const current = queryClient.getQueryState<GustoDemoSetupStatus>(["/api/gusto/status"]);
        if (!canRetry || current?.status !== "success" || current.isInvalidated || current.fetchStatus !== "idle"
          || current.data?.environment !== "demo" || current.data.configured || current.data.companyId
          || current.data.state === "connected" || current.data.setup?.canCreateDemoCompany !== true
          || pendingCreationStates.has(current.data.setup.creationState ?? "")) return;
        submitted.current = false;
        setOutcome("");
        setFailed(false);
        setRejected(false);
        setConfirmed(false);
      }}>Try again</button>}
      {eligible && !blocked && !outcome && (
        <form aria-label="Create Gusto demo company" onSubmit={event => void createCompany(event)}>
          <p style={{ color: "var(--muted)", margin: "0 0 10px" }}>Create a company in Gusto’s demo environment only. This does not run real payroll or make real payments.</p>
          <p id="gusto-demo-admin-notice" style={{ color: "var(--muted)", margin: "0 0 12px" }}>The email provided becomes the company’s primary payroll administrator in Gusto. Gusto may contact this email address.</p>
          <fieldset disabled={pending || submitted.current} style={{ padding: 0, margin: 0, border: 0, minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "10px" }}>
              <label>Company name<input style={{ ...controlStyle, display: "block", marginTop: "4px", width: "100%", boxSizing: "border-box" }} value={companyName} onChange={event => setCompanyName(event.target.value)} required minLength={2} maxLength={200} autoComplete="off" /></label>
              <label>Administrator first name<input style={{ ...controlStyle, display: "block", marginTop: "4px", width: "100%", boxSizing: "border-box" }} value={firstName} onChange={event => setFirstName(event.target.value)} required maxLength={100} autoComplete="off" /></label>
              <label>Administrator last name<input style={{ ...controlStyle, display: "block", marginTop: "4px", width: "100%", boxSizing: "border-box" }} value={lastName} onChange={event => setLastName(event.target.value)} required maxLength={100} autoComplete="off" /></label>
              <label>Administrator email<input style={{ ...controlStyle, display: "block", marginTop: "4px", width: "100%", boxSizing: "border-box" }} type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} autoComplete="off" aria-describedby="gusto-demo-admin-notice" /></label>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", margin: "12px 0", lineHeight: 1.5 }}>
              <input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} style={{ marginTop: "3px" }} />
              I confirm this is a demo company only, with no real payroll or payments, and that the provided email will be Gusto’s primary payroll administrator and may be contacted by Gusto.
            </label>
            <button type="submit" disabled={!valid || pending || submitted.current} style={{ ...controlStyle, fontWeight: 700, cursor: !valid || pending ? "not-allowed" : "pointer", opacity: !valid || pending ? 0.6 : 1 }}>{pending ? "Creating demo company…" : "Create Gusto demo company"}</button>
          </fieldset>
          {pending && <p role="status" style={{ color: "var(--muted)", marginBottom: 0 }}>Waiting for Gusto. Do not submit another setup request.</p>}
        </form>
      )}
    </div>
  );
}
