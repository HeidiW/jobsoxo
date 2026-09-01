import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Form, FormControl, FormField, FormItem, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { formatPhone } from "@/lib/formatPhone";
import { positiveNumericField } from "@/lib/positive-numeric-field";
import { Plus, FileText, Save, Send, Search } from "lucide-react";
import { format, addDays } from "date-fns";
import type { Client, Job, Settings } from "@shared/schema";
import { Link } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedLineItem {
  description: string;
  refs?: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  category: "materials" | "labor" | "square_footage" | "other";
  section?: string;
}

interface ParsedDocument {
  lineItems: ParsedLineItem[];
  dueDate?: string;
  taxRate?: number;
  notes?: string;
  confidence: "high" | "medium" | "low";
  message?: string;
  sourceTitle?: string;
}

interface GoogleDocsStatus {
  connected: boolean;
  email: string | null;
}

interface GoogleDocSummary {
  id: string;
  name: string;
  modifiedTime: string | null;
  webViewLink: string | null;
}

export const lineItemSchema = z.object({
  category: z.enum(["materials", "labor", "square_footage", "other"]),
  description: z.string().min(1, "Description is required"),
  quantity: positiveNumericField("Quantity"),
  unit: z.string().min(1, "Unit is required"),
  rate: positiveNumericField("Rate"),
  amount: positiveNumericField("Amount"),
}).superRefine((data, ctx) => {
  const qty = parseFloat(data.quantity), rate = parseFloat(data.rate), amount = parseFloat(data.amount);
  if (!isNaN(qty) && !isNaN(rate) && !isNaN(amount)) {
    const expected = qty * rate;
    if (Math.abs(amount - expected) > 0.001) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Amount must equal qty × rate (expected ${expected.toFixed(2)})`, path: ["amount"] });
    }
  }
});

const invoiceFormSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  jobId: z.string().optional(),
  issueDate: z.string().min(1, "Issue date is required"),
  dueDate: z.string().min(1, "Due date is required"),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  taxRate: z.string().optional(),
});

type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;
type LineItemFormValues = z.infer<typeof lineItemSchema>;

interface NewLineItem extends Omit<LineItemFormValues, "quantity" | "rate" | "amount"> {
  id: string;
  quantity: number;
  rate: number;
  amount: number;
  refs?: string;
  section?: string;
  hasQty?: boolean;
}

// ── Shared style helpers ─────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1",
  borderRadius: "8px", fontSize: "13.5px", color: "#0f172a",
  background: "#fff", fontFamily: "inherit", outline: "none",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b",
  textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "5px",
};
const sectionCardStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid #e2e8f0", borderRadius: "14px",
  padding: "18px", boxShadow: "0 1px 2px rgba(15,23,42,.04)",
};

function SectionTitle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
      <span style={{ width: "6px", height: "16px", borderRadius: "3px", background: color, flexShrink: 0 }} />
      <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, letterSpacing: "-.01em", color: "#0f172a" }}>
        {children}
      </h3>
    </div>
  );
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

// ── Live Invoice Preview ─────────────────────────────────────────────────────

function InvoicePreview({
  settings, client, job, lineItems, issueDate, dueDate, notes, termsAndConditions, taxRate,
}: {
  settings?: Settings;
  client?: Client;
  job?: (Job & { client: Client }) | null;
  lineItems: NewLineItem[];
  issueDate: string;
  dueDate: string;
  notes: string;
  termsAndConditions: string;
  taxRate: number;
}) {
  const subtotal = lineItems.reduce((s, i) => s + i.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const sectionOrder = [...new Set(lineItems.map(i => i.section || "General"))];
  const bySec = sectionOrder.reduce<Record<string, NewLineItem[]>>((acc, sec) => {
    acc[sec] = lineItems.filter(i => (i.section || "General") === sec);
    return acc;
  }, {});

  const mono: React.CSSProperties = { fontFamily: "ui-monospace,Menlo,monospace" };
  const lbl: React.CSSProperties = {
    fontSize: "10px", fontWeight: 800, color: "#94a3b8",
    textTransform: "uppercase" as const, letterSpacing: ".08em", marginBottom: "6px",
  };

  const fmtDate = (d: string) => {
    try { return format(new Date(d + "T12:00:00"), "MMMM d, yyyy"); }
    catch { return d; }
  };

  return (
    <div style={{
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      background: "#fff",
      borderRadius: "6px",
      boxShadow: "0 8px 30px rgba(15,23,42,.14)",
      padding: "40px 48px",
    }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "24px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>
            {settings?.companyName || <span style={{ color: "#cbd5e1" }}>Your Company</span>}
          </div>
          {settings?.companyAddress && (
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "5px", lineHeight: 1.6, whiteSpace: "pre-line" }}>
              {settings.companyAddress}
            </div>
          )}
          {(settings?.companyEmail || settings?.companyPhone) && (
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "3px", lineHeight: 1.6 }}>
              {[settings?.companyEmail, settings?.companyPhone ? formatPhone(settings.companyPhone) : null].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "26px", fontWeight: 800, letterSpacing: ".06em", color: "#2563eb" }}>INVOICE</div>
          <div style={{ fontSize: "13px", ...mono, color: "#94a3b8", marginTop: "6px" }}>Draft</div>
          {issueDate && (
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "8px" }}>
              Issued&nbsp;&nbsp;<span style={{ color: "#0f172a", fontWeight: 600 }}>{fmtDate(issueDate)}</span>
            </div>
          )}
          {dueDate && (
            <div style={{ fontSize: "11.5px", color: "#64748b" }}>
              Due&nbsp;&nbsp;<span style={{ color: "#0f172a", fontWeight: 600 }}>{fmtDate(dueDate)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Grey divider */}
      <div style={{ height: "1px", background: "#e2e8f0", margin: "22px 0" }} />

      {/* ── Bill To / Project Site ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div>
          <div style={lbl}>Bill to</div>
          {client ? (
            <>
              <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#0f172a" }}>{client.name}</div>
              {client.address && (
                <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6, marginTop: "2px" }}>
                  {client.address}{client.city && `, ${client.city}`}{client.state && `, ${client.state}`}{client.zipCode && ` ${client.zipCode}`}
                </div>
              )}
              {client.email && <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>{client.email}</div>}
              {client.phone && <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>{formatPhone(client.phone)}</div>}
            </>
          ) : (
            <div style={{ fontSize: "13px", color: "#cbd5e1" }}>Select a client</div>
          )}
        </div>
        <div>
          <div style={lbl}>Project / site</div>
          {job ? (
            <>
              <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#0f172a" }}>{job.title}</div>
              {job.address && <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6, marginTop: "2px" }}>{job.address}</div>}
              {(() => {
                const codes = (job.referenceCodes as { label: string; code: string }[] | null | undefined) ?? [];
                const nonEmpty = codes.filter(c => c.code?.trim());
                return nonEmpty.length > 0 ? (
                  <div style={{ marginTop: "6px" }}>
                    {nonEmpty.map((c, i) => (
                      <div key={i} style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>
                        <span style={{ fontWeight: 600, color: "#475569" }}>{c.label}:</span>{" "}
                        <span style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>{c.code}</span>
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
            </>
          ) : (
            <div style={{ fontSize: "13px", color: "#cbd5e1" }}>Link a job (optional)</div>
          )}
        </div>
      </div>

      {/* Notes */}
      {notes && (
        <div style={{ marginTop: "18px", fontSize: "12.5px", color: "#475569", fontStyle: "italic", lineHeight: 1.6, borderLeft: "3px solid #dbeafe", paddingLeft: "12px" }}>
          {notes}
        </div>
      )}

      {/* ── Line items ── */}
      <div style={{ marginTop: "24px" }}>
        {/* Column header */}
        <div style={{ display: "flex", fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em", paddingBottom: "8px", borderBottom: "2px solid #0f172a" }}>
          <span style={{ flex: 1 }}>Description</span>
          <span style={{ width: "70px", textAlign: "right" }}>Qty</span>
          <span style={{ width: "110px", textAlign: "right" }}>Amount</span>
        </div>

        {lineItems.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "#cbd5e1", fontSize: "13px" }}>
            Line items will appear here
          </div>
        ) : (
          sectionOrder.map(sec => {
            const items = bySec[sec];
            const secTotal = items.reduce((s, i) => s + i.amount, 0);
            return (
              <div key={sec}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "13px 0 6px", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontSize: "12px", fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: ".03em" }}>{sec}</span>
                  <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", ...mono }}>{formatCurrency(secTotal)}</span>
                </div>
                {items.map(item => (
                  <div key={item.id} style={{ display: "flex", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f8fafc" }}>
                    <div style={{ flex: 1, paddingRight: "12px" }}>
                      <div style={{ fontSize: "12.5px", color: "#0f172a", lineHeight: 1.45 }}>
                        {item.description || <span style={{ color: "#cbd5e1" }}>No description</span>}
                      </div>
                      {item.refs && (
                        <div style={{ fontSize: "10.5px", color: "#2563eb", ...mono, marginTop: "2px" }}>{item.refs}</div>
                      )}
                    </div>
                    <div style={{ width: "70px", textAlign: "right", fontSize: "11.5px", color: "#64748b", ...mono }}>
                      {item.hasQty === false || !item.quantity ? "—" : `${item.quantity} ${item.unit}`}
                    </div>
                    <div style={{ width: "110px", textAlign: "right", fontSize: "12.5px", fontWeight: 600, color: "#0f172a", ...mono }}>
                      {formatCurrency(item.amount)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* ── Totals ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "22px" }}>
        <div style={{ width: "300px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
            <span>Subtotal</span>
            <span style={{ ...mono, color: "#0f172a" }}>{formatCurrency(subtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
            <span>Tax ({taxRate}%)</span>
            <span style={{ ...mono, color: "#0f172a" }}>{formatCurrency(taxAmount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", fontWeight: 800, color: "#0f172a", paddingTop: "9px", borderTop: "2px solid #0f172a" }}>
            <span>Total</span>
            <span style={mono}>{formatCurrency(total)}</span>
          </div>
        </div>
      </div>

      {/* Bottom divider */}
      <div style={{ height: "1px", background: "#e2e8f0", margin: "24px 0 18px" }} />

      {/* Terms */}
      {termsAndConditions && (
        <div>
          <div style={lbl}>Terms &amp; Conditions</div>
          <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>{termsAndConditions}</div>
        </div>
      )}
    </div>
  );
}

// ── Line Item Form ───────────────────────────────────────────────────────────

function LineItemForm({ onSubmit, onCancel }: { onSubmit: (data: LineItemFormValues) => void; onCancel: () => void }) {
  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    defaultValues: { category: "labor", description: "", quantity: "", unit: "hours", rate: "", amount: "" },
  });

  const quantity = parseFloat(form.watch("quantity") || "0");
  const rate = parseFloat(form.watch("rate") || "0");
  const category = form.watch("category");

  useEffect(() => {
    if (category === "labor") form.setValue("unit", "hours");
    else if (category === "materials") form.setValue("unit", "each");
    else if (category === "square_footage") form.setValue("unit", "sqft");
  }, [category, form]);

  useEffect(() => {
    if (!isNaN(quantity) && !isNaN(rate) && quantity > 0 && rate > 0) {
      form.setValue("amount", (quantity * rate).toFixed(2));
    }
  }, [quantity, rate, form]);

  const cat = [
    { value: "labor", label: "Labor" },
    { value: "materials", label: "Materials" },
    { value: "square_footage", label: "Square Footage" },
    { value: "other", label: "Other" },
  ];
  const units = ["hours", "each", "sqft", "gallon", "linear_ft", "flat"];

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={labelStyle}>Category</label>
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger style={inputStyle} data-testid="select-li-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {cat.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <FormField control={form.control} name="unit" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger style={inputStyle} data-testid="select-li-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <input {...field} spellCheck={true} placeholder="e.g. Skim and paint feature wall" style={inputStyle} data-testid="input-li-description" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
            <div>
              <label style={labelStyle}>Quantity</label>
              <FormField control={form.control} name="quantity" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <input {...field} type="number" step="0.01" placeholder="0" style={inputStyle} data-testid="input-li-quantity" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div>
              <label style={labelStyle}>Rate ($)</label>
              <FormField control={form.control} name="rate" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <input {...field} type="number" step="0.01" placeholder="0.00" style={inputStyle} data-testid="input-li-rate" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div>
              <label style={labelStyle}>Amount ($)</label>
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <input {...field} type="number" step="0.01" placeholder="0.00" style={{ ...inputStyle, background: "#f1f5f9" }} data-testid="input-li-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
            <button type="button" onClick={onCancel} style={{ padding: "8px 14px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
            <button type="submit" style={{ padding: "8px 16px", border: "none", background: "#2563eb", borderRadius: "8px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-save-line-item">
              Add Item
            </button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type ViewMode = "split" | "tabbed" | "builder";
type TabSection = "details" | "items" | "totals";

export default function InvoiceNew() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const preselectedClientId = searchParams.get("clientId") || "";
  const preselectedJobId = searchParams.get("jobId") || "";

  const { toast } = useToast();
  const [lineItems, setLineItems] = useState<NewLineItem[]>([]);
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({});
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [importSource, setImportSource] = useState<"manual" | "pdf" | "google_doc">("manual");
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectedParsedItems, setSelectedParsedItems] = useState<Set<number>>(new Set());
  const [showGoogleDocsDialog, setShowGoogleDocsDialog] = useState(false);
  const [googleDocsSearch, setGoogleDocsSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [activeTab, setActiveTab] = useState<TabSection>("details");

  const { data: clients } = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  const { data: jobs } = useQuery<(Job & { client: Client })[]>({ queryKey: ["/api/jobs"] });
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const googleDocsStatusQuery = useQuery<GoogleDocsStatus>({
    queryKey: ["/api/google-docs/status"],
  });
  const googleDocsDocumentsQuery = useQuery<GoogleDocSummary[]>({
    queryKey: ["/api/google-docs/documents"],
    enabled: showGoogleDocsDialog && googleDocsStatusQuery.data?.connected === true,
  });

  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      clientId: preselectedClientId,
      jobId: preselectedJobId,
      issueDate: format(new Date(), "yyyy-MM-dd"),
      dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
      notes: "",
      termsAndConditions: settings?.invoiceTerms || "Payment is due within 30 days. Late payments may incur additional fees.",
      taxRate: "0",
    },
  });

  const selectedClientId = form.watch("clientId");
  const selectedJobId = form.watch("jobId");
  const taxRate = parseFloat(form.watch("taxRate") || "0");
  const notes = form.watch("notes") || "";
  const termsAndConditions = form.watch("termsAndConditions") || "";
  const issueDate = form.watch("issueDate");
  const dueDate = form.watch("dueDate");

  useEffect(() => {
    if (preselectedJobId && jobs) {
      const job = jobs.find((j) => j.id === preselectedJobId);
      if (job) form.setValue("clientId", job.clientId);
    }
  }, [preselectedJobId, jobs, form]);

  useEffect(() => {
    const connected = searchParams.get("google_docs_connected");
    const error = searchParams.get("google_docs_error");
    if (!connected && !error) return;

    if (connected) {
      queryClient.invalidateQueries({ queryKey: ["/api/google-docs/status"] });
      trackEvent("google_docs_connected", { location: "invoice_builder" });
      setShowGoogleDocsDialog(true);
      toast({ title: "Google Docs connected", description: "Choose a document to import." });
    } else if (error && error !== "access_denied") {
      toast({
        title: "Could not connect Google Docs",
        description: error === "invalid_state"
          ? "The connection request expired. Please try again."
          : decodeURIComponent(error),
        variant: "destructive",
      });
    }
    window.history.replaceState({}, "", "/invoices/new");
  // Handle the OAuth return query only once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredJobs = jobs;
  const selectedClient = clients?.find((c) => c.id === selectedClientId);
  const selectedJob = selectedJobId ? jobs?.find((j) => j.id === selectedJobId) : null;

  const subtotal = lineItems.reduce((s, i) => s + i.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: { formData: InvoiceFormValues; send: boolean }) => {
      const payload = {
        ...data.formData,
        taxRate: parseFloat(data.formData.taxRate || "0"),
        subtotal, taxAmount, total, balance: total,
        lineItems: lineItems.map(({ id: _id, hasQty, ...item }) => ({
          ...item,
          quantity: hasQty === false ? 1 : item.quantity,
          unit:     hasQty === false ? "lump" : item.unit,
          rate:     hasQty === false ? item.amount : item.rate,
        })),
        send: data.send,
      };
      const res = await apiRequest("POST", "/api/invoices", payload);
      return res.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      trackEvent("invoice_created", {
        delivery: vars.send ? "sent" : "draft",
        import_source: importSource,
        item_count: lineItems.length,
      });
      toast({ title: "Invoice created", description: `Invoice ${data.invoiceNumber} has been created.` });
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof InvoiceFormValues, { type: "server", message: Array.isArray(messages) ? messages[0] : String(messages) });
        });
        toast({ title: "Please fix the errors below", variant: "destructive" });
      } else {
        toast({ title: "Error creating invoice", description: error.message, variant: "destructive" });
      }
    },
  });

  const parseDocumentMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoices/parse-document", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed to parse document"); }
      return res.json() as Promise<ParsedDocument>;
    },
    onSuccess: (data) => {
      if (data.lineItems.length === 0) {
        toast({ title: "No line items found", description: data.message ?? "Try a different file.", variant: "destructive" });
        return;
      }
      setImportSource("pdf");
      setParsedDoc(data);
      setSelectedParsedItems(new Set(data.lineItems.map((_, i) => i)));
      setShowImportDialog(true);
    },
    onError: (err: Error) => { toast({ title: "Parse failed", description: err.message, variant: "destructive" }); },
  });

  const parseGoogleDocMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const res = await apiRequest("POST", "/api/invoices/parse-google-doc", { documentId });
      return res.json() as Promise<ParsedDocument>;
    },
    onSuccess: (data) => {
      if (data.lineItems.length === 0) {
        toast({
          title: "No line items found",
          description: data.message ?? "Try a different Google Doc.",
          variant: "destructive",
        });
        return;
      }
      setImportSource("google_doc");
      setParsedDoc(data);
      setSelectedParsedItems(new Set(data.lineItems.map((_, i) => i)));
      setShowGoogleDocsDialog(false);
      setShowImportDialog(true);
    },
    onError: (error: Error) => {
      if (/not connected|expired|reconnect/i.test(error.message)) {
        queryClient.invalidateQueries({ queryKey: ["/api/google-docs/status"] });
      }
      toast({ title: "Google Doc import failed", description: error.message, variant: "destructive" });
    },
  });

  const openGoogleDocsImport = () => {
    if (googleDocsStatusQuery.data?.connected) {
      setShowGoogleDocsDialog(true);
      return;
    }
    window.location.assign("/api/google-docs/auth?returnTo=/invoices/new");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File must be under 10 MB", variant: "destructive" });
      e.target.value = "";
      return;
    }
    parseDocumentMutation.mutate(file);
    e.target.value = "";
  };

  const applyParsedItems = () => {
    if (!parsedDoc) return;
    const toAdd: NewLineItem[] = parsedDoc.lineItems.filter((_, i) => selectedParsedItems.has(i)).map((item) => ({ id: crypto.randomUUID(), ...item }));
    setLineItems((prev) => [...prev, ...toAdd]);
    if (parsedDoc.dueDate) form.setValue("dueDate", parsedDoc.dueDate);
    if (parsedDoc.taxRate !== undefined) form.setValue("taxRate", String(parsedDoc.taxRate));
    if (parsedDoc.notes) form.setValue("notes", parsedDoc.notes);
    trackEvent("invoice_import_applied", {
      source: importSource,
      item_count: toAdd.length,
    });
    setShowImportDialog(false);
    setParsedDoc(null);
    toast({ title: `Imported ${toAdd.length} item${toAdd.length !== 1 ? "s" : ""}` });
  };

  const updateParsedItem = (index: number, updates: Partial<ParsedLineItem>) => {
    setParsedDoc((current) => {
      if (!current) return current;
      return {
        ...current,
        lineItems: current.lineItems.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...updates } : item
        ),
      };
    });
  };

  const filteredGoogleDocs = (googleDocsDocumentsQuery.data ?? []).filter((document) =>
    document.name.toLowerCase().includes(googleDocsSearch.trim().toLowerCase())
  );

  const updateItem = (id: string, updates: Partial<NewLineItem>) =>
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));

  const removeItem = (id: string) =>
    setLineItems(prev => prev.filter(i => i.id !== id));

  const addItemToSection = (sec: string) =>
    setLineItems(prev => [...prev, {
      id: crypto.randomUUID(), description: "", refs: "", quantity: 1, unit: "lump",
      rate: 0, amount: 0, category: "labor" as const, section: sec || undefined, hasQty: true,
    }]);

  const renameSection = (oldSec: string, newSec: string) =>
    setLineItems(prev => prev.map(i => (i.section || "General") === oldSec ? { ...i, section: newSec } : i));

  const deleteSection = (sec: string) =>
    setLineItems(prev => prev.filter(i => (i.section || "General") !== sec));

  const addSection = () => {
    const existing = [...new Set(lineItems.map(i => i.section || "General"))];
    addItemToSection(`Section ${existing.length + 1}`);
  };

  const toggleSection = (sec: string) =>
    setSectionsOpen(prev => ({ ...prev, [sec]: !(prev[sec] !== false) }));

  const onSubmit = (data: InvoiceFormValues, send = false) => {
    if (lineItems.length === 0) {
      toast({ title: "No line items", description: "Add at least one line item to the invoice.", variant: "destructive" });
      return;
    }
    createInvoiceMutation.mutate({ formData: data, send });
  };

  // ── Toggle button helper ──────────────────────────────────────────────────

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", border: "none", borderRadius: "8px", fontSize: "12.5px",
    fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all .15s",
    background: active ? "#fff" : "transparent",
    color: active ? "#0f172a" : "#94a3b8",
    boxShadow: active ? "0 1px 3px rgba(15,23,42,.12)" : "none",
  });

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "8px", border: "none", borderRadius: "8px",
    fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    background: active ? "#fff" : "transparent",
    color: active ? "#0f172a" : "#94a3b8",
    boxShadow: active ? "0 1px 3px rgba(15,23,42,.10)" : "none",
  });

  const showDetails = viewMode !== "tabbed" || activeTab === "details";
  const showItems = viewMode !== "tabbed" || activeTab === "items";
  const showTotals = viewMode !== "tabbed" || activeTab === "totals";
  const showPreview = viewMode === "split";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f1f5f9", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: "#0f172a" }}>

      {/* ── Header ── */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "11px 22px", background: "#fff", borderBottom: "1px solid #e2e8f0", flexShrink: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: "170px" }}>
          <div style={{ width: "34px", height: "34px", borderRadius: "9px", background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "17px", flexShrink: 0 }}>J</div>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 800, letterSpacing: "-.01em" }}>JobsOxo</div>
            <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600, marginTop: "1px" }}>Create Invoice</div>
          </div>
        </div>

        {/* View toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "3px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: "11px", padding: "4px" }}>
          <button onClick={() => setViewMode("split")} style={toggleBtnStyle(viewMode === "split")}>Split view</button>
          <button onClick={() => setViewMode("tabbed")} style={toggleBtnStyle(viewMode === "tabbed")}>Tabbed</button>
          <button onClick={() => setViewMode("builder")} style={toggleBtnStyle(viewMode === "builder")}>Builder</button>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: "170px", justifyContent: "flex-end" }}>
          <button
            onClick={form.handleSubmit((d) => onSubmit(d, false))}
            disabled={createInvoiceMutation.isPending}
            style={{ padding: "8px 14px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}
            data-testid="button-save-draft"
          >
            <Save style={{ display: "inline", width: "14px", height: "14px", marginRight: "6px", verticalAlign: "middle", marginTop: "-2px" }} />
            Save draft
          </button>
          <button
            onClick={form.handleSubmit((d) => onSubmit(d, true))}
            disabled={createInvoiceMutation.isPending}
            style={{ padding: "8px 16px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}
            data-testid="button-send-invoice"
          >
            <Send style={{ display: "inline", width: "14px", height: "14px", marginRight: "6px", verticalAlign: "middle", marginTop: "-2px" }} />
            Send invoice
          </button>
        </div>
      </header>

      {/* ── Document import strip ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "9px 22px", background: "#eff6ff", borderBottom: "1px solid #dbeafe", flexShrink: 0 }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#2563eb", flexShrink: 0 }} />
        <span style={{ fontSize: "12.5px", color: "#1e40af", fontWeight: 600 }}>Import a quote or invoice to review and add its sections and line items.</span>
        <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }} onChange={handleFileChange} data-testid="input-document-upload" />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={parseDocumentMutation.isPending}
          style={{ marginLeft: "auto", padding: "6px 13px", border: "1px solid #93c5fd", background: "#fff", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, color: "#1d4ed8", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}
          data-testid="button-import-document"
        >
          <FileText style={{ width: "13px", height: "13px" }} />
          {parseDocumentMutation.isPending ? "Parsing…" : "Choose PDF"}
        </button>
        <button
          onClick={openGoogleDocsImport}
          disabled={googleDocsStatusQuery.isLoading}
          style={{ padding: "6px 13px", border: "1px solid #93c5fd", background: "#fff", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, color: "#1d4ed8", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}
          data-testid="button-import-google-doc"
        >
          <FileText style={{ width: "13px", height: "13px" }} />
          Import from Google Doc
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: Form */}
        <div style={{ overflowY: "auto", padding: "20px 22px 80px", borderRight: showPreview ? "1px solid #e2e8f0" : "none", width: showPreview ? "52%" : "100%", maxWidth: showPreview ? "52%" : "760px", margin: showPreview ? "0" : "0 auto" }}>
          <Form {...form}>
            <form style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

              {/* ── Tabbed nav ── */}
              {viewMode === "tabbed" && (
                <div style={{ display: "flex", gap: "4px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "11px", padding: "4px", position: "sticky", top: "-20px", zIndex: 8 }}>
                  <button type="button" onClick={() => setActiveTab("details")} style={tabStyle(activeTab === "details")}>1 · Details</button>
                  <button type="button" onClick={() => setActiveTab("items")} style={tabStyle(activeTab === "items")}>2 · Line items</button>
                  <button type="button" onClick={() => setActiveTab("totals")} style={tabStyle(activeTab === "totals")}>3 · Totals &amp; Terms</button>
                </div>
              )}

              {/* ── From — your business ── */}
              {showDetails && (
                <div style={sectionCardStyle}>
                  <SectionTitle color="#2563eb">From — your business</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "12px 14px" }}>
                    <div style={{ gridColumn: "1/-1" }}>
                      <label style={labelStyle}>Business name</label>
                      <div style={{ ...inputStyle, background: "#f8fafc", color: settings?.companyName ? "#0f172a" : "#94a3b8", fontWeight: 700 }}>
                        {settings?.companyName || "Not set — update in Settings"}
                      </div>
                    </div>
                    <div style={{ gridColumn: "1/-1" }}>
                      <label style={labelStyle}>Address</label>
                      <div style={{ ...inputStyle, background: "#f8fafc", color: settings?.companyAddress ? "#0f172a" : "#94a3b8", minHeight: "60px", whiteSpace: "pre-line" }}>
                        {settings?.companyAddress || "—"}
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <div style={{ ...inputStyle, background: "#f8fafc", color: settings?.companyEmail ? "#0f172a" : "#94a3b8" }}>
                        {settings?.companyEmail || "—"}
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Phone</label>
                      <div style={{ ...inputStyle, background: "#f8fafc", color: settings?.companyPhone ? "#0f172a" : "#94a3b8" }}>
                        {settings?.companyPhone ? formatPhone(settings.companyPhone) : "—"}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: "10px" }}>
                    <Link href="/settings" style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>
                      Edit business details in Settings →
                    </Link>
                  </div>
                </div>
              )}

              {/* ── Bill to + Project side by side ── */}
              {showDetails && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "16px" }}>
                  {/* Bill to */}
                  <div style={sectionCardStyle}>
                    <SectionTitle color="#0ea5e9">Bill to — client</SectionTitle>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div>
                        <label style={labelStyle}>Client / company *</label>
                        <FormField control={form.control} name="clientId" render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger style={inputStyle} data-testid="select-invoice-client">
                                  <SelectValue placeholder="Select client" />
                                </SelectTrigger>
                                <SelectContent>
                                  {clients?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      {selectedClient && (
                        <>
                          {selectedClient.address && (
                            <div>
                              <label style={labelStyle}>Billing address</label>
                              <div style={{ ...inputStyle, background: "#f8fafc", fontSize: "13px", color: "#475569", minHeight: "44px" }}>
                                {selectedClient.address}{selectedClient.city && `, ${selectedClient.city}`}{selectedClient.state && `, ${selectedClient.state}`}
                              </div>
                            </div>
                          )}
                          {selectedClient.email && (
                            <div>
                              <label style={labelStyle}>Email</label>
                              <div style={{ ...inputStyle, background: "#f8fafc", fontSize: "13px", color: "#475569" }}>{selectedClient.email}</div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Project / site */}
                  <div style={sectionCardStyle}>
                    <SectionTitle color="#14b8a6">Project / site</SectionTitle>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div>
                        <label style={labelStyle}>Project / job name</label>
                        <FormField control={form.control} name="jobId" render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Select
                                onValueChange={(v) => {
                                  const jobId = v === "none" ? "" : v;
                                  field.onChange(jobId);
                                  if (jobId) {
                                    const job = jobs?.find((j) => j.id === jobId);
                                    if (job) form.setValue("clientId", job.clientId);
                                  }
                                }}
                                value={field.value || "none"}
                              >
                                <SelectTrigger style={inputStyle} data-testid="select-invoice-job">
                                  <SelectValue placeholder="Link to job (optional)" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No job</SelectItem>
                                  {filteredJobs?.map((j) => (
                                    <SelectItem key={j.id} value={j.id}>
                                      {j.title}{j.client?.name ? ` — ${j.client.name}` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      {selectedJob?.address && (
                        <div>
                          <label style={labelStyle}>Site location</label>
                          <div style={{ ...inputStyle, background: "#f8fafc", fontSize: "13px", color: "#475569" }}>{selectedJob.address}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Invoice dates + scope notes ── */}
              {showDetails && (
                <div style={sectionCardStyle}>
                  <SectionTitle color="#6366f1">Invoice details</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "12px 14px" }}>
                    <div>
                      <label style={labelStyle}>Invoice date</label>
                      <FormField control={form.control} name="issueDate" render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <input {...field} type="date" style={inputStyle} data-testid="input-invoice-issue-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div>
                      <label style={labelStyle}>Due date *</label>
                      <FormField control={form.control} name="dueDate" render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <input {...field} type="date" style={inputStyle} data-testid="input-invoice-due-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div>
                      <label style={labelStyle}>Tax rate (%)</label>
                      <FormField control={form.control} name="taxRate" render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <input {...field} type="number" step="0.01" placeholder="0" style={inputStyle} data-testid="input-invoice-tax-rate" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  <div style={{ marginTop: "14px" }}>
                    <label style={labelStyle}>Scope summary / notes</label>
                    <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <textarea {...field} spellCheck={true} rows={2} placeholder="Summary line shown at the top of the invoice" style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} data-testid="input-invoice-notes" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              )}

              {/* ── Line items ── */}
              {showItems && (
                <div style={sectionCardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                    <span style={{ width: "6px", height: "16px", borderRadius: "3px", background: "#2563eb", flexShrink: 0 }} />
                    <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, letterSpacing: "-.01em" }}>Line items</h3>
                    <span style={{ marginLeft: "auto", fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>Grouped by section · subtotals update live</span>
                  </div>

                  {(() => {
                    const sectionOrder = [...new Set(lineItems.map(i => i.section || "General"))];
                    const fLabel: React.CSSProperties = { display: "block", fontSize: "10px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "3px" };
                    const fInput: React.CSSProperties = { width: "100%", padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: "7px", fontSize: "12.5px", color: "#0f172a", background: "#fff", fontFamily: "inherit", boxSizing: "border-box" };
                    return (
                      <>
                        {sectionOrder.map((sec, si) => {
                          const secItems = lineItems.filter(i => (i.section || "General") === sec);
                          const secTotal = secItems.reduce((s, i) => s + i.amount, 0);
                          const isOpen = sectionsOpen[sec] !== false;
                          return (
                            <div key={sec} style={{ borderTop: si > 0 ? "1px solid #f1f5f9" : undefined, paddingTop: si > 0 ? "6px" : undefined, marginTop: si > 0 ? "6px" : undefined }}>
                              {/* Section header */}
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 2px" }}>
                                <button type="button" onClick={() => toggleSection(sec)}
                                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: "12px", color: "#64748b", width: "18px", padding: 0, flexShrink: 0 }}>
                                  {isOpen ? "▾" : "▸"}
                                </button>
                                <input
                                  value={sec}
                                  onChange={e => renameSection(sec, e.target.value)}
                                  spellCheck={true}
                                  style={{ flex: 1, border: "1px solid transparent", background: "none", fontSize: "14px", fontWeight: 800, color: "#0f172a", padding: "5px 6px", borderRadius: "6px", fontFamily: "inherit" }}
                                  onFocus={e => { e.currentTarget.style.borderColor = "#cbd5e1"; e.currentTarget.style.background = "#fff"; e.currentTarget.style.outline = "none"; }}
                                  onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "none"; }}
                                  data-testid={`input-section-title-${si}`}
                                />
                                <span style={{ fontSize: "13px", color: "#0f172a", fontWeight: 700, fontFamily: "ui-monospace,monospace", flexShrink: 0 }}>
                                  {formatCurrency(secTotal)}
                                </span>
                                <button type="button" onClick={() => deleteSection(sec)}
                                  style={{ border: "none", background: "#f8fafc", color: "#94a3b8", cursor: "pointer", width: "26px", height: "26px", borderRadius: "7px", fontSize: "16px", flexShrink: 0 }}
                                  data-testid={`button-delete-section-${si}`}
                                  onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; e.currentTarget.style.color = "#dc2626"; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.color = "#94a3b8"; }}>
                                  ×
                                </button>
                              </div>

                              {/* Items */}
                              {isOpen && (
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "2px 2px 10px" }}>
                                  {secItems.map(item => (
                                    <div key={item.id} style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "11px 12px", background: "#fbfcfe", display: "flex", flexDirection: "column", gap: "9px" }}>
                                      {/* Description + delete */}
                                      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                                        <input
                                          value={item.description}
                                          onChange={e => updateItem(item.id, { description: e.target.value })}
                                          placeholder="Description of work"
                                          style={{ flex: 1, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "7px", fontSize: "13.5px", fontWeight: 600, color: "#0f172a", background: "#fff", fontFamily: "inherit" }}
                                          data-testid={`input-item-desc-${item.id}`}
                                        />
                                        <button type="button" onClick={() => removeItem(item.id)}
                                          style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#94a3b8", cursor: "pointer", width: "32px", height: "32px", borderRadius: "7px", fontSize: "18px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                                          data-testid={`button-remove-item-${item.id}`}
                                          onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.borderColor = "#fecaca"; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "#e2e8f0"; }}>
                                          ×
                                        </button>
                                      </div>
                                      {/* Fields grid */}
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(92px,1fr))", gap: "8px", alignItems: "end" }}>
                                        {item.refs !== undefined && (
                                          <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                                            <label style={fLabel}>Reference codes</label>
                                            <input
                                              value={item.refs}
                                              onChange={e => updateItem(item.id, { refs: e.target.value })}
                                              placeholder="PT-01B · ID-202"
                                              style={{ ...fInput, fontFamily: "ui-monospace,monospace", color: "#1d4ed8" }}
                                              data-testid={`input-item-refs-${item.id}`}
                                            />
                                          </div>
                                        )}

                                        {item.hasQty !== false ? (
                                          <>
                                            <div>
                                              <label style={{ ...fLabel, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                                <span>Qty</span>
                                                <button type="button"
                                                  onClick={() => updateItem(item.id, { hasQty: false, quantity: 1, rate: item.amount })}
                                                  title="Remove quantity"
                                                  style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: "14px", lineHeight: 1, padding: 0, marginLeft: "4px" }}>
                                                  ×
                                                </button>
                                              </label>
                                              <input type="number" min="0" step="any" value={item.quantity}
                                                onChange={e => { const q = parseFloat(e.target.value) || 1; updateItem(item.id, { quantity: q, amount: +(q * item.rate).toFixed(2) }); }}
                                                style={fInput} data-testid={`input-item-qty-${item.id}`} />
                                            </div>
                                            <div>
                                              <label style={fLabel}>Unit</label>
                                              <select value={item.unit} onChange={e => updateItem(item.id, { unit: e.target.value })}
                                                style={{ ...fInput, appearance: "auto" as React.CSSProperties["appearance"] }}
                                                data-testid={`select-item-unit-${item.id}`}>
                                                <option value="lump">Lump sum</option>
                                                <option value="flat">Flat rate</option>
                                                <option value="hours">Hours</option>
                                                <option value="sqft">Sq ft</option>
                                                <option value="each">Each</option>
                                                <option value="day">Days</option>
                                              </select>
                                            </div>
                                            <div>
                                              <label style={fLabel}>Rate ($)</label>
                                              <input type="number" min="0" step="any" value={item.rate}
                                                onChange={e => { const r = parseFloat(e.target.value) || 0; updateItem(item.id, { rate: r, amount: +(item.quantity * r).toFixed(2) }); }}
                                                style={{ ...fInput, fontFamily: "ui-monospace,monospace" }}
                                                data-testid={`input-item-rate-${item.id}`} />
                                            </div>
                                            <div>
                                              <label style={fLabel}>Amount</label>
                                              <div style={{ width: "100%", padding: "7px 9px", border: "1px solid #e2e8f0", borderRadius: "7px", fontSize: "12.5px", fontWeight: 700, fontFamily: "ui-monospace,monospace", color: "#0f172a", background: "#f8fafc", boxSizing: "border-box" }}>
                                                {formatCurrency(item.amount)}
                                              </div>
                                            </div>
                                          </>
                                        ) : (
                                          <div style={{ gridColumn: "1 / -1" }}>
                                            <label style={{ ...fLabel, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                              <span>Amount</span>
                                              <button type="button"
                                                onClick={() => updateItem(item.id, { hasQty: true, quantity: 1, rate: item.amount })}
                                                style={{ border: "none", background: "none", cursor: "pointer", color: "#2563eb", fontSize: "11px", fontWeight: 700, letterSpacing: ".01em", padding: 0 }}
                                                data-testid={`button-add-qty-${item.id}`}>
                                                + Add qty
                                              </button>
                                            </label>
                                            <input type="number" min="0" step="any" value={item.amount}
                                              onChange={e => { const a = parseFloat(e.target.value) || 0; updateItem(item.id, { amount: a, rate: a }); }}
                                              style={{ ...fInput, fontFamily: "ui-monospace,monospace" }}
                                              data-testid={`input-item-amount-${item.id}`} />
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {/* Add item button */}
                                  <button type="button" onClick={() => addItemToSection(sec)}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "8px", border: "1.5px dashed #cbd5e1", background: "transparent", borderRadius: "8px", fontSize: "12px", fontWeight: 600, color: "#64748b", cursor: "pointer", fontFamily: "inherit", width: "100%" }}
                                    data-testid={`button-add-item-section-${si}`}>
                                    <Plus style={{ width: "13px", height: "13px" }} /> Add item
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Add section */}
                        <button type="button" onClick={addSection}
                          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", border: "1.5px dashed #cbd5e1", background: "transparent", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#64748b", cursor: "pointer", fontFamily: "inherit", width: "100%", marginTop: sectionOrder.length > 0 ? "8px" : 0 }}
                          data-testid="button-add-line-item">
                          <Plus style={{ width: "15px", height: "15px" }} />
                          {sectionOrder.length === 0 ? "Add line items" : "Add section"}
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* ── Totals & Terms ── */}
              {showTotals && (
                <div style={sectionCardStyle}>
                  <SectionTitle color="#f59e0b">Totals &amp; terms</SectionTitle>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
                    <div style={{ width: "240px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#64748b", marginBottom: "6px" }}>
                        <span>Subtotal</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{formatCurrency(subtotal)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#64748b", marginBottom: "8px" }}>
                        <span>Tax ({taxRate}%)</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{formatCurrency(taxAmount)}</span>
                      </div>
                      <div style={{ borderTop: "1.5px solid #e2e8f0", paddingTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                        <span>Total</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{formatCurrency(total)}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Terms &amp; conditions</label>
                    <FormField control={form.control} name="termsAndConditions" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <textarea {...field} spellCheck={true} rows={3} placeholder="Payment terms and conditions" style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, fontSize: "13px", color: "#475569", background: "#f8fafc" }} data-testid="input-invoice-terms" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              )}

            </form>
          </Form>

          {/* ── Bottom save bar ── */}
          <div style={{
            position: "sticky", bottom: 0, left: 0, right: 0,
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(8px)",
            borderTop: "1px solid #e2e8f0",
            padding: "12px 0",
            marginTop: "8px",
            display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px",
            zIndex: 10,
          }}>
            <span style={{ marginRight: "auto", fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>
              {lineItems.length > 0
                ? `${lineItems.length} item${lineItems.length !== 1 ? "s" : ""} · Total ${formatCurrency(total)}`
                : "Add line items to calculate total"}
            </span>
            <button
              type="button"
              onClick={form.handleSubmit((d) => onSubmit(d, false))}
              disabled={createInvoiceMutation.isPending}
              style={{ padding: "9px 18px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#475569", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}
              data-testid="button-save-invoice-bottom"
            >
              <Save style={{ width: "14px", height: "14px" }} />
              Save invoice
            </button>
            <button
              type="button"
              onClick={form.handleSubmit((d) => onSubmit(d, true))}
              disabled={createInvoiceMutation.isPending}
              style={{ padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}
              data-testid="button-send-invoice-bottom"
            >
              <Send style={{ width: "14px", height: "14px" }} />
              Send invoice
            </button>
          </div>
        </div>

        {/* Right: Live preview */}
        {showPreview && (
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px 80px", background: "#f1f5f9" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "10px" }}>Live preview</div>
            <InvoicePreview
              settings={settings}
              client={selectedClient}
              job={selectedJob}
              lineItems={lineItems}
              issueDate={issueDate}
              dueDate={dueDate}
              notes={notes}
              termsAndConditions={termsAndConditions}
              taxRate={taxRate}
            />
          </div>
        )}
      </div>

      {/* ── Google Docs chooser ── */}
      <Dialog open={showGoogleDocsDialog} onOpenChange={setShowGoogleDocsDialog}>
        <DialogContent className="max-w-xl !flex flex-col max-h-[85dvh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Choose a Google Doc</DialogTitle>
          </DialogHeader>
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={googleDocsSearch}
              onChange={(event) => setGoogleDocsSearch(event.target.value)}
              placeholder="Search documents"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-google-doc-search"
            />
          </div>
          {googleDocsStatusQuery.data?.email && (
            <p className="shrink-0 text-xs text-muted-foreground">
              Connected as {googleDocsStatusQuery.data.email}. Only document content you choose is read.
            </p>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-md border">
            {googleDocsDocumentsQuery.isLoading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Loading Google Docs…</p>
            ) : googleDocsDocumentsQuery.isError ? (
              <div className="p-6 text-center">
                <p className="text-sm text-destructive">
                  {googleDocsDocumentsQuery.error instanceof Error
                    ? googleDocsDocumentsQuery.error.message
                    : "Could not load Google Docs."}
                </p>
                <Button className="mt-3" variant="outline" onClick={() => window.location.assign("/api/google-docs/auth?returnTo=/invoices/new")}>
                  Reconnect Google Docs
                </Button>
              </div>
            ) : filteredGoogleDocs.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {googleDocsSearch ? "No matching Google Docs found." : "No Google Docs found in this account."}
              </p>
            ) : (
              <div className="divide-y">
                {filteredGoogleDocs.map((document) => (
                  <button
                    type="button"
                    key={document.id}
                    onClick={() => parseGoogleDocMutation.mutate(document.id)}
                    disabled={parseGoogleDocMutation.isPending}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 disabled:opacity-60"
                    data-testid={`button-google-doc-${document.id}`}
                  >
                    <FileText className="h-5 w-5 shrink-0 text-blue-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{document.name}</span>
                      {document.modifiedTime && (
                        <span className="block text-xs text-muted-foreground">
                          Updated {format(new Date(document.modifiedTime), "MMM d, yyyy")}
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-semibold text-blue-600">
                      {parseGoogleDocMutation.isPending ? "Importing…" : "Choose"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setShowGoogleDocsDialog(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Imported document review ── */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-xl !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              Review items{parsedDoc?.sourceTitle ? ` from ${parsedDoc.sourceTitle}` : " from document"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
          {parsedDoc && (() => {
            // Group items by section
            const sectionOrder: string[] = [];
            const bySection: Record<string, Array<{ item: ParsedLineItem; idx: number }>> = {};
            parsedDoc.lineItems.forEach((item, idx) => {
              const sec = item.section || "Other";
              if (!bySection[sec]) { bySection[sec] = []; sectionOrder.push(sec); }
              bySection[sec].push({ item, idx });
            });

            const toggleSection = (sec: string, on: boolean) => {
              const next = new Set(selectedParsedItems);
              bySection[sec].forEach(({ idx }) => on ? next.add(idx) : next.delete(idx));
              setSelectedParsedItems(next);
            };

            const sectionTotal = (sec: string) =>
              bySection[sec].reduce((s, { item }) => s + item.amount, 0);

            const sectionAllSelected = (sec: string) =>
              bySection[sec].every(({ idx }) => selectedParsedItems.has(idx));

            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Found <strong>{parsedDoc.lineItems.length}</strong> line items across <strong>{sectionOrder.length}</strong> section{sectionOrder.length !== 1 ? "s" : ""}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className="text-xs text-blue-600 hover:underline"
                      onClick={() => setSelectedParsedItems(new Set(parsedDoc.lineItems.map((_, i) => i)))}>All</button>
                    <span className="text-xs text-muted-foreground">·</span>
                    <button type="button" className="text-xs text-blue-600 hover:underline"
                      onClick={() => setSelectedParsedItems(new Set())}>None</button>
                  </div>
                </div>

                <div className="space-y-4">
                  {sectionOrder.map((sec) => (
                    <div key={sec}>
                      {/* Section header */}
                      <div className="flex items-center justify-between py-1.5 px-2 bg-slate-50 dark:bg-slate-800 rounded-md mb-1.5 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={sectionAllSelected(sec)}
                            onCheckedChange={(v) => toggleSection(sec, !!v)}
                          />
                          <span className="text-xs font-bold tracking-wide text-slate-700 dark:text-slate-200 uppercase">{sec}</span>
                          <span className="text-xs text-muted-foreground">({bySection[sec].length} item{bySection[sec].length !== 1 ? "s" : ""})</span>
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{formatCurrency(sectionTotal(sec))}</span>
                      </div>

                      {/* Items in this section */}
                      <div className="space-y-1 ml-1">
                        {bySection[sec].map(({ item, idx }) => (
                          <div key={idx} className="flex items-start gap-3 rounded-md border border-transparent hover:border-slate-200 hover:bg-muted/30 px-2 py-2 transition-colors">
                            <Checkbox
                              checked={selectedParsedItems.has(idx)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedParsedItems);
                                if (checked) next.add(idx); else next.delete(idx);
                                setSelectedParsedItems(next);
                              }}
                              className="mt-0.5 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <input
                                value={item.description}
                                onChange={(event) => updateParsedItem(idx, { description: event.target.value })}
                                className="h-8 w-full rounded border border-transparent bg-transparent px-1 text-sm leading-snug outline-none hover:border-input focus:border-input focus:bg-background"
                                aria-label={`Description for imported item ${idx + 1}`}
                              />
                              <p className="px-1 text-xs text-muted-foreground">{item.unit}</p>
                            </div>
                            <label className="relative w-24 shrink-0">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.amount}
                                onChange={(event) => {
                                  const amount = Math.max(0, Number(event.target.value) || 0);
                                  updateParsedItem(idx, {
                                    amount,
                                    rate: item.quantity > 0 ? amount / item.quantity : amount,
                                  });
                                }}
                                className="h-8 w-full rounded border border-input bg-background pl-5 pr-2 text-right text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
                                aria-label={`Amount for imported item ${idx + 1}`}
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          </div>
          <DialogFooter className="mt-2 shrink-0">
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
            <Button onClick={applyParsedItems} disabled={selectedParsedItems.size === 0}>
              Import {selectedParsedItems.size} item{selectedParsedItems.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
