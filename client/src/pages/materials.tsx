import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Edit, Package, Plus, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Job, JobMaterial } from "@shared/schema";

type MaterialWithJob = JobMaterial & { job: Job | null };

type MaterialForm = {
  jobId: string;
  name: string;
  description: string;
  purchaseDate: string;
  vendor: string;
  quantity: string;
  unit: string;
  price: string;
};

const EMPTY_FORM: MaterialForm = {
  jobId: "",
  name: "",
  description: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  vendor: "",
  quantity: "",
  unit: "each",
  price: "",
};

const UNIT_OPTIONS = [
  ["each", "Each"],
  ["oz", "Ounces (oz)"],
  ["lb", "Pounds (lb)"],
  ["bag", "Bag"],
  ["gal", "Gallons (gal)"],
  ["qt", "Quarts (qt)"],
  ["ft", "Feet (ft)"],
  ["sqft", "Square feet (sq ft)"],
  ["box", "Box"],
  ["set", "Set"],
  ["other", "Other"],
] as const;

function materialToForm(material: MaterialWithJob): MaterialForm {
  return {
    jobId: material.jobId ?? "",
    name: material.name,
    description: material.description ?? "",
    purchaseDate: material.purchaseDate.slice(0, 10),
    vendor: material.vendor ?? "",
    quantity: material.quantity,
    unit: material.unit,
    price: material.price,
  };
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const dateValue = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return "—";
  return format(new Date(year, month - 1, day), "MMM d, yyyy");
}

function formatMoney(value: string | number) {
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function MaterialFormDialog({
  open,
  onOpenChange,
  material,
  jobs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: MaterialWithJob | null;
  jobs: Job[];
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<MaterialForm>(material ? materialToForm(material) : EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setForm(material ? materialToForm(material) : { ...EMPTY_FORM, purchaseDate: new Date().toISOString().slice(0, 10) });
      setErrors({});
    }
  }, [open, material]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        jobId: form.jobId || null,
        purchaseDate: form.purchaseDate,
      };
      const response = await apiRequest(
        material ? "PATCH" : "POST",
        material ? `/api/materials/${material.id}` : "/api/materials",
        body,
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      toast({ title: material ? "Material updated" : "Material added" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Could not save material", description: error.message, variant: "destructive" });
    },
  });

  function update(field: keyof MaterialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Material name is required";
    if (!form.purchaseDate) nextErrors.purchaseDate = "Purchase date is required";
    if (!form.quantity || Number(form.quantity) <= 0) nextErrors.quantity = "Quantity must be greater than zero";
    if (!form.price || Number(form.price) < 0) nextErrors.price = "Price is required";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{material ? "Edit material" : "Add material"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="material-name">Material name *</Label>
            <Input
              id="material-name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="e.g. Exterior latex paint"
              data-testid="input-material-name"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="material-job">Job</Label>
            <Select value={form.jobId || "unassigned"} onValueChange={(value) => update("jobId", value === "unassigned" ? "" : value)}>
              <SelectTrigger id="material-job" data-testid="select-material-job">
                <SelectValue placeholder="Choose a job" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">No job assigned</SelectItem>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="material-description">Description or size details</Label>
            <Input
              id="material-description"
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="e.g. White exterior, 2-inch angled sash brush"
              data-testid="input-material-description"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="material-date">Purchase date *</Label>
              <Input
                id="material-date"
                type="date"
                value={form.purchaseDate}
                onChange={(event) => update("purchaseDate", event.target.value)}
                data-testid="input-material-purchase-date"
              />
              {errors.purchaseDate && <p className="text-xs text-destructive">{errors.purchaseDate}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-vendor">Vendor</Label>
              <Input
                id="material-vendor"
                value={form.vendor}
                onChange={(event) => update("vendor", event.target.value)}
                placeholder="e.g. Sherwin-Williams"
                data-testid="input-material-vendor"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1.2fr_1fr]">
            <div className="space-y-2">
              <Label htmlFor="material-quantity">Quantity *</Label>
              <Input
                id="material-quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={form.quantity}
                onChange={(event) => update("quantity", event.target.value)}
                placeholder="1"
                data-testid="input-material-quantity"
              />
              {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-unit">Unit *</Label>
              <Select value={form.unit} onValueChange={(value) => update("unit", value)}>
                <SelectTrigger id="material-unit" data-testid="select-material-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-price">Price *</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">$</span>
                <Input
                  id="material-price"
                  className="pl-7"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => update("price", event.target.value)}
                  placeholder="0.00"
                  data-testid="input-material-price"
                />
              </div>
              {errors.price && <p className="text-xs text-destructive">{errors.price}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-save-material">
              {mutation.isPending ? "Saving…" : material ? "Save changes" : "Add material"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Materials() {
  const { toast } = useToast();
  const [jobFilter, setJobFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialWithJob | null>(null);
  const [deletingMaterial, setDeletingMaterial] = useState<MaterialWithJob | null>(null);

  const { data: materials = [], isLoading } = useQuery<MaterialWithJob[]>({ queryKey: ["/api/materials"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/materials/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      toast({ title: "Material deleted" });
      setDeletingMaterial(null);
    },
    onError: (error: Error) => toast({ title: "Could not delete material", description: error.message, variant: "destructive" }),
  });

  const filteredMaterials = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return materials.filter((material) => {
      const matchesJob = jobFilter === "all" || material.jobId === jobFilter;
      const matchesSearch = !normalized
        || material.name.toLowerCase().includes(normalized)
        || material.description?.toLowerCase().includes(normalized)
        || material.vendor?.toLowerCase().includes(normalized)
        || material.job?.title.toLowerCase().includes(normalized);
      return matchesJob && matchesSearch;
    });
  }, [materials, jobFilter, search]);

  function openNew() {
    setEditingMaterial(null);
    setDialogOpen(true);
  }

  function openEdit(material: MaterialWithJob) {
    setEditingMaterial(material);
    setDialogOpen(true);
  }

  return (
    <div className="p-6 md:p-7">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Materials</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track supplies purchased for your jobs.
            </p>
          </div>
          <Button onClick={openNew} data-testid="button-add-material">
            <Plus className="mr-2 h-4 w-4" /> Add material
          </Button>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search materials, vendors, or jobs…"
              data-testid="input-search-materials"
            />
          </div>
          <Select value={jobFilter} onValueChange={setJobFilter}>
            <SelectTrigger className="w-full sm:w-[240px]" data-testid="select-filter-material-job">
              <SelectValue placeholder="Filter by job" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs</SelectItem>
              {jobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {filteredMaterials.length} material{filteredMaterials.length === 1 ? "" : "s"}
            </span>
            {(jobFilter !== "all" || search) && (
              <button className="text-xs font-medium text-primary hover:underline" onClick={() => { setJobFilter("all"); setSearch(""); }}>
                Clear filters
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading materials…</div>
          ) : filteredMaterials.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold">{materials.length ? "No materials match your filters" : "No materials yet"}</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {materials.length ? "Try another search or job filter." : "Add your first purchase to start tracking job materials."}
              </p>
              {!materials.length && <Button className="mt-4" variant="outline" onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Add material</Button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Material</th>
                    <th className="px-4 py-3 font-semibold">Job</th>
                    <th className="px-4 py-3 font-semibold">Purchased</th>
                    <th className="px-4 py-3 font-semibold">Quantity</th>
                    <th className="px-4 py-3 text-right font-semibold">Price</th>
                    <th className="w-24 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredMaterials.map((material) => (
                    <tr key={material.id} className="transition-colors hover:bg-muted/30" data-testid={`row-material-${material.id}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{material.name}</div>
                        <div className="max-w-[280px] truncate text-xs text-muted-foreground">
                          {[material.description, material.vendor].filter(Boolean).join(" · ") || "No details"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {material.job ? <span className="font-medium">{material.job.title}</span> : <span className="text-muted-foreground">Unassigned</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(material.purchaseDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{material.quantity} {material.unit}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium">{formatMoney(material.price)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(material)} aria-label={`Edit ${material.name}`} data-testid={`button-edit-material-${material.id}`}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeletingMaterial(material)} aria-label={`Delete ${material.name}`} data-testid={`button-delete-material-${material.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <MaterialFormDialog
        key={editingMaterial?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingMaterial(null); }}
        material={editingMaterial}
        jobs={jobs}
      />

      <AlertDialog open={!!deletingMaterial} onOpenChange={(open) => { if (!open) setDeletingMaterial(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete material?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deletingMaterial?.name}</strong> from your materials list. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingMaterial && deleteMutation.mutate(deletingMaterial.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-material"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}