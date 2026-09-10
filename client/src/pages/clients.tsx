import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { formatPhone } from "@/lib/formatPhone";
import { Plus, Edit, FileText, Trash2, MoreVertical } from "lucide-react";
import { format } from "date-fns";
import type { Client } from "@shared/schema";

// ── Avatar color palette (4-color cycle) ─────────────────────────────────────
const AV_COLORS = [
  { bg: "#eef2fe", fg: "#2563eb" },
  { bg: "#e6f6fb", fg: "#0e7faf" },
  { bg: "#f3eafe", fg: "#7c3aed" },
  { bg: "#e7f7ee", fg: "#15a35a" },
];

function getAv(index: number) {
  return AV_COLORS[index % AV_COLORS.length];
}

// ── Initials helper ───────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const skip = new Set(["and", "the", "&", "of", "co", "company", "llc", "inc"]);
  const words = name.split(/\s+/).filter((w) => w && !skip.has(w.toLowerCase()));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// ── Form schema ───────────────────────────────────────────────────────────────
const clientFormSchema = z.object({
  name: z.string().min(1, "Client name is required"),
  generalContractorName: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  notes: z.string().optional(),
});

type ClientFormValues = z.infer<typeof clientFormSchema>;

interface ClientWithStats extends Client {
  activeJobs: number;
  outstandingBalance: number;
  lastInvoiceDate?: string | Date;
}

// ── Form styles ───────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = {
  display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b",
  textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "5px",
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1",
  borderRadius: "8px", fontSize: "13.5px", color: "#0f172a",
  background: "#fff", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

// ── ClientForm ────────────────────────────────────────────────────────────────
function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const { toast } = useToast();
  const isEdit = !!client;

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      name: client?.name || "",
      generalContractorName: client?.generalContractorName || "",
      email: client?.email || "",
      phone: client?.phone || "",
      address: client?.address || "",
      city: client?.city || "",
      state: client?.state || "",
      zipCode: client?.zipCode || "",
      notes: client?.notes || "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: ClientFormValues) => {
      const url = isEdit ? `/api/clients/${client.id}` : "/api/clients";
      const method = isEdit ? "PATCH" : "POST";
      const res = await apiRequest(method, url, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: isEdit ? "Client updated" : "Client created",
        description: `${form.getValues("name")} has been ${isEdit ? "updated" : "added"} successfully.`,
      });
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof ClientFormValues, {
            type: "server",
            message: Array.isArray(messages) ? messages[0] : String(messages),
          });
        });
        toast({ title: "Please fix the errors below", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <label style={lbl}>Client name *</label>
              <FormControl><input {...field} style={inp} placeholder="Company or person name" data-testid="input-client-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="generalContractorName" render={({ field }) => (
            <FormItem>
              <label style={lbl}>General contractor <span style={{ color: "#94a3b8", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
              <FormControl><input {...field} style={inp} placeholder="GC company name" data-testid="input-client-gc-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <label style={lbl}>Email</label>
              <FormControl><input {...field} type="email" style={inp} placeholder="email@example.com" data-testid="input-client-email" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem>
              <label style={lbl}>Phone</label>
              <FormControl><input {...field} style={inp} placeholder="(555) 123-4567" onChange={e => field.onChange(formatPhone(e.target.value))} data-testid="input-client-phone" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="address" render={({ field }) => (
          <FormItem>
            <label style={lbl}>Address</label>
            <FormControl>
              <AddressAutocomplete
                value={field.value || ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
                style={inp}
                placeholder="Start typing a street address"
                data-testid="input-client-address"
                onAddressSelect={(result) => {
                  form.setValue("address", result.streetAddress || result.formattedAddress, { shouldDirty: true });
                  form.setValue("city", result.city, { shouldDirty: true });
                  form.setValue("state", result.state, { shouldDirty: true });
                  form.setValue("zipCode", result.postalCode, { shouldDirty: true });
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="city" render={({ field }) => (
            <FormItem>
              <label style={lbl}>City</label>
              <FormControl><input {...field} style={inp} placeholder="City" data-testid="input-client-city" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="state" render={({ field }) => (
            <FormItem>
              <label style={lbl}>State</label>
              <FormControl><input {...field} style={inp} placeholder="NY" data-testid="input-client-state" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="zipCode" render={({ field }) => (
            <FormItem>
              <label style={lbl}>Zip</label>
              <FormControl><input {...field} style={inp} placeholder="10001" data-testid="input-client-zip" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <label style={lbl}>Notes</label>
            <FormControl>
              <textarea {...field} rows={3} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} placeholder="Additional notes about this client" data-testid="input-client-notes" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
          <button type="button" onClick={onClose} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-cancel-client">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending} style={{ padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: mutation.isPending ? 0.7 : 1 }} data-testid="button-save-client">
            {mutation.isPending ? "Saving…" : isEdit ? "Update client" : "Add client"}
          </button>
        </div>
      </form>
    </Form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Clients() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: clients, isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ["/api/clients"],
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      await apiRequest("DELETE", `/api/clients/${clientId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Client deleted", description: `"${deletingClient?.name}" has been deleted.` });
      setDeletingClient(null);
    },
    onError: () => {
      toast({ title: "Failed to delete client", variant: "destructive" });
    },
  });

  const openAdd = () => { setEditingClient(null); setIsDialogOpen(true); };
  const openEdit = (c: Client) => { setEditingClient(c); setIsDialogOpen(true); };

  const filteredClients = (clients ?? []).filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.email ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.phone ?? "").includes(searchQuery)
  );

  const totalOutstanding = (clients ?? []).reduce((s, c) => s + (c.outstandingBalance ?? 0), 0);
  const totalActiveJobs = (clients ?? []).reduce((s, c) => s + (c.activeJobs ?? 0), 0);

  const fmtMoney = (n: number) =>
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const fmtDate = (d?: string | Date | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "MMM d"); } catch { return "—"; }
  };

  return (
    <>
      {/* ── Add/Edit Dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { setIsDialogOpen(false); setEditingClient(null); } }}>
        <DialogContent className="max-w-lg !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>
              {editingClient ? "Edit client" : "Add new client"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <ClientForm
              client={editingClient || undefined}
              onClose={() => { setIsDialogOpen(false); setEditingClient(null); }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ── */}
      <AlertDialog open={!!deletingClient} onOpenChange={(o) => { if (!o) setDeletingClient(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>"{deletingClient?.name}"</strong> and all their associated data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-client">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingClient && deleteClientMutation.mutate(deletingClient.id)}
              disabled={deleteClientMutation.isPending}
              data-testid="button-confirm-delete-client"
            >
              {deleteClientMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Page body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px 40px" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>

          {/* ── Title row ── */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-.02em" }}>Clients</h2>
              <p style={{ margin: "5px 0 0", fontSize: "13.5px", color: "var(--faint)" }}>
                {clients
                  ? `${clients.length} client${clients.length !== 1 ? "s" : ""} · ${totalActiveJobs} with active jobs`
                  : "Loading…"}
              </p>
            </div>
            <button
              onClick={openAdd}
              style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 16px", fontSize: "13.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(37,99,235,.3)" }}
              data-testid="button-add-client"
            >
              <Plus style={{ width: "16px", height: "16px" }} />
              Add client
            </button>
          </div>

          {/* ── Stat strip ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px", marginBottom: "20px" }}>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Total clients</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-total-clients">
                {isLoading ? "—" : clients?.length ?? 0}
              </div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Outstanding (all)</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-outstanding">
                {isLoading ? "—" : fmtMoney(totalOutstanding)}
              </div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Active jobs</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-active-jobs">
                {isLoading ? "—" : totalActiveJobs}
              </div>
            </div>
          </div>

          {/* ── Search bar (above table, inline) ── */}
          <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "12px", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--track)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "7px 12px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                placeholder="Search clients…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ border: "none", background: "transparent", fontSize: "12.5px", color: "var(--fg)", outline: "none", width: "200px", fontFamily: "inherit" }}
                data-testid="input-search-clients"
              />
            </div>
          </div>

          {/* ── Table card ── */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>

            {/* Table header */}
            <div style={{ display: "flex", alignItems: "center", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" as const, color: "var(--faint)", padding: "11px 18px", background: "var(--track)", borderBottom: "1px solid var(--panel-bd)" }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }}>Client</span>
              <span style={{ width: "190px", flexShrink: 0 }}>Primary contact</span>
              <span style={{ width: "84px", flexShrink: 0, textAlign: "center" as const }}>Jobs</span>
              <span style={{ width: "116px", flexShrink: 0, textAlign: "right" as const }}>Outstanding</span>
              <span style={{ width: "100px", flexShrink: 0, textAlign: "right" as const }}>Last invoice</span>
              <span style={{ width: "28px", flexShrink: 0 }}></span>
            </div>

            {/* Loading state */}
            {isLoading && (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--faint)", fontSize: "13px" }}>
                Loading clients…
              </div>
            )}

            {/* Empty state */}
            {!isLoading && filteredClients.length === 0 && (
              <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                <div style={{ fontSize: "32px", marginBottom: "10px" }}>👥</div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>
                  {searchQuery ? "No matching clients" : "No clients yet"}
                </div>
                <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>
                  {searchQuery ? "Try a different search term" : "Add your first client to get started"}
                </div>
                {!searchQuery && (
                  <button
                    onClick={openAdd}
                    style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    data-testid="button-add-first-client"
                  >
                    <Plus style={{ width: "15px", height: "15px" }} /> Add client
                  </button>
                )}
              </div>
            )}

            {/* Rows */}
            {!isLoading && filteredClients.map((client, i) => {
              const av = getAv(i);
              const initials = getInitials(client.name);
              const meta = [client.city, client.state].filter(Boolean).join(", ");
              const hasBalance = (client.outstandingBalance ?? 0) > 0;
              return (
                <div
                  key={client.id}
                  className="rowhover"
                  style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: "1px solid var(--panel-bd)" }}
                  data-testid={`row-client-${client.id}`}
                >
                  {/* Avatar + name */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", paddingRight: "12px" }}>
                    <div
                      style={{ width: "38px", height: "38px", borderRadius: "9px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", background: av.bg, color: av.fg }}
                      aria-hidden="true"
                    >
                      {initials}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {client.name}
                      </div>
                      {(meta || client.generalContractorName) && (
                        <div style={{ fontSize: "11.5px", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {client.generalContractorName ? `via ${client.generalContractorName}` : meta}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Primary contact */}
                  <div style={{ width: "190px", flexShrink: 0, minWidth: 0, paddingRight: "10px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--fg)" }}>
                      {client.phone ? formatPhone(client.phone) : "—"}
                    </div>
                    {client.email && (
                      <div style={{ fontSize: "11px", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {client.email}
                      </div>
                    )}
                  </div>

                  {/* Jobs badge */}
                  <div style={{ width: "84px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: "12px", fontWeight: 600, padding: "2px 9px", borderRadius: "6px",
                        background: (client.activeJobs ?? 0) > 0 ? "#eef2fe" : "var(--track)",
                        color: (client.activeJobs ?? 0) > 0 ? "#2563eb" : "var(--faint)",
                      }}
                      data-testid={`jobs-count-${client.id}`}
                    >
                      {client.activeJobs ?? 0}
                    </span>
                  </div>

                  {/* Outstanding */}
                  <span
                    className="font-mono"
                    style={{ width: "116px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600, color: hasBalance ? "var(--fg)" : "var(--faint)" }}
                    data-testid={`outstanding-${client.id}`}
                  >
                    {hasBalance ? fmtMoney(client.outstandingBalance) : "—"}
                  </span>

                  {/* Last invoice */}
                  <span
                    className="font-mono"
                    style={{ width: "100px", flexShrink: 0, textAlign: "right", fontSize: "12px", color: "var(--faint)" }}
                    data-testid={`last-invoice-${client.id}`}
                  >
                    {fmtDate(client.lastInvoiceDate)}
                  </span>

                  {/* Actions — dropdown masquerading as chevron */}
                  <span style={{ width: "28px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "4px 0", display: "flex", alignItems: "center" }}
                          data-testid={`button-client-actions-${client.id}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={4}>
                        <DropdownMenuItem onClick={() => openEdit(client)} data-testid={`button-edit-client-${client.id}`}>
                          <Edit className="h-4 w-4 mr-2" />Edit client
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/invoices/new?clientId=${client.id}`} data-testid={`button-create-invoice-${client.id}`}>
                            <FileText className="h-4 w-4 mr-2" />Create invoice
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingClient(client)}
                          data-testid={`button-delete-client-${client.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              );
            })}

            {/* Footer count */}
            {!isLoading && filteredClients.length > 0 && (
              <div style={{ padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                  {searchQuery
                    ? `${filteredClients.length} of ${clients?.length ?? 0} clients`
                    : `${filteredClients.length} client${filteredClients.length !== 1 ? "s" : ""}`}
                </span>
                <button
                  onClick={openAdd}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--jox-primary)", borderRadius: "8px", padding: "6px 14px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  data-testid="button-add-client-footer"
                >
                  <Plus style={{ width: "13px", height: "13px" }} />Add client
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
