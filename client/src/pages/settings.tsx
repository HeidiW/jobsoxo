import { useQuery, useMutation } from "@tanstack/react-query";
import { formatPhone } from "@/lib/formatPhone";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  Receipt,
  Clock,
  Save,
  Users,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  MessageSquare,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Landmark,
  Unlink,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  Search,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { Settings, Invite } from "@shared/schema";
import { usePlaidLink, type PlaidAccountMeta } from "@/hooks/use-plaid-link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import "@/components/settings/settings.css";

const settingsFormSchema = z.object({
  companyName: z.string().optional(),
  companyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyPhone: z.string().optional(),
  companyAddress: z.string().optional(),
  taxRate: z.string().optional(),
  invoicePrefix: z.string().optional(),
  invoiceTerms: z.string().optional(),
  inboxSyncHour: z.coerce.number().int().min(0).max(23).optional(),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

type PlaidTxRow = {
  id: string;
  plaidTransactionId: string;
  date: string;
  amount: string;
  name: string;
  merchantName?: string | null;
  matchedPaymentId?: string | null;
  matchedInvoiceNumber?: string | null;
  matchedClientName?: string | null;
};

type PaymentOption = {
  id: string;
  amount: string;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  clientName?: string | null;
};

function BusinessBankAccountCard({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const [localAccount, setLocalAccount] = useState<PlaidAccountMeta | null | undefined>(undefined);
  const [linkDialogTx, setLinkDialogTx] = useState<PlaidTxRow | null>(null);
  const [paymentSearch, setPaymentSearch] = useState("");

  const { data: plaidStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/plaid/status"],
  });

  const { data: accountData, isLoading } = useQuery<PlaidAccountMeta | null>({
    queryKey: ["/api/plaid/bank-account", "business"],
    queryFn: async () => {
      const res = await fetch("/api/plaid/bank-account?entityType=business", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load bank account");
      return res.json();
    },
  });

  useEffect(() => {
    if (accountData !== undefined && localAccount === undefined) {
      setLocalAccount(accountData);
    }
  }, [accountData]);

  const account = localAccount !== undefined ? localAccount : accountData;
  const isConnected = !!account;

  const { data: balanceData } = useQuery<{ current?: number; available?: number; connected: boolean }>({
    queryKey: ["/api/plaid/balance"],
    enabled: isConnected,
    staleTime: 5 * 60 * 1000,
  });

  const { data: txData, refetch: refetchTx } = useQuery<{ transactions: PlaidTxRow[]; lastSynced: string | null }>({
    queryKey: ["/api/plaid/transactions"],
    enabled: isConnected,
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/plaid/bank-accounts/${id}`);
    },
    onSuccess: () => {
      setLocalAccount(null);
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/bank-account", "business"] });
      queryClient.removeQueries({ queryKey: ["/api/plaid/balance"] });
      queryClient.removeQueries({ queryKey: ["/api/plaid/transactions"] });
      toast({ title: "Bank account disconnected" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/plaid/sync-transactions", {});
      return res.json();
    },
    onSuccess: (data) => {
      refetchTx();
      if (!data.ready) {
        toast({ title: "Transactions not ready yet", description: "Your bank is still preparing transaction data. Try again in a moment." });
      } else {
        toast({ title: `Synced ${data.synced} transaction${data.synced !== 1 ? "s" : ""}`, description: data.matched > 0 ? `${data.matched} automatically matched to invoice payments.` : undefined });
      }
    },
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  const { data: searchablePayments = [] } = useQuery<PaymentOption[]>({
    queryKey: ["/api/plaid/searchable-payments"],
    enabled: !!linkDialogTx,
  });

  const linkMutation = useMutation({
    mutationFn: async ({ txId, paymentId }: { txId: string; paymentId: string }) => {
      await apiRequest("PATCH", `/api/plaid/transactions/${txId}/match`, { paymentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      setLinkDialogTx(null);
      setPaymentSearch("");
      toast({ title: "Transaction linked to payment" });
    },
    onError: () => toast({ title: "Failed to link transaction", variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (txId: string) => {
      await apiRequest("DELETE", `/api/plaid/transactions/${txId}/match`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      toast({ title: "Match removed" });
    },
    onError: () => toast({ title: "Failed to unlink transaction", variant: "destructive" }),
  });

  const { open, isLoading: linkLoading } = usePlaidLink({
    entityType: "business",
    onSuccess: (acct) => {
      setLocalAccount(acct);
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/bank-account", "business"] });
      toast({ title: "Bank account connected", description: `${acct.institutionName} ••••${acct.accountMask}` });
    },
  });

  const filteredPayments = useMemo(() => {
    const q = paymentSearch.toLowerCase();
    if (!q) return searchablePayments;
    return searchablePayments.filter(p =>
      (p.invoiceNumber ?? "").toLowerCase().includes(q) ||
      (p.clientName ?? "").toLowerCase().includes(q) ||
      (p.referenceNumber ?? "").toLowerCase().includes(q)
    );
  }, [searchablePayments, paymentSearch]);

  const fmtAmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const lastSyncedLabel = txData?.lastSynced
    ? `Last synced ${new Date(txData.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "Not yet synced";

  return (
    <Card className="settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5" />
          Business Bank Account
        </CardTitle>
        <CardDescription>
          Connect your business bank account via Plaid to enable balance checks and invoice reconciliation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!plaidStatus?.configured ? (
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="plaid-not-configured">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-foreground">Plaid not configured</p>
              <p className="mt-1">Add your <code className="rounded bg-muted px-1 text-xs font-mono">PLAID_CLIENT_ID</code> and <code className="rounded bg-muted px-1 text-xs font-mono">PLAID_SECRET</code> secrets (Sandbox mode) to enable bank account connections.</p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex gap-3 items-center p-3 rounded-md bg-muted/50">
            <div className="h-4 w-4 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-48 rounded bg-muted animate-pulse" />
          </div>
        ) : account ? (
          <>
            {/* Account row */}
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3" data-testid="connected-bank-account">
              <div className="flex items-center gap-3">
                <Landmark className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="font-medium text-sm" data-testid="text-bank-institution">{account.institutionName}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-bank-account-mask">{account.accountName} ••••{account.accountMask}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => disconnectMutation.mutate(account.id)}
                disabled={!canManage || disconnectMutation.isPending}
                data-testid="button-disconnect-bank"
              >
                <Unlink className="h-4 w-4 mr-1.5" />
                {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>

            {/* Balance strip */}
            {balanceData?.connected && (
              <div className="grid grid-cols-2 gap-3">
                {balanceData.current != null && (
                  <div className="rounded-md border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Current balance</p>
                    <p className="text-lg font-bold font-mono mt-0.5">{fmtAmt(balanceData.current)}</p>
                  </div>
                )}
                {balanceData.available != null && (
                  <div className="rounded-md border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Available</p>
                    <p className="text-lg font-bold font-mono mt-0.5">{fmtAmt(balanceData.available)}</p>
                  </div>
                )}
              </div>
            )}

            {/* Transactions reconciliation panel */}
            <div className="rounded-md border">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div>
                  <p className="text-sm font-semibold">Transaction reconciliation</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{lastSyncedLabel}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  disabled={!canManage || syncMutation.isPending}
                  data-testid="button-sync-transactions"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "Syncing…" : "Sync now"}
                </Button>
              </div>

              {!txData || txData.transactions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No transactions synced yet. Click <strong>Sync now</strong> to fetch the last 90 days.
                </div>
              ) : (
                <div className="divide-y max-h-72 overflow-y-auto">
                  {txData.transactions.slice(0, 20).map(tx => {
                    const amt = Number(tx.amount);
                    const isCredit = amt < 0; // money coming in
                    const isUnlinking = unlinkMutation.isPending;
                    return (
                      <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className={`flex-shrink-0 rounded-full p-1 ${isCredit ? "bg-green-50 text-green-600" : "bg-slate-100 text-slate-500"}`}>
                          {isCredit
                            ? <ArrowDownLeft className="h-3.5 w-3.5" />
                            : <ArrowUpRight className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{tx.merchantName || tx.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtDate(tx.date)}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-sm font-mono font-semibold ${isCredit ? "text-green-700" : ""}`}>
                            {isCredit ? "+" : ""}{fmtAmt(Math.abs(amt))}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          {tx.matchedPaymentId ? (
                            <button
                              type="button"
                              title="Click to unlink this match"
                              disabled={!canManage || isUnlinking}
                              onClick={() => unlinkMutation.mutate(tx.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700 transition-colors disabled:opacity-50"
                              data-testid={`button-unlink-tx-${tx.id}`}
                            >
                              <Link2 className="h-3 w-3" />
                              {tx.matchedInvoiceNumber
                                ? <span>{tx.matchedInvoiceNumber}{tx.matchedClientName ? ` · ${tx.matchedClientName}` : ""}</span>
                                : <span>Matched</span>}
                            </button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                              disabled={!canManage}
                              onClick={() => { setLinkDialogTx(tx); setPaymentSearch(""); }}
                              data-testid={`button-link-tx-${tx.id}`}
                            >
                              <Link2 className="h-3 w-3 mr-1" />
                              Link to payment
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Link-to-payment dialog */}
            <Dialog open={!!linkDialogTx} onOpenChange={(open) => { if (!open) { setLinkDialogTx(null); setPaymentSearch(""); } }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Link to invoice payment</DialogTitle>
                  <DialogDescription>
                    {linkDialogTx && (
                      <span>
                        Linking <strong>{fmtAmt(Math.abs(Number(linkDialogTx.amount)))}</strong> on {fmtDate(linkDialogTx.date)} — {linkDialogTx.merchantName || linkDialogTx.name}
                      </span>
                    )}
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-1 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by client, invoice #, or reference…"
                      value={paymentSearch}
                      onChange={e => setPaymentSearch(e.target.value)}
                      className="pl-8"
                      data-testid="input-payment-search"
                    />
                    {paymentSearch && (
                      <button
                        type="button"
                        onClick={() => setPaymentSearch("")}
                        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <ScrollArea className="h-64 rounded-md border">
                    {filteredPayments.length === 0 ? (
                      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {searchablePayments.length === 0 ? "No invoice payments recorded yet." : "No payments match your search."}
                      </p>
                    ) : (
                      <div className="divide-y">
                        {filteredPayments.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className="w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3"
                            disabled={!canManage || linkMutation.isPending}
                            onClick={() => linkDialogTx && linkMutation.mutate({ txId: linkDialogTx.id, paymentId: p.id })}
                            data-testid={`payment-option-${p.id}`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {p.invoiceNumber ?? "—"}{p.clientName ? ` · ${p.clientName}` : ""}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(p.paymentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                {p.referenceNumber ? ` · Ref: ${p.referenceNumber}` : ""}
                              </p>
                            </div>
                            <span className="text-sm font-mono font-semibold shrink-0 text-green-700">
                              +{fmtAmt(Math.abs(Number(p.amount)))}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No bank account connected. Connect one to enable balance checks and payment reconciliation.</p>
            <Button
              type="button"
              variant="outline"
              onClick={open}
              disabled={!canManage || linkLoading}
              data-testid="button-connect-bank"
            >
              <Landmark className="h-4 w-4 mr-2" />
              {linkLoading ? "Opening…" : "Connect bank account"}
            </Button>
            <p className="text-xs text-muted-foreground">Uses Plaid Sandbox — no real banking credentials required for testing.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvitePanel() {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: invites = [], isLoading } = useQuery<Invite[]>({
    queryKey: ["/api/invites"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invites", { label: label.trim() || undefined });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invites"] });
      setLabel("");
      toast({ title: "Invite code created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create code", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/invites/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invites"] });
      toast({ title: "Invite code removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove code", description: err.message, variant: "destructive" });
    },
  });

  const copyCode = (invite: Invite) => {
    navigator.clipboard.writeText(invite.code);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const unused = invites.filter((i) => !i.usedAt);
  const used = invites.filter((i) => i.usedAt);

  return (
    <Card className="settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Team Access
        </CardTitle>
        <CardDescription>
          Generate single-use invite codes so others can create an account on your JobsOxo site
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new invite */}
        <div className="flex gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. For Mike) — optional"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="input-invite-label"
          />
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            data-testid="button-create-invite"
            className="shrink-0"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Generate Code
          </Button>
        </div>

        {/* Active (unused) codes */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : unused.length === 0 && used.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No invite codes yet — generate one above to share with your team
          </p>
        ) : (
          <div className="space-y-2">
            {unused.length > 0 && (
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active codes</p>
            )}
            {unused.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between p-3 rounded-md bg-muted/50 gap-3" data-testid={`invite-row-${invite.id}`}>
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold tracking-widest">{invite.code}</span>
                  {invite.label && <span className="ml-2 text-xs text-muted-foreground">— {invite.label}</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => copyCode(invite)}
                    aria-label={`Copy invite code ${invite.code}`}
                    data-testid={`button-copy-invite-${invite.id}`}
                  >
                    {copiedId === invite.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteMutation.mutate(invite.id)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Revoke invite code ${invite.code}`}
                    data-testid={`button-revoke-invite-${invite.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {used.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Used codes</p>
                {used.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between p-3 rounded-md opacity-50 gap-3" data-testid={`invite-row-used-${invite.id}`}>
                    <div className="min-w-0">
                      <span className="font-mono text-sm tracking-widest line-through">{invite.code}</span>
                      {invite.label && <span className="ml-2 text-xs text-muted-foreground">— {invite.label}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">Used</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Each code can only be used once. Share it directly with the person you want to invite.
        </p>
      </CardContent>
    </Card>
  );
}

const STAGE_LABELS = ["Friendly Reminder", "Firm Notice", "Final Notice"];
const DEFAULT_SUBJECTS = [
  "Friendly Reminder: Invoice {{invoiceNumber}} is Past Due",
  "Second Notice: Invoice {{invoiceNumber}} Payment Overdue",
  "Final Notice: Invoice {{invoiceNumber}} Requires Immediate Attention",
];
const DEFAULT_BODIES = [
  "Hi {{clientName}},\n\nThis is a friendly reminder that invoice {{invoiceNumber}} for {{balance}} is now past due.\n\nPlease remit payment at your earliest convenience. If you have any questions, don't hesitate to reach out.\n\nThank you,\n{{companyName}}",
  "Dear {{clientName}},\n\nWe have not yet received payment for invoice {{invoiceNumber}} in the amount of {{balance}}, which is now {{daysOverdue}} days overdue.\n\nPlease remit payment as soon as possible. Contact us if you need to discuss payment arrangements.\n\n{{companyName}}",
  "{{clientName}},\n\nThis is our final notice regarding invoice {{invoiceNumber}} for {{balance}}, now {{daysOverdue}} days past due.\n\nImmediate payment is required to avoid further action.\n\n{{companyName}}",
];

function CollectionsAgentCard({ settings, canManage }: { settings: Settings | undefined; canManage: boolean }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [intervals, setIntervals] = useState<number[]>([7, 14, 30]);
  const [tones, setTones] = useState<{ stage: number; label: string; subject: string; body: string }[]>([]);
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!settings || initializedRef.current) return;
    initializedRef.current = true;
    setInitialized(true);
    setEnabled((settings as any).collectionsEnabled !== false);
    const savedIntervals = (settings?.reminderIntervals as number[] | null) || [7, 14, 30];
    setIntervals(savedIntervals);
    const savedTones = ((settings as any).reminderTones as { stage: number; label: string; subject: string; body: string }[] | null) || [];
    setTones(
      [1, 2, 3].map((stage) => {
        const existing = savedTones.find((t) => t.stage === stage);
        return existing ?? {
          stage,
          label: STAGE_LABELS[stage - 1],
          subject: DEFAULT_SUBJECTS[stage - 1],
          body: DEFAULT_BODIES[stage - 1],
        };
      })
    );
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings", {
        collectionsEnabled: enabled,
        reminderIntervals: intervals,
        reminderTones: tones,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Collections settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const updateTone = (stage: number, field: "subject" | "body", value: string) => {
    setTones((prev) => prev.map((t) => (t.stage === stage ? { ...t, [field]: value } : t)));
  };

  return (
    <Card className="settings-card settings-collections">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Collections Agent
        </CardTitle>
        <CardDescription>
          Automatically chase overdue invoices via email and SMS on a configurable schedule
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Global toggle */}
        {initialized ? (
          <div className="flex items-center justify-between p-3 rounded-md border">
            <div>
              <p className="font-medium text-sm">Agent enabled</p>
              <p className="text-xs text-muted-foreground">When off, no automated reminders are sent</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canManage || !settings}
              aria-label="Enable automated payment reminders"
              data-testid="switch-collections-enabled"
            />
          </div>
        ) : <div className="h-14 rounded-xl bg-muted animate-pulse" aria-label="Loading reminder settings" />}

        {/* Reminder intervals */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">Payment reminders</p>
          <p className="text-xs text-muted-foreground">Choose the days past due for each reminder stage.</p>
          <div className="settings-reminder-chips" aria-label="Configured reminder stages">
            {!initialized && <div className="h-10 w-48 rounded-full bg-muted animate-pulse" aria-label="Loading configured reminders" />}
            {initialized && intervals.map((days, index) => {
              const tone = tones[index];
              const stage = tone?.stage ?? index + 1;
              const templateId = `reminder-template-${stage}`;
              return (
                <button
                  type="button"
                  key={`${index}-${stage}`}
                  className="settings-reminder-chip"
                  disabled={!canManage || !settings}
                  onClick={() => setExpandedStage(expandedStage === stage ? null : stage)}
                  aria-expanded={expandedStage === stage}
                  aria-controls={templateId}
                  aria-label={`Edit reminder after ${days} days${tone?.label ? `, ${tone.label}` : ""}`}
                  data-testid={`reminder-chip-${index + 1}`}
                >
                  <span className="settings-chip-days">{days} days</span>
                  <span>{tone?.label || `Stage ${index + 1}`}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Choose a reminder to edit its timing and message.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {initialized ? intervals.map((val, idx) => (
              <div key={idx} className="settings-field">
                <label htmlFor={`reminder-interval-${idx + 1}`} className="text-xs text-muted-foreground mb-1 block">{tones[idx]?.label || `Stage ${idx + 1}`}</label>
                <Input
                  id={`reminder-interval-${idx + 1}`}
                  type="number"
                  min={1}
                  value={val}
                  disabled={!canManage || !settings}
                  onChange={(e) => {
                    const n = parseInt(e.target.value);
                    setIntervals((prev) => {
                      const copy = [...prev];
                      copy[idx] = isNaN(n) ? val : n;
                      return copy;
                    });
                  }}
                  data-testid={`input-reminder-interval-${idx + 1}`}
                />
              </div>
            )) : [1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
          </div>
          <p className="text-xs text-muted-foreground">
            Available merge fields: <code className="rounded bg-muted px-1 text-xs">{"{{clientName}}"}</code>{" "}
            <code className="rounded bg-muted px-1 text-xs">{"{{invoiceNumber}}"}</code>{" "}
            <code className="rounded bg-muted px-1 text-xs">{"{{balance}}"}</code>{" "}
            <code className="rounded bg-muted px-1 text-xs">{"{{daysOverdue}}"}</code>{" "}
            <code className="rounded bg-muted px-1 text-xs">{"{{companyName}}"}</code>{" "}
            <code className="rounded bg-muted px-1 text-xs">{"{{paymentLink}}"}</code>
            <span className="block mt-1 text-xs text-muted-foreground">
              <strong>{"{{paymentLink}}"}</strong> inserts a clickable Pay Now link unique to that invoice (valid 30 days).
            </span>
          </p>
        </div>

        {/* Per-stage message templates */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Message templates per stage</p>
          {initialized ? tones.map((tone) => (
            <div key={tone.stage} className="border rounded-md overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedStage(expandedStage === tone.stage ? null : tone.stage)}
                disabled={!canManage || !settings}
                aria-expanded={expandedStage === tone.stage}
                aria-controls={`reminder-template-${tone.stage}`}
                data-testid={`button-expand-tone-${tone.stage}`}
              >
                <span>{tone.label || `Stage ${tone.stage}`}</span>
                {expandedStage === tone.stage ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              <div
                id={`reminder-template-${tone.stage}`}
                hidden={expandedStage !== tone.stage}
                className="px-3 pb-3 space-y-2 border-t"
              >
                <div className="settings-field mt-2">
                  <label htmlFor={`tone-subject-${tone.stage}`} className="text-xs text-muted-foreground mb-1 block">Email subject</label>
                  <Input
                    id={`tone-subject-${tone.stage}`}
                    value={tone.subject}
                    disabled={!canManage || !settings}
                    onChange={(e) => updateTone(tone.stage, "subject", e.target.value)}
                    data-testid={`input-tone-subject-${tone.stage}`}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor={`tone-body-${tone.stage}`} className="text-xs text-muted-foreground mb-1 block">Email body / SMS text</label>
                  <Textarea
                    id={`tone-body-${tone.stage}`}
                    value={tone.body}
                    disabled={!canManage || !settings}
                    onChange={(e) => updateTone(tone.stage, "body", e.target.value)}
                    className="min-h-28 font-mono text-xs"
                    data-testid={`textarea-tone-body-${tone.stage}`}
                  />
                </div>
              </div>
            </div>
          )) : <div className="h-12 rounded-xl bg-muted animate-pulse" aria-label="Loading reminder templates" />}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => { if (canManage && settings) saveMutation.mutate(); }}
            disabled={!canManage || !settings || !initialized || saveMutation.isPending}
            data-testid="button-save-collections-settings"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? "Saving…" : "Save Collections Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Display name ──────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState((user as any)?.displayName || "");
  const [displayNameSaved, setDisplayNameSaved] = useState(false);

  const updateDisplayNameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("PATCH", "/api/auth/profile", { displayName: name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setDisplayNameSaved(true);
      setTimeout(() => setDisplayNameSaved(false), 2000);
      toast({ title: "Name updated", description: "Your dashboard greeting has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update name.", variant: "destructive" });
    },
  });

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const { data: settings, isLoading, isError, refetch } = useQuery<Settings & { nextInboxSync?: string; lastInboxSync?: string | null }>({
    queryKey: ["/api/settings"],
  });

  const [copiedPhone, setCopiedPhone] = useState(false);
  const { data: smsConfig } = useQuery<{ phoneNumber: string | null }>({
    queryKey: ["/api/sms/config"],
  });

  const copyPhone = () => {
    if (smsConfig?.phoneNumber) {
      navigator.clipboard.writeText(smsConfig.phoneNumber);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    }
  };

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    values: {
      companyName: settings?.companyName || "",
      companyEmail: settings?.companyEmail || "",
      companyPhone: settings?.companyPhone || "",
      companyAddress: settings?.companyAddress || "",
      taxRate: settings?.taxRate?.toString() || "0",
      invoicePrefix: settings?.invoicePrefix || "INV",
      invoiceTerms: settings?.invoiceTerms || "",
      inboxSyncHour: settings?.inboxSyncHour ?? 8,
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: SettingsFormValues) => {
      const payload = {
        ...data,
        taxRate: parseFloat(data.taxRate || "0"),
        inboxSyncHour: data.inboxSyncHour ?? 8,
      };
      const res = await apiRequest("PATCH", "/api/settings", payload);
      return res.json();
    },
    onSuccess: (data, variables) => {
      const hour = variables.inboxSyncHour ?? 8;
      const nextInboxSync = computeNextSyncTime(hour).toISOString();
      queryClient.setQueryData(["/api/settings"], (old: (Settings & { nextInboxSync?: string }) | undefined) => ({
        ...old,
        ...data,
        nextInboxSync,
      }));
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings saved",
        description: "Your company settings have been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/sync/all");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Inbox synced",
        description: "The inbox was synced successfully for all connected users.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function computeNextSyncTime(hour: number, fromDate: Date = new Date()): Date {
    const next = new Date(fromDate);
    next.setHours(hour, 0, 0, 0);
    if (next <= fromDate) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  const watchedSyncHour = form.watch("inboxSyncHour");

  const liveNextSync = (() => {
    if (watchedSyncHour === null || watchedSyncHour === undefined || String(watchedSyncHour) === "") return null;
    const parsed = Number(watchedSyncHour);
    const hour = Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null;
    if (hour === null) return null;
    return computeNextSyncTime(hour, now);
  })();

  const canManageSettings = !!user?.isAdmin;

  const onSubmit = (data: SettingsFormValues) => {
    if (!canManageSettings || isError) return;
    updateSettingsMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="settings-page">
        <div className="mb-6">
          <h1 className="settings-heading">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your company information and preferences</p>
        </div>
        <SettingsSkeleton />
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="mb-6">
        <h1 className="settings-heading">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your company information and preferences</p>
      </div>

      {isError && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
          <p className="text-sm">Settings could not be loaded. Check your connection and try again.</p>
          <Button type="button" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      <Form {...form}>
        <form id="settings-company-form" onSubmit={form.handleSubmit(onSubmit)} className="settings-main-form">
          <fieldset disabled={!canManageSettings} className="settings-form-fields space-y-6">
          <Card className="settings-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Company Information
              </CardTitle>
              <CardDescription>
                This information will appear on your invoices
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem className="settings-field">
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your Painting Company" {...field} data-testid="input-company-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
                <FormField
                  control={form.control}
                  name="companyEmail"
                  render={({ field }) => (
                    <FormItem className="settings-field">
                      <FormLabel>Email</FormLabel>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <FormControl>
                          <Input type="email" placeholder="info@company.com" className="pl-9" {...field} data-testid="input-company-email" />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="companyPhone"
                  render={({ field }) => (
                    <FormItem className="settings-field">
                      <FormLabel>Phone</FormLabel>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <FormControl>
                          <Input placeholder="(555) 123-4567" className="pl-9" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} data-testid="input-company-phone" />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              <FormField
                control={form.control}
                name="companyAddress"
                render={({ field }) => (
                  <FormItem className="settings-field">
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <AddressAutocomplete
                        value={field.value || ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                        placeholder="Start typing a street address"
                        data-testid="input-company-address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          </fieldset>
        </form>

        {settings && <CollectionsAgentCard settings={settings} canManage={canManageSettings} />}

        <fieldset disabled={!canManageSettings} className="settings-form-fields space-y-6">

          <Card className="settings-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Invoice Settings
              </CardTitle>
              <CardDescription>
                Configure defaults for your invoices
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="invoicePrefix"
                  render={({ field }) => (
                    <FormItem className="settings-field">
                      <FormLabel>Invoice Number Prefix</FormLabel>
                      <FormControl>
                        <Input placeholder="INV" {...field} form="settings-company-form" data-testid="input-invoice-prefix" />
                      </FormControl>
                      <FormDescription>
                        Prefix for invoice numbers (e.g., INV-001)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="taxRate"
                  render={({ field }) => (
                    <FormItem className="settings-field">
                      <FormLabel>Default Tax Rate (%)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0" {...field} form="settings-company-form" data-testid="input-tax-rate" />
                      </FormControl>
                      <FormDescription>
                        Applied to new invoices by default
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="invoiceTerms"
                render={({ field }) => (
                  <FormItem className="settings-field">
                    <FormLabel>Default Terms & Conditions</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Payment is due within 30 days. Late payments may incur additional fees."
                        className="min-h-24"
                        {...field}
                        form="settings-company-form"
                        data-testid="input-invoice-terms"
                      />
                    </FormControl>
                    <FormDescription>
                      Added to all new invoices
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {user?.isAdmin && (
            <Card className="settings-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Inbox Sync Schedule
                </CardTitle>
                <CardDescription>
                  Configure when the daily Gmail inbox sync runs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="inboxSyncHour"
                  render={({ field }) => (
                    <FormItem className="settings-field max-w-xs">
                      <FormLabel>Inbox sync hour (0–23)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={23}
                          step={1}
                          placeholder="8"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            form.trigger("inboxSyncHour");
                          }}
                          onBlur={(e) => {
                            const raw = Number(e.target.value);
                            if (!Number.isNaN(raw) && e.target.value !== "") {
                              const clamped = Math.min(23, Math.max(0, Math.round(raw)));
                              field.onChange(clamped);
                            }
                            field.onBlur();
                            form.trigger("inboxSyncHour");
                          }}
                          data-testid="input-inbox-sync-hour"
                          form="settings-company-form"
                        />
                      </FormControl>
                      <FormDescription>
                        Hour of the day (server local time) when inbox auto-sync runs. Changes apply at the next scheduling cycle — no restart needed.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {liveNextSync && (
                  <p className="text-sm text-muted-foreground" data-testid="text-next-inbox-sync">
                    Next sync:{" "}
                    <span className="font-medium text-foreground">
                      {(() => {
                        const next = liveNextSync;
                        const isToday =
                          next.getFullYear() === now.getFullYear() &&
                          next.getMonth() === now.getMonth() &&
                          next.getDate() === now.getDate();
                        const timeStr = next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                        return isToday ? `today at ${timeStr}` : `tomorrow at ${timeStr}`;
                      })()}
                    </span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground" data-testid="text-last-inbox-sync">
                  Last synced:{" "}
                  {settings?.lastInboxSync ? (
                    <span className="font-medium text-foreground">
                      {(() => {
                        const last = new Date(settings.lastInboxSync!);
                        const diffMs = now.getTime() - last.getTime();
                        const diffMins = Math.floor(diffMs / 60000);
                        const diffHours = Math.floor(diffMins / 60);
                        if (diffMins < 1) return "just now";
                        if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
                        if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
                        const timeStr = last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                        const isToday =
                          last.getFullYear() === now.getFullYear() &&
                          last.getMonth() === now.getMonth() &&
                          last.getDate() === now.getDate();
                        return isToday ? `today at ${timeStr}` : last.toLocaleDateString([], { month: "short", day: "numeric" }) + ` at ${timeStr}`;
                      })()}
                    </span>
                  ) : (
                    <span className="font-medium text-muted-foreground">Never</span>
                  )}
                </p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={syncNowMutation.isPending}
                    onClick={() => syncNowMutation.mutate()}
                    data-testid="button-sync-now"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncNowMutation.isPending ? "animate-spin" : ""}`} />
                    {syncNowMutation.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              form="settings-company-form"
              disabled={!canManageSettings || updateSettingsMutation.isPending || isError}
              className="settings-primary"
              data-testid="button-save-settings"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
          </fieldset>
      </Form>

      <Card className="settings-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Your Profile
          </CardTitle>
          <CardDescription>How you'd like to be greeted on the dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 max-w-sm">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="settings-display-name" className="text-sm font-medium">Your name</label>
              <Input
                id="settings-display-name"
                placeholder="e.g. Sarah"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); updateDisplayNameMutation.mutate(displayName); } }}
              />
              <p className="text-xs text-muted-foreground">Shown in "Good morning, …" on the dashboard</p>
            </div>
            <Button
              type="button"
              onClick={() => updateDisplayNameMutation.mutate(displayName)}
              disabled={updateDisplayNameMutation.isPending}
              variant={displayNameSaved ? "outline" : "default"}
              className={`shrink-0 ${displayNameSaved ? "" : "settings-primary"}`}
            >
              {displayNameSaved ? <><Check className="h-4 w-4 mr-1" />Saved</> : <><Save className="h-4 w-4 mr-1" />Save</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <BusinessBankAccountCard canManage={canManageSettings} />

      {/* SMS Time Logging — shown to all users so they can share the number */}
      <Card className="settings-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            SMS Time Logging
          </CardTitle>
          <CardDescription>
            Employees can text their hours directly to this number — no app or login needed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {smsConfig?.phoneNumber ? (
            <>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm tracking-wider"
                  data-testid="text-sms-phone-number"
                >
                  {smsConfig.phoneNumber}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyPhone}
                  title="Copy number"
                  aria-label="Copy SMS phone number"
                  data-testid="button-copy-sms-phone"
                >
                  {copiedPhone ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="rounded-md bg-muted/60 p-3 text-sm space-y-1 text-muted-foreground">
                <p className="font-medium text-foreground">How employees log hours</p>
                <p>Text <code className="rounded bg-background px-1 py-0.5 text-xs font-mono">8</code> for 8 hours today</p>
                <p>Text <code className="rounded bg-background px-1 py-0.5 text-xs font-mono">7.5 painting fence</code> for 7.5 hours with a note</p>
                <p>Text <code className="rounded bg-background px-1 py-0.5 text-xs font-mono">HELP</code> anytime for a reminder</p>
                <p className="pt-1">Each employee's mobile number must be saved in their profile (Payroll → Employees) for the system to recognise them.</p>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground space-y-2" data-testid="text-sms-not-configured">
              <Phone className="mx-auto h-8 w-8 opacity-40" />
              <p className="font-medium">SMS not yet configured</p>
              <p>Add your <code className="rounded bg-muted px-1 text-xs font-mono">TWILIO_ACCOUNT_SID</code>, <code className="rounded bg-muted px-1 text-xs font-mono">TWILIO_AUTH_TOKEN</code>, and <code className="rounded bg-muted px-1 text-xs font-mono">TWILIO_PHONE_NUMBER</code> secrets, then point your Twilio number's incoming-SMS webhook to:</p>
              <code className="block rounded bg-muted px-2 py-1 text-xs font-mono break-all">
                https://your-domain.replit.app/api/sms/inbound
              </code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Only admins can manage invite codes */}
      {user?.isAdmin && <InvitePanel />}
    </div>
  );
}
