// Scan a receipt: upload a photo or PDF, let Claude read the lines, then
// review and edit them before saving the kept ones as material purchases.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, FileText, Loader2, ScanLine, Upload } from "lucide-react";
import type { Job } from "@shared/schema";
import { RECEIPT_MAX_BYTES, RECEIPT_MEDIA_TYPES, RECEIPT_UNITS, reviewItemsFromScan, reviewTotal, totalMismatchNote, type ReceiptScan, type ReviewItem } from "@shared/receipt-scan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { invalidateMaterialTotals } from "@/pages/materials-logic";

const STATUS_URL = "/api/materials/scan-receipt/status";
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const UNIT_LABELS: Record<string, string> = { each: "Each", oz: "oz", lb: "lb", bag: "Bag", gal: "gal", qt: "qt", ft: "ft", sqft: "sq ft", box: "Box", set: "Set", other: "Other" };

export function ReceiptScanDialog({ open, onOpenChange, jobs, jobsLoading, jobsError, defaultJobId = "", onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; jobs: Job[]; jobsLoading?: boolean; jobsError?: boolean;
  /** Preselects the job (e.g. when opened from a job's page). */
  defaultJobId?: string;
  onSaved?: (count: number) => void;
}) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scan, setScan] = useState<ReceiptScan | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [vendor, setVendor] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [jobId, setJobId] = useState(defaultJobId);
  const [error, setError] = useState("");
  const status = useQuery<{ available: boolean }>({ queryKey: [STATUS_URL], enabled: open, staleTime: 5 * 60_000 });

  useEffect(() => {
    if (!open) return;
    setFile(null); setScan(null); setItems([]); setVendor(""); setPurchaseDate(today()); setJobId(defaultJobId); setError("");
  }, [open, defaultJobId]);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const scanMutation = useMutation({
    mutationFn: async (chosen: File) => {
      const body = new FormData();
      body.append("receipt", chosen);
      const res = await fetch("/api/materials/scan-receipt", { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The receipt couldn't be read.");
      return data as ReceiptScan;
    },
    onSuccess: (result) => {
      setScan(result);
      setItems(reviewItemsFromScan(result));
      if (result.vendor) setVendor(result.vendor);
      if (result.purchaseDate) setPurchaseDate(result.purchaseDate);
      trackEvent("receipt_scanned", { items: result.items.length, isReceipt: result.isReceipt });
    },
    onError: (err: Error) => setError(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const kept = items.filter((item) => item.include);
      const res = await apiRequest("POST", "/api/materials/bulk", {
        materials: kept.map((item) => ({
          jobId: jobId || null,
          name: item.name.trim(),
          description: item.description.trim() || null,
          purchaseDate,
          vendor: vendor.trim() || null,
          quantity: item.quantity,
          unit: item.unit,
          price: item.price,
        })),
      });
      return (await res.json()) as unknown[];
    },
    onSuccess: (created) => {
      invalidateMaterialTotals(queryClient);
      trackEvent("material_saved", { action: "scanned", count: created.length });
      toast({ title: `${created.length} ${created.length === 1 ? "purchase" : "purchases"} logged from the receipt` });
      onSaved?.(created.length);
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message || "The purchases couldn't be saved. Check the details and try again."),
  });

  function choose(chosen: File | undefined) {
    setError("");
    if (!chosen) return;
    if (!(RECEIPT_MEDIA_TYPES as readonly string[]).includes(chosen.type)) { setError("Use a JPEG, PNG, WebP or GIF photo, or a PDF."); return; }
    if (chosen.size > RECEIPT_MAX_BYTES) { setError("That file is too large. Receipts must be under 10 MB."); return; }
    setFile(chosen);
    setScan(null);
    setItems([]);
    scanMutation.mutate(chosen);
  }

  const update = (key: string, patch: Partial<ReviewItem>) => {
    setError("");
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };
  const addLine = () => setItems((current) => [...current, { key: `manual-${Date.now()}`, include: true, name: "", description: "", quantity: "1", unit: "each", price: "" }]);

  const kept = items.filter((item) => item.include);
  const problems = kept.filter((item) => !item.name.trim() || !(Number(item.quantity) > 0) || item.price === "" || !(Number(item.price) >= 0));
  const mismatch = scan ? totalMismatchNote(scan, items) : null;
  const busy = scanMutation.isPending || saveMutation.isPending;
  const canSave = !!scan && kept.length > 0 && problems.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) && !busy;
  const unavailable = status.data?.available === false;

  function save() {
    if (problems.length) { setError("Each kept item needs a name, a quantity above zero and a price."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) { setError("Choose the purchase date."); return; }
    saveMutation.mutate();
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden rounded-[28px] border-jx-line bg-card p-0 text-jx-ink sm:max-w-[900px]" data-testid="receipt-scan-dialog">
      <DialogHeader className="shrink-0 border-b border-jx-line px-5 py-4 sm:px-7">
        <DialogTitle className="flex items-center gap-2 font-display text-2xl !font-bold tracking-[-.04em] text-jx-ink"><ScanLine className="h-6 w-6 text-jx-green-ink" aria-hidden="true" />Scan a receipt</DialogTitle>
        <DialogDescription className="text-jx-ink-2">Snap or upload the receipt. Claude reads the lines, you check them, then they're logged as purchases.</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        {unavailable && <p role="alert" className="mb-4 rounded-2xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" data-testid="receipt-scan-unavailable">Receipt scanning isn't set up on this server yet. You can still log purchases by hand.</p>}

        <input ref={fileInput} type="file" accept={RECEIPT_MEDIA_TYPES.join(",")} className="sr-only" onChange={(event) => choose(event.target.files?.[0])} aria-label="Receipt photo or PDF" data-testid="input-receipt-file" />

        {!scan && !scanMutation.isPending && (
          <div className="flex flex-col items-center justify-center gap-4 rounded-[24px] border-2 border-dashed border-jx-line bg-jx-surface px-6 py-12 text-center" data-testid="receipt-dropzone"
            onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }}>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink"><Camera className="h-6 w-6" aria-hidden="true" /></div>
            <div><p className="font-semibold text-jx-ink">Photo or PDF of the receipt</p><p className="mt-1 text-sm text-jx-ink-2">JPEG, PNG, WebP, GIF or PDF, up to 10 MB. Lay the receipt flat and get the whole thing in frame.</p></div>
            <Button type="button" onClick={() => fileInput.current?.click()} disabled={unavailable} className="min-h-11 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover" data-testid="button-choose-receipt"><Upload className="mr-2 h-4 w-4" aria-hidden="true" />Choose receipt</Button>
          </div>
        )}

        {scanMutation.isPending && (
          <div className="flex flex-col items-center gap-4 rounded-[24px] bg-jx-surface px-6 py-12 text-center" role="status" data-testid="receipt-scanning">
            {preview ? <img src={preview} alt="" className="max-h-56 rounded-xl object-contain shadow-sm" /> : <FileText className="h-10 w-10 text-jx-ink-3" aria-hidden="true" />}
            <p className="flex items-center gap-2 font-semibold text-jx-ink"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Reading {file?.name ?? "the receipt"}…</p>
            <p className="text-sm text-jx-ink-2">This usually takes a few seconds.</p>
          </div>
        )}

        {scan && !scanMutation.isPending && (
          <div className="space-y-5">
            {!scan.isReceipt && <p role="alert" className="rounded-2xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" data-testid="receipt-not-receipt">This doesn't look like a receipt. You can still fill in the lines below, or choose another file.</p>}
            {scan.warnings.map((warning, index) => <p key={index} className="flex items-start gap-2 rounded-2xl bg-jx-gold-tint px-4 py-3 text-sm text-jx-gold-ink" data-testid="receipt-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{warning}</p>)}
            {mismatch && <p className="flex items-start gap-2 rounded-2xl bg-jx-gold-tint px-4 py-3 text-sm text-jx-gold-ink" data-testid="receipt-total-mismatch"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{mismatch}</p>}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label htmlFor="receipt-vendor">Vendor</Label><Input id="receipt-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Store or supplier" data-testid="input-receipt-vendor" /></div>
              <div className="space-y-1.5"><Label htmlFor="receipt-date">Purchase date *</Label><Input id="receipt-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} data-testid="input-receipt-date" /></div>
              <div className="space-y-1.5">
                <Label htmlFor="receipt-job">Job</Label>
                <Select value={jobId || "unassigned"} disabled={jobsLoading || jobsError} onValueChange={(value) => setJobId(value === "unassigned" ? "" : value)}>
                  <SelectTrigger id="receipt-job" className="min-h-11" data-testid="select-receipt-job" aria-label="Job assignment"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">No job assigned</SelectItem>
                    {jobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                {jobsError && <p className="text-xs text-jx-orange-ink" role="alert">Jobs didn't load; items will be saved unassigned.</p>}
              </div>
            </div>

            <div className="overflow-hidden rounded-[20px] border border-jx-line">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm" data-testid="receipt-items">
                  <thead className="bg-jx-surface text-left text-[11px] font-bold uppercase tracking-[.1em] text-jx-ink-3"><tr>
                    <th className="w-10 px-3 py-3"><span className="sr-only">Keep</span></th><th className="px-3 py-3">Material</th><th className="px-3 py-3">Details</th><th className="w-24 px-3 py-3">Qty</th><th className="w-28 px-3 py-3">Unit</th><th className="w-32 px-3 py-3 text-right">Total $</th>
                  </tr></thead>
                  <tbody className="divide-y divide-jx-line/70">
                    {items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-jx-ink-2">No lines were read from this receipt. Add them below or try a clearer photo.</td></tr>}
                    {items.map((item) => <tr key={item.key} className={item.include ? "" : "opacity-50"} data-testid={`receipt-item-${item.key}`}>
                      <td className="px-3 py-2"><input type="checkbox" className="h-5 w-5 accent-jx-green" checked={item.include} onChange={(e) => update(item.key, { include: e.target.checked })} aria-label={`Keep ${item.name || "this line"}`} data-testid={`check-receipt-item-${item.key}`} /></td>
                      <td className="px-3 py-2"><Input value={item.name} onChange={(e) => update(item.key, { name: e.target.value })} aria-label="Material name" aria-invalid={item.include && !item.name.trim()} data-testid={`input-receipt-name-${item.key}`} /></td>
                      <td className="px-3 py-2"><Input value={item.description} onChange={(e) => update(item.key, { description: e.target.value })} aria-label="Details" placeholder="Color, size…" /></td>
                      <td className="px-3 py-2"><Input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => update(item.key, { quantity: e.target.value })} aria-label="Quantity" data-testid={`input-receipt-qty-${item.key}`} /></td>
                      <td className="px-3 py-2">
                        <Select value={item.unit} onValueChange={(value) => update(item.key, { unit: value })}>
                          <SelectTrigger className="min-h-10" aria-label="Unit"><SelectValue /></SelectTrigger>
                          <SelectContent>{RECEIPT_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{UNIT_LABELS[unit] ?? unit}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2"><Input type="number" min="0" step="0.01" className="text-right font-mono" value={item.price} onChange={(e) => update(item.key, { price: e.target.value })} aria-label="Line total" data-testid={`input-receipt-price-${item.key}`} /></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-jx-line bg-jx-surface px-4 py-3">
                <button type="button" className="min-h-10 text-sm font-semibold text-jx-green-ink underline" onClick={addLine} data-testid="button-add-receipt-line">Add a line</button>
                <div className="text-right"><div className="text-[10px] font-bold uppercase tracking-[.12em] text-jx-ink-3">{kept.length} {kept.length === 1 ? "item" : "items"} to log{scan.tax ? ` · tax ${money(scan.tax)} not included` : ""}</div><div className="font-mono text-base font-semibold tabular-nums" data-testid="text-receipt-total">{money(reviewTotal(items))}</div></div>
              </div>
            </div>

            <button type="button" className="min-h-10 text-sm text-jx-ink-2 underline" onClick={() => fileInput.current?.click()} data-testid="button-rescan">Scan a different receipt</button>
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-2xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" data-testid="receipt-error">{error}</p>}
      </div>

      <DialogFooter className="shrink-0 border-t border-jx-line px-5 py-4 sm:px-7">
        <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => onOpenChange(false)} disabled={busy} data-testid="button-cancel-receipt">Cancel</Button>
        <Button type="button" onClick={save} disabled={!canSave} className="min-h-11 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover" data-testid="button-save-receipt">{saveMutation.isPending ? "Saving…" : `Log ${kept.length || ""} ${kept.length === 1 ? "purchase" : "purchases"}`.replace(/\s+/g, " ")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
