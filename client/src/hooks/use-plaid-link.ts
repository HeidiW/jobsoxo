import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PlaidLinkOptions {
  entityType?: "business" | "employee";
  entityId?: string;
  onSuccess?: (account: PlaidAccountMeta) => void;
  onExit?: () => void;
}

export interface PlaidAccountMeta {
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

export function usePlaidLink({ entityType = "business", entityId, onSuccess, onExit }: PlaidLinkOptions) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const handlerRef = useRef<{ open: () => void; destroy: () => void } | null>(null);

  useEffect(() => {
    return () => { handlerRef.current?.destroy(); };
  }, []);

  const open = useCallback(async () => {
    setIsLoading(true);
    try {
      await loadPlaidScript();

      const res = await apiRequest("POST", "/api/plaid/link-token", {});
      const { link_token, error } = await res.json();
      if (error) throw new Error(error);

      if (!window.Plaid) throw new Error("Plaid script did not load");

      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (publicToken: string) => {
          try {
            const exchangeRes = await apiRequest("POST", "/api/plaid/exchange-token", {
              publicToken,
              entityType,
              entityId,
            });
            const account: PlaidAccountMeta = await exchangeRes.json();
            onSuccess?.(account);
          } catch (err: any) {
            toast({ title: "Failed to connect account", description: err.message, variant: "destructive" });
          }
        },
        onExit: (err: any) => {
          if (err) console.warn("Plaid Link exited with error:", err);
          onExit?.();
          setIsLoading(false);
        },
        onLoad: () => { setIsLoading(false); },
        onEvent: () => {},
      });

      handlerRef.current = handler;
      setIsLoading(false);
      handler.open();
    } catch (err: any) {
      toast({ title: "Unable to open bank connection", description: err.message, variant: "destructive" });
      setIsLoading(false);
    }
  }, [entityType, entityId, onSuccess, onExit, toast]);

  return { open, isLoading };
}
