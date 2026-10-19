import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle, AlertCircle, Landmark, Building2 } from "lucide-react";

interface SetupInfo {
  employeeId: string;
  employeeName: string;
}

interface PlaidAccountMeta {
  id: string;
  institutionName: string;
  accountName: string;
  accountMask: string;
  accountType: string;
  routingNumberMask: string | null;
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: any) => { open: () => void; destroy: () => void };
    };
  }
}

function loadPlaidScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) { resolve(); return; }
    const existing = document.getElementById("plaid-link-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.id = "plaid-link-script";
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function EmployeeBankSetup() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [connected, setConnected] = useState<PlaidAccountMeta | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const handlerRef = useRef<{ open: () => void; destroy: () => void } | null>(null);

  useEffect(() => { return () => { handlerRef.current?.destroy(); }; }, []);

  const { data, isLoading, error, isError } = useQuery<SetupInfo>({
    queryKey: ["/api/employee-bank-setup", token],
    queryFn: async () => {
      const res = await fetch(`/api/employee-bank-setup/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        throw new Error(body.error || `Error ${res.status}`);
      }
      return res.json();
    },
    retry: false,
    enabled: !!token,
  });

  const openPlaid = useCallback(async () => {
    setLinkLoading(true);
    setLinkError(null);
    try {
      await loadPlaidScript();

      const res = await fetch(`/api/employee-bank-setup/${token}/link-token`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to create link token");
      const { link_token } = body;

      if (!window.Plaid) throw new Error("Plaid script did not load");

      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (publicToken: string) => {
          try {
            const exchangeRes = await fetch(`/api/employee-bank-setup/${token}/exchange`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicToken }),
            });
            const account = await exchangeRes.json();
            if (!exchangeRes.ok) throw new Error(account.error || "Failed to connect account");
            setConnected(account);
          } catch (err: any) {
            setLinkError(err.message);
          }
        },
        onExit: (err: any) => {
          if (err) console.warn("Plaid Link exited with error:", err);
          setLinkLoading(false);
        },
        onLoad: () => { setLinkLoading(false); },
        onEvent: () => {},
      });

      handlerRef.current = handler;
      setLinkLoading(false);
      handler.open();
    } catch (err: any) {
      setLinkError(err.message);
      setLinkLoading(false);
    }
  }, [token]);

  if (!token) {
    return (
      <div style={pageWrap}>
        <div style={card}>
          <AlertCircle style={{ width: "40px", height: "40px", color: "#ef4444", margin: "0 auto 16px" }} />
          <h1 style={heading}>Invalid Link</h1>
          <p style={sub}>This setup link is missing or malformed. Please contact your employer for a new link.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={pageWrap}>
        <div style={card}>
          <Loader2 style={{ width: "32px", height: "32px", color: "#94a3b8", margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
          <p style={sub}>Verifying your setup link…</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    const msg = (error as Error)?.message ?? "This setup link is invalid or has expired.";
    return (
      <div style={pageWrap}>
        <div style={card}>
          <AlertCircle style={{ width: "40px", height: "40px", color: "#ef4444", margin: "0 auto 16px" }} />
          <h1 style={heading}>Link Not Found</h1>
          <p style={sub}>{msg}</p>
        </div>
      </div>
    );
  }

  if (connected) {
    return (
      <div style={pageWrap}>
        <div style={card}>
          <CheckCircle style={{ width: "44px", height: "44px", color: "#16a34a", margin: "0 auto 16px" }} />
          <h1 style={{ ...heading, color: "#15803d" }}>Bank Connection Saved</h1>
          <p style={sub}>This legacy Plaid bank connection was saved. It does not indicate that your Gusto payroll or payment method is ready.</p>
          <div style={bankBox}>
            <Landmark style={{ width: "18px", height: "18px", color: "#2563eb", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: "#0f172a" }}>{connected.institutionName}</div>
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                {connected.accountName} ••••{connected.accountMask}
                {connected.routingNumberMask && <span style={{ marginLeft: "8px" }}>· Routing: {connected.routingNumberMask}</span>}
              </div>
            </div>
          </div>
          <p style={{ ...sub, marginTop: "16px", fontSize: "12px" }}>You can close this page. Your employer has been notified; Gusto setup is managed separately.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "20px" }}>
          <Building2 style={{ width: "28px", height: "28px", color: "#2563eb" }} />
        </div>
        <h1 style={heading}>Connect a Bank for the Legacy Bank View</h1>
        <p style={sub}>
          Hi <strong>{data.employeeName}</strong>! This older bank-link workflow is separate from Gusto payroll setup.
        </p>
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "10px", padding: "14px 16px", marginBottom: "20px", fontSize: "13px", color: "#0369a1" }}>
          <strong>Secure &amp; private.</strong> Your bank credentials are handled by Plaid and are never shared with your employer. A connected account here does not mean a Gusto payment method is ready.
        </div>

        {linkError && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>
            {linkError}
          </div>
        )}

        <button
          onClick={openPlaid}
          disabled={linkLoading}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "9px",
            background: "#2563eb", color: "#fff", border: "none", borderRadius: "10px",
            padding: "14px 20px", fontSize: "15px", fontWeight: 700, cursor: linkLoading ? "wait" : "pointer",
            fontFamily: "inherit", opacity: linkLoading ? 0.7 : 1,
          }}
          data-testid="button-connect-bank"
        >
          <Landmark style={{ width: "17px", height: "17px" }} />
          {linkLoading ? "Opening secure bank connection…" : "Connect my bank account"}
        </button>

        <p style={{ ...sub, marginTop: "16px", fontSize: "11.5px", color: "#94a3b8" }}>
          Powered by Plaid · Bank-level 256-bit encryption
        </p>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const pageWrap: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#f4f6f9", padding: "24px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
};

const card: React.CSSProperties = {
  background: "#fff", borderRadius: "16px", boxShadow: "0 4px 24px rgba(0,0,0,0.09)",
  padding: "36px 32px", maxWidth: "420px", width: "100%", textAlign: "center",
};

const heading: React.CSSProperties = {
  fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 10px", letterSpacing: "-0.02em",
};

const sub: React.CSSProperties = {
  fontSize: "14px", color: "#64748b", margin: "0 0 20px", lineHeight: 1.6,
};

const bankBox: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "12px", background: "#f0fdf4",
  border: "1px solid #bbf7d0", borderRadius: "10px", padding: "14px 16px",
  textAlign: "left", marginTop: "12px",
};
