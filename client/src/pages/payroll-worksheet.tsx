import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Save, Trash2, ArrowLeft } from "lucide-react";
import type { Employee } from "@shared/schema";

type Deduction = { id: string; label: string; category: string; amount: string };
type Worksheet = {
  id: string; employeeId: string; periodStart: string; periodEnd: string; payDate: string;
  daysWorked: string; dailyGross: string; grossPay: string;
  gustoDeductionsBreakdown: Array<{ label: string; category?: string; amount: number }>;
  totalDeductions: string; netPay: string; status: "draft" | "exported" | "confirmed";
  gustoConfirmationReference?: string | null; gustoConfirmedAt?: string | null;
  gustoConfirmationNotes?: string | null;
};

const categories = ["Federal withholding", "State withholding", "FICA", "Health insurance", "Retirement", "Garnishment", "Other"];
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const today = new Date().toISOString().slice(0, 10);

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function PayrollWorksheet() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const contextEmployee = params.get("employeeId") ?? "";
  const { data: employees = [], isLoading: employeeLoading } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: worksheets = [] } = useQuery<Worksheet[]>({ queryKey: ["/api/payroll-worksheets"] });
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const [employeeId, setEmployeeId] = useState(contextEmployee);
  const selected = activeEmployees.find((employee) => String(employee.id) === employeeId);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState(today);
  const [daysWorked, setDaysWorked] = useState("0");
  const [dailyGross, setDailyGross] = useState("");
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [savedId, setSavedId] = useState("");
  const [worksheetStatus, setWorksheetStatus] = useState<Worksheet["status"]>("draft");
  const savedWorksheet = worksheets.find((worksheet) => worksheet.id === savedId);

  const loadWorksheet = (worksheet: Worksheet) => {
    setSavedId(worksheet.id);
    setEmployeeId(worksheet.employeeId);
    setPeriodStart(worksheet.periodStart);
    setPeriodEnd(worksheet.periodEnd);
    setPayDate(worksheet.payDate);
    setDaysWorked(worksheet.daysWorked);
    setDailyGross(worksheet.dailyGross);
    setDeductions(worksheet.gustoDeductionsBreakdown.map((row) => ({
      id: crypto.randomUUID(),
      label: row.label,
      category: row.category || "Other",
      amount: String(row.amount),
    })));
    setWorksheetStatus(worksheet.status);
  };

  useEffect(() => {
    const worksheetId = params.get("worksheetId");
    const worksheet = worksheets.find((item) => item.id === worksheetId);
    if (worksheet && worksheet.id !== savedId) loadWorksheet(worksheet);
  }, [worksheets, savedId]);

  useEffect(() => {
    if (selected?.dayRate && !dailyGross && !savedId) {
      setDailyGross(String(selected.dayRate));
    }
  }, [selected, dailyGross, savedId]);

  const gross = Number(daysWorked || 0) * Number(dailyGross || 0);
  const totalDeductions = useMemo(() => deductions.reduce((sum, row) => sum + Number(row.amount || 0), 0), [deductions]);
  const net = Math.max(0, gross - totalDeductions);
  const deductionsValid = totalDeductions <= gross;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        employeeId,
        periodStart,
        periodEnd,
        payDate,
        daysWorked,
        dailyGross,
        gustoDeductionsBreakdown: deductions.map(({ label, category, amount }) => ({
          label,
          category,
          amount: Number(amount),
        })),
      };
      const response = await apiRequest(savedId ? "PATCH" : "POST", savedId ? `/api/payroll-worksheets/${savedId}` : "/api/payroll-worksheets", payload);
      return response.json();
    },
    onSuccess: (worksheet) => {
      setSavedId(String(worksheet.id));
      setWorksheetStatus(worksheet.status);
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-worksheets"] });
      toast({ title: "Worksheet saved", description: "Local worksheet changes are saved; no Gusto payroll or payment was initiated." });
    },
    onError: (error: Error) => toast({ title: "Worksheet could not be saved", description: error.message, variant: "destructive" }),
  });

  const addDeduction = () => setDeductions((rows) => [...rows, { id: crypto.randomUUID(), label: "", category: "Other", amount: "" }]);
  const updateDeduction = (id: string, key: keyof Deduction, value: string) =>
    setDeductions((rows) => rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  const exportCsv = async () => {
    const response = await apiRequest("POST", `/api/payroll-worksheets/${savedId}/export`);
    const worksheet = await response.json() as Worksheet;
    setWorksheetStatus(worksheet.status);
    const lines = [
      ["Local reference worksheet", ""], ["Employee", selected?.name ?? ""], ["Employee ID", employeeId],
      ["Period start", periodStart], ["Period end", periodEnd], ["Pay date", payDate], ["Days worked", daysWorked],
      ["Daily gross", dailyGross], ["Gross pay", gross.toFixed(2)], ["Total deductions", totalDeductions.toFixed(2)], ["Net pay", net.toFixed(2)],
      [], ["Deduction", "Category", "Amount"], ...deductions.map((row) => [row.label, row.category, Number(row.amount || 0).toFixed(2)]),
      [], ["Existing Gusto confirmation reference", savedWorksheet?.gustoConfirmationReference ?? ""],
      ["Existing Gusto confirmation date", savedWorksheet?.gustoConfirmedAt?.slice(0, 10) ?? ""],
      ["Existing confirmation notes", savedWorksheet?.gustoConfirmationNotes ?? ""],
    ];
    const blob = new Blob([lines.map((line) => line.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `payroll-worksheet-${periodEnd || today}.csv`; link.click(); URL.revokeObjectURL(link.href);
    toast({ title: "CSV exported", description: "No payment was initiated." });
  };

  const chooseEmployee = (value: string) => {
    setEmployeeId(value);
    const employee = activeEmployees.find((item) => String(item.id) === value);
    setDailyGross(employee?.dayRate ? String(employee.dayRate) : "");
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-7xl space-y-8 px-5 py-8 md:px-10">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-6">
          <div>
            <button onClick={() => setLocation("/payroll")} className="mb-4 flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> Payroll</button>
            <p className="kicker">Local source record · not submitted</p>
            <h1 className="mt-2 text-4xl">Payroll worksheet</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">Keep a local worksheet and its audit history. This screen does not calculate Gusto taxes or initiate payroll or ACH.</p>
          </div>
          <div className="flex gap-2 pt-8">
            <Button variant="outline" onClick={exportCsv} disabled={!savedId}><Download className="mr-2 h-4 w-4" /> Export CSV</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || worksheetStatus === "confirmed" || !deductionsValid || !employeeId || !periodStart || !periodEnd || !payDate}><Save className="mr-2 h-4 w-4" /> {saveMutation.isPending ? "Saving…" : "Save draft"}</Button>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          <div className="space-y-8">
            {worksheets.length > 0 && (
              <section className="border border-card-border bg-card/50 p-6">
                <p className="kicker">Saved work</p>
                <h2 className="mt-2 text-2xl">Payroll worksheet history</h2>
                <div className="mt-5 divide-y divide-border border-y border-border">
                  {worksheets.map((worksheet) => {
                    const employee = employees.find((item) => item.id === worksheet.employeeId);
                    return (
                      <button
                        key={worksheet.id}
                        type="button"
                        onClick={() => {
                          loadWorksheet(worksheet);
                          setLocation(`/payroll/worksheet?worksheetId=${worksheet.id}`);
                        }}
                        className="grid w-full grid-cols-[1fr_auto] gap-4 py-3 text-left hover:bg-muted/40"
                      >
                        <span>
                          <span className="block text-sm text-foreground">{employee?.name || "Employee"}</span>
                          <span className="block text-xs text-muted-foreground">{worksheet.periodStart} – {worksheet.periodEnd}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm" data-tabular>{money(Number(worksheet.netPay))}</span>
                          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{worksheet.status}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            <section className="border border-card-border bg-card/50 p-6">
              <p className="kicker">Pay record</p>
              <h2 className="mt-2 text-2xl">Who and when</h2>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <label className="space-y-2 text-sm md:col-span-2"><span className="text-xs uppercase tracking-wider text-muted-foreground">Active employee</span>
                  <select value={employeeId} onChange={(event) => chooseEmployee(event.target.value)} className="h-10 w-full border border-input bg-transparent px-3 text-sm" disabled={employeeLoading}>
                    <option value="">{employeeLoading ? "Loading employees…" : "Choose an employee"}</option>
                    {activeEmployees.map((employee) => <option key={String(employee.id)} value={String(employee.id)}>{employee.name} · {money(Number(employee.dayRate || 0))}/day</option>)}
                  </select>
                </label>
                {[
                  ["Period start", periodStart, setPeriodStart], ["Period end", periodEnd, setPeriodEnd], ["Pay date", payDate, setPayDate],
                ].map(([label, value, setter]) => <label key={label as string} className="space-y-2 text-sm"><span className="text-xs uppercase tracking-wider text-muted-foreground">{label as string}</span><Input type="date" value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} /></label>)}
                <label className="space-y-2 text-sm"><span className="text-xs uppercase tracking-wider text-muted-foreground">Days worked</span><Input type="number" min="0" step="0.5" value={daysWorked} onChange={(event) => setDaysWorked(event.target.value)} /></label>
                <label className="space-y-2 text-sm"><span className="text-xs uppercase tracking-wider text-muted-foreground">Daily gross</span><Input type="number" min="0" step="0.01" value={dailyGross} placeholder={selected?.dayRate ? String(selected.dayRate) : "0.00"} onChange={(event) => setDailyGross(event.target.value)} /></label>
              </div>
            </section>

            <section className="border border-card-border bg-card/50 p-6">
              <div className="flex items-start justify-between gap-4"><div><p className="kicker">Local worksheet only</p><h2 className="mt-2 text-2xl">Reference adjustments</h2></div><Button variant="outline" size="sm" onClick={addDeduction}><Plus className="mr-2 h-4 w-4" /> Add row</Button></div>
              <div className="mt-5 space-y-3">
                {deductions.length === 0 && <p className="border border-dashed border-border p-5 text-sm text-muted-foreground">No reference adjustments added. These entries are for local record keeping only; Gusto determines actual deductions.</p>}
                {deductions.map((row) => <div key={row.id} className="grid gap-2 md:grid-cols-[1.4fr_1fr_130px_36px]">
                  <Input aria-label="Deduction label" placeholder="e.g. Health premium" value={row.label} onChange={(e) => updateDeduction(row.id, "label", e.target.value)} />
                  <select aria-label="Deduction category" value={row.category} onChange={(e) => updateDeduction(row.id, "category", e.target.value)} className="h-10 border border-input bg-transparent px-3 text-sm">{categories.map((category) => <option key={category}>{category}</option>)}</select>
                  <Input aria-label="Deduction amount" type="number" min="0" step="0.01" placeholder="0.00" value={row.amount} onChange={(e) => updateDeduction(row.id, "amount", e.target.value)} />
                  <Button variant="ghost" size="icon" onClick={() => setDeductions((rows) => rows.filter((item) => item.id !== row.id))} aria-label="Remove deduction"><Trash2 className="h-4 w-4" /></Button>
                </div>)}
              </div>
            </section>

            <section className="border border-card-border bg-card/50 p-6">
              <p className="kicker">Existing audit metadata · read only</p><h2 className="mt-2 text-2xl">Gusto confirmation history</h2>
              {savedWorksheet?.gustoConfirmationReference || savedWorksheet?.gustoConfirmedAt || savedWorksheet?.gustoConfirmationNotes
                ? <dl className="mt-5 grid gap-4 md:grid-cols-2">
                    <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Confirmation reference</dt><dd className="mt-1 break-words text-sm">{savedWorksheet.gustoConfirmationReference || "—"}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Confirmation date</dt><dd className="mt-1 text-sm">{savedWorksheet.gustoConfirmedAt?.slice(0, 10) || "—"}</dd></div>
                    <div className="md:col-span-2"><dt className="text-xs uppercase tracking-wider text-muted-foreground">Existing notes</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{savedWorksheet.gustoConfirmationNotes || "—"}</dd></div>
                  </dl>
                : <p className="mt-4 text-sm text-muted-foreground">No preexisting confirmation metadata is recorded for this worksheet. This page does not record provider confirmations.</p>}
            </section>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            <section className="border border-primary/40 bg-primary/[.035] p-6">
              <p className="kicker">Local estimate</p><div className="mt-6 space-y-3 text-sm">
                <div className="flex justify-between"><span>Gross pay</span><span data-tabular>{money(gross)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Deductions</span><span data-tabular>− {money(totalDeductions)}</span></div>
                <div className="my-4 border-t border-primary/20" /><div className="flex items-end justify-between"><span className="font-serif text-xl">Net pay</span><strong className="font-serif text-3xl font-normal" data-testid="text-net-pay">{money(net)}</strong></div>
                {!deductionsValid && <p className="border-t border-destructive/30 pt-3 text-xs text-destructive">Deductions cannot exceed gross pay.</p>}
              </div>
            </section>
            <section className="border border-card-border p-5">
              <p className="font-serif text-lg">Gusto controls payment</p>
              <p className="mt-2 text-sm text-muted-foreground">This worksheet is not a payment route. Use the Gusto payroll workspace to prepare, review and submit payroll with provider-calculated totals.</p>
            </section>
            <Badge variant="outline" className="rounded-none px-3 py-1 text-[10px] uppercase tracking-wider">{savedId ? worksheetStatus : "Unsaved draft"}</Badge>
          </aside>
        </div>
      </div>
    </div>
  );
}