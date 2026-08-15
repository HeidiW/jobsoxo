import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  Clock3,
  Command,
  FileText,
  Filter,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

type Invoice = {
  id: string;
  number: string;
  client: string;
  project: string;
  amount: string;
  due: string;
  days: number;
  status: "Needs follow-up" | "Awaiting payment" | "Paid";
  initials: string;
  tint: string;
};

const invoices: Invoice[] = [
  { id: "1", number: "INV-1048", client: "Morrow & Sons", project: "Cedar Street remodel", amount: "$18,420", due: "Due today", days: 0, status: "Needs follow-up", initials: "MS", tint: "#f1d5bb" },
  { id: "2", number: "INV-1042", client: "Northline Studio", project: "Market Street office", amount: "$9,875", due: "3 days overdue", days: 3, status: "Needs follow-up", initials: "NS", tint: "#c7d8e9" },
  { id: "3", number: "INV-1039", client: "Juniper Hospitality", project: "Lobby millwork", amount: "$24,600", due: "6 days overdue", days: 6, status: "Needs follow-up", initials: "JH", tint: "#ded0eb" },
  { id: "4", number: "INV-1051", client: "Aster Properties", project: "Unit 4B refresh", amount: "$7,240", due: "Due in 2 days", days: -2, status: "Awaiting payment", initials: "AP", tint: "#d8e6c5" },
  { id: "5", number: "INV-1046", client: "Clay & Finch", project: "Warehouse lighting", amount: "$12,180", due: "Due in 8 days", days: -8, status: "Awaiting payment", initials: "CF", tint: "#f0d5df" },
  { id: "6", number: "INV-1034", client: "Vela Construction", project: "Pine Avenue addition", amount: "$31,500", due: "Paid yesterday", days: 0, status: "Paid", initials: "VC", tint: "#d6ddcf" },
];

export default function InvoiceCommandCenter() {
  const [selected, setSelected] = useState<Invoice>(invoices[0]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<"All" | Invoice["status"]>("All");
  const [showComposer, setShowComposer] = useState(false);
  const [reminded, setReminded] = useState(false);

  const visible = useMemo(
    () =>
      invoices.filter((invoice) => {
        const matchesStatus = active === "All" || invoice.status === active;
        const haystack = `${invoice.client} ${invoice.project} ${invoice.number}`.toLowerCase();
        return matchesStatus && haystack.includes(query.toLowerCase());
      }),
    [active, query],
  );

  const grouped = {
    "Needs follow-up": visible.filter((item) => item.status === "Needs follow-up"),
    "Awaiting payment": visible.filter((item) => item.status === "Awaiting payment"),
    Paid: visible.filter((item) => item.status === "Paid"),
  };

  return (
    <div className="min-h-[100dvh] bg-[#f7f7f4] text-[#20252a]" style={{ fontFamily: "'DM Sans', ui-sans-serif, sans-serif" }}>
      <div className="mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col">
        <header className="flex items-center gap-4 border-b border-[#dedfd9] bg-[#fbfbf8] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#1f3a35] text-[#dbe9d1]"><Command size={16} /></div>
            <span className="text-[15px] font-bold tracking-[-.02em]">JobsOxo</span>
          </div>
          <div className="mx-3 hidden h-5 w-px bg-[#dedfd9] sm:block" />
          <span className="text-[13px] font-medium text-[#68706c]">Receivables</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="hidden items-center gap-2 rounded-lg border border-[#dedfd9] bg-white px-3 py-2 text-[12px] text-[#68706c] shadow-sm sm:flex" onClick={() => setQuery("")}>
              <Search size={14} /> Search <kbd className="rounded bg-[#f1f1ed] px-1.5 py-0.5 font-mono text-[10px]">⌘ K</kbd>
            </button>
            <button className="grid h-8 w-8 place-items-center rounded-lg border border-[#dedfd9] bg-white text-[#68706c]" onClick={() => setReminded(false)}><Bell size={15} /></button>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#d7e2d5] text-[11px] font-bold text-[#365148]">EL</div>
          </div>
        </header>

        <main className="flex flex-1 flex-col px-5 py-6 sm:px-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.13em] text-[#8a918b]">Monday, September 14</p>
              <h1 className="text-[28px] font-bold tracking-[-.04em]">Invoice command center</h1>
              <p className="mt-1 text-[13px] text-[#737a76]">A focused queue for money that needs your attention.</p>
            </div>
            <button onClick={() => setShowComposer(true)} className="flex items-center gap-2 rounded-[9px] bg-[#1f3a35] px-4 py-2.5 text-[13px] font-bold text-[#f7f7f4] shadow-[0_2px_0_#122a25] transition-transform hover:-translate-y-0.5"><Plus size={16} /> New invoice</button>
          </div>

          <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Open balance", "$103,815", "across 11 invoices", "#e9efe5"],
              ["Needs attention", "3 invoices", "$52,895 at risk", "#f7e4d8"],
              ["Collected this month", "$74,280", "↑ 12.8% vs August", "#e3edf0"],
              ["Average days to pay", "18.4 days", "down from 21.1", "#eee7f0"],
            ].map(([label, value, note, color], i) => (
              <button key={label} onClick={() => i === 1 && setActive("Needs follow-up")} className="rounded-xl border border-[#dedfd9] bg-white p-4 text-left transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-[.09em] text-[#7c8580]"><span>{label}</span><span className="h-2 w-2 rounded-full" style={{ background: color }} /></div>
                <div className="font-mono text-[22px] font-semibold tracking-[-.04em]">{value}</div>
                <div className="mt-1 text-[11px] text-[#858d88]">{note}</div>
              </button>
            ))}
          </section>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-2.5 text-[#929a95]" size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a client, project, or invoice…" className="w-full rounded-lg border border-[#dedfd9] bg-white py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#789389]" />
            </div>
            <div className="flex rounded-lg border border-[#dedfd9] bg-white p-1">
              {(["All", "Needs follow-up", "Awaiting payment", "Paid"] as const).map((tab) => <button key={tab} onClick={() => setActive(tab)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${active === tab ? "bg-[#1f3a35] text-white" : "text-[#737a76] hover:bg-[#f1f2ee]"}`}>{tab === "Needs follow-up" ? "Attention" : tab}</button>)}
            </div>
            <button className="grid h-9 w-9 place-items-center rounded-lg border border-[#dedfd9] bg-white text-[#68706c]"><SlidersHorizontal size={15} /></button>
          </div>

          <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
            <section className="grid gap-3 md:grid-cols-3">
              {(["Needs follow-up", "Awaiting payment", "Paid"] as const).map((group) => (
                <div key={group} className="min-w-0">
                  <div className="mb-2 flex items-center justify-between px-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${group === "Needs follow-up" ? "bg-[#d36d4c]" : group === "Paid" ? "bg-[#73a37c]" : "bg-[#d3a35b]"}`} /><h2 className="text-[12px] font-bold">{group}</h2><span className="text-[11px] text-[#969d98]">{grouped[group].length}</span></div><button className="text-[#9aa19c]"><MoreHorizontal size={15} /></button></div>
                  <div className="space-y-2">
                    {grouped[group].map((invoice) => <button key={invoice.id} onClick={() => setSelected(invoice)} className={`w-full rounded-xl border bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${selected.id === invoice.id ? "border-[#698679] ring-1 ring-[#b9cbbb]" : "border-[#dedfd9]"}`}>
                      <div className="mb-3 flex items-start justify-between"><div className="flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold text-[#4d5b51]" style={{ background: invoice.tint }}>{invoice.initials}</div><MoreHorizontal size={15} className="text-[#9ba19d]" /></div>
                      <div className="text-[12px] font-bold">{invoice.client}</div><div className="mt-0.5 truncate text-[11px] text-[#818983]">{invoice.project}</div>
                      <div className="mt-4 flex items-end justify-between"><span className="font-mono text-[13px] font-semibold">{invoice.amount}</span><span className={`text-[10px] font-semibold ${group === "Needs follow-up" ? "text-[#c76446]" : "text-[#7b8580]"}`}>{invoice.due}</span></div>
                      <div className="mt-3 flex items-center justify-between border-t border-[#eff0eb] pt-2 text-[10px] text-[#9aa19c]"><span>{invoice.number}</span><span className="flex items-center gap-1"><Clock3 size={11} /> updated 2h</span></div>
                    </button>)}
                    {grouped[group].length === 0 && <div className="rounded-xl border border-dashed border-[#d8dbd5] p-6 text-center text-[11px] text-[#9aa19c]">Nothing here</div>}
                  </div>
                </div>
              ))}
            </section>

            <aside className="rounded-xl border border-[#dedfd9] bg-white p-5 lg:sticky lg:top-4 lg:h-fit">
              <div className="mb-5 flex items-start justify-between"><div><p className="mb-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#909792]">Selected invoice</p><h2 className="text-[18px] font-bold tracking-[-.03em]">{selected.number}</h2></div><button className="text-[#9ca39e]"><X size={16} /></button></div>
              <div className="mb-5 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full text-[11px] font-bold text-[#4d5b51]" style={{ background: selected.tint }}>{selected.initials}</div><div><div className="text-[13px] font-bold">{selected.client}</div><div className="text-[11px] text-[#858d88]">{selected.project}</div></div></div>
              <div className="rounded-lg bg-[#f5f6f2] p-3"><div className="text-[10px] uppercase tracking-[.1em] text-[#89918b]">Balance due</div><div className="mt-1 font-mono text-[25px] font-semibold">{selected.amount}</div><div className="mt-1 flex items-center gap-1 text-[11px] text-[#c76446]"><AlertCircle size={12} /> {selected.due}</div></div>
              <div className="my-5 space-y-3 border-y border-[#eff0eb] py-4 text-[11px]"><div className="flex justify-between"><span className="text-[#8c948f]">Issue date</span><span>Aug 14, 2026</span></div><div className="flex justify-between"><span className="text-[#8c948f]">Payment terms</span><span>Net 30</span></div><div className="flex justify-between"><span className="text-[#8c948f]">Last viewed</span><span>Sep 12, 10:42 AM</span></div></div>
              <div className="space-y-2"><button onClick={() => setReminded(true)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1f3a35] py-2.5 text-[12px] font-bold text-white">{reminded ? <Check size={14} /> : <Mail size={14} />}{reminded ? "Reminder queued" : "Send payment reminder"}</button><button className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#dedfd9] py-2.5 text-[12px] font-semibold text-[#53605a]"><FileText size={14} /> View invoice</button></div>
              <div className="mt-5 flex items-center gap-2 rounded-lg bg-[#f5f6f2] px-3 py-2 text-[10px] text-[#7f8882]"><Sparkles size={13} className="text-[#b4864f]" /> Best next action: follow up today</div>
            </aside>
          </div>
        </main>
      </div>

      {showComposer && <div className="fixed inset-0 z-20 grid place-items-center bg-[#1f2b28]/25 p-4"><div className="w-full max-w-md rounded-2xl border border-[#dedfd9] bg-[#fbfbf8] p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-bold">Start an invoice</h2><button onClick={() => setShowComposer(false)}><X size={17} /></button></div><p className="mb-4 text-[12px] text-[#737a76]">Choose a workflow to get the right details in front of you.</p><div className="space-y-2">{["From an active job", "Duplicate an existing invoice", "Start from a blank invoice"].map((item, i) => <button key={item} onClick={() => setShowComposer(false)} className="flex w-full items-center justify-between rounded-xl border border-[#dedfd9] bg-white p-3 text-left text-[12px] font-semibold hover:border-[#789389]"><span className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#e9efe5] text-[#466054]">{i + 1}</span>{item}</span><ArrowUpRight size={14} className="text-[#8e9891]" /></button>)}</div></div></div>}
    </div>
  );
}