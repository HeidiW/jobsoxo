import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Job } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { invalidateMaterialTotals, type MaterialWithJob } from "@/pages/materials-logic";

type MaterialForm = { jobId: string; name: string; description: string; purchaseDate: string; vendor: string; quantity: string; unit: string; price: string };
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const emptyForm = (): MaterialForm => ({ jobId: "", name: "", description: "", purchaseDate: today(), vendor: "", quantity: "", unit: "each", price: "" });
const units = [["each", "Each"], ["oz", "Ounces (oz)"], ["lb", "Pounds (lb)"], ["bag", "Bag"], ["gal", "Gallons (gal)"], ["qt", "Quarts (qt)"], ["ft", "Feet (ft)"], ["sqft", "Square feet (sq ft)"], ["box", "Box"], ["set", "Set"], ["other", "Other"]] as const;

function initialForm(material: MaterialWithJob): MaterialForm {
  return { jobId: material.jobId ?? "", name: material.name, description: material.description ?? "", purchaseDate: material.purchaseDate.slice(0, 10), vendor: material.vendor ?? "", quantity: material.quantity, unit: material.unit, price: material.price };
}

export function MaterialFormDialog({ open, onOpenChange, material, jobs, jobsLoading, jobsError, jobsRetry }: {
  open: boolean; onOpenChange: (open: boolean) => void; material: MaterialWithJob | null; jobs: Job[]; jobsLoading: boolean; jobsError: boolean; jobsRetry: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<MaterialForm>(() => material ? initialForm(material) : emptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  useEffect(() => {
    if (open) {
      setForm(material ? initialForm(material) : emptyForm());
      setErrors({});
      setServerError("");
    }
  }, [open, material]);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(material ? "PATCH" : "POST", material ? `/api/materials/${material.id}` : "/api/materials", {
        ...form,
        jobId: form.jobId || null,
        purchaseDate: form.purchaseDate,
      });
      return response.json();
    },
    onSuccess: () => {
      invalidateMaterialTotals(queryClient);
      trackEvent("material_saved", { action: material ? "updated" : "created" });
      toast({ title: material ? "Material updated" : "Purchase logged" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setServerError(error.message || "Could not save this purchase. Check the details and try again.");
      toast({ title: "Could not save purchase", description: error.message, variant: "destructive" });
    },
  });
  const update = (field: keyof MaterialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setServerError("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Enter a material name.";
    if (!form.purchaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(form.purchaseDate)) next.purchaseDate = "Choose a valid purchase date.";
    if (!form.quantity || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) next.quantity = "Quantity must be greater than zero.";
    if (form.price === "" || !Number.isFinite(Number(form.price)) || Number(form.price) < 0) next.price = "Enter a total price of zero or more.";
    setErrors(next);
    if (!Object.keys(next).length) mutation.mutate();
  };
  const jobUnavailable = jobsError || jobsLoading;
  const assignedJobMissing = !!form.jobId && !jobs.some((job) => job.id === form.jobId);
  const assignmentLocked = jobUnavailable || assignedJobMissing;

  return <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) onOpenChange(next); }}>
    <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden rounded-[28px] border-jx-line bg-card p-0 text-jx-ink sm:max-w-[620px]">
      <DialogHeader className="shrink-0 border-b border-jx-line px-5 py-4 sm:px-7">
        <DialogTitle className="font-display text-2xl !font-bold tracking-[-.04em] text-jx-ink">{material ? "Edit purchase" : "Log a purchase"}</DialogTitle>
        <DialogDescription className="text-sm text-jx-ink-2">Record what you paid for materials on a job, or leave the purchase unassigned.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        <form id="material-form" onSubmit={submit} className="space-y-4" noValidate>
          {serverError && <p className="rounded-xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" role="alert">{serverError}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="material-name">Material *</Label>
            <Input id="material-name" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Exterior latex paint" aria-invalid={!!errors.name} aria-describedby={errors.name ? "error-name" : undefined} data-testid="input-material-name" />
            {errors.name && <p id="error-name" className="text-sm text-destructive" role="alert">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="material-job">Job</Label>
            <Select value={form.jobId || "unassigned"} disabled={assignmentLocked} onValueChange={(value) => update("jobId", value === "unassigned" ? "" : value)}>
              <SelectTrigger id="material-job" className="min-h-11" data-testid="select-material-job" aria-label="Job assignment"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">No job assigned</SelectItem>
                {assignedJobMissing && <SelectItem value={form.jobId}>{material?.job?.title ?? "Current job assignment"}</SelectItem>}
                {jobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>)}
              </SelectContent>
            </Select>
            {jobsLoading && <p className="text-xs text-jx-ink-2" role="status">Loading jobs…</p>}
            {jobsError && <div className="flex items-center gap-2 text-xs text-jx-orange-ink" role="alert">Jobs didn’t load. <button type="button" className="min-h-11 underline" onClick={jobsRetry}>Retry</button></div>}
            {assignedJobMissing && <p className="text-xs text-jx-ink-2">The current assignment is kept unchanged until jobs are available.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="material-description">Description or size details</Label>
            <Input id="material-description" value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Color, size, or other details" data-testid="input-material-description" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="material-date">Purchase date *</Label><Input id="material-date" type="date" value={form.purchaseDate} onChange={(e) => update("purchaseDate", e.target.value)} aria-invalid={!!errors.purchaseDate} aria-describedby={errors.purchaseDate ? "error-date" : undefined} data-testid="input-material-purchase-date" />{errors.purchaseDate && <p id="error-date" className="text-sm text-destructive" role="alert">{errors.purchaseDate}</p>}</div>
            <div className="space-y-1.5"><Label htmlFor="material-vendor">Vendor</Label><Input id="material-vendor" value={form.vendor} onChange={(e) => update("vendor", e.target.value)} placeholder="e.g. local lumber yard" data-testid="input-material-vendor" /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1.2fr]">
            <div className="space-y-1.5"><Label htmlFor="material-quantity">Quantity *</Label><Input id="material-quantity" type="number" min="0.01" step="0.01" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} placeholder="1" aria-invalid={!!errors.quantity} aria-describedby={errors.quantity ? "error-quantity" : undefined} data-testid="input-material-quantity" />{errors.quantity && <p id="error-quantity" className="text-sm text-destructive" role="alert">{errors.quantity}</p>}</div>
            <div className="space-y-1.5"><Label htmlFor="material-unit">Unit *</Label><Select value={form.unit} onValueChange={(value) => update("unit", value)}><SelectTrigger id="material-unit" className="min-h-11" data-testid="select-material-unit"><SelectValue /></SelectTrigger><SelectContent>{units.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}{form.unit && !units.some(([value]) => value === form.unit) && <SelectItem value={form.unit}>{form.unit}</SelectItem>}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="material-price">Total price ($) *</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-jx-ink-2">$</span><Input id="material-price" className="pl-7" type="number" min="0" step="0.01" value={form.price} onChange={(e) => update("price", e.target.value)} placeholder="0.00" aria-invalid={!!errors.price} aria-describedby={errors.price ? "error-price" : "help-price"} data-testid="input-material-price" /></div><p id="help-price" className="text-xs text-jx-ink-2">What you paid for the full purchase.</p>{errors.price && <p id="error-price" className="text-sm text-destructive" role="alert">{errors.price}</p>}</div>
          </div>
        </form>
      </div>
      <DialogFooter className="shrink-0 border-t border-jx-line px-5 py-4 sm:px-7">
        <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => onOpenChange(false)} disabled={mutation.isPending} data-testid="button-cancel-material">Cancel</Button>
        <Button type="submit" form="material-form" disabled={mutation.isPending} className="min-h-11 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover" data-testid="button-save-material">{mutation.isPending ? "Saving…" : material ? "Save changes" : "Log purchase"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
