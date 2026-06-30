import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, Plus,
} from "lucide-react";
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval,
  startOfMonth, endOfMonth, isSameMonth, isToday,
  addDays, addMonths, subMonths, addWeeks, subWeeks,
} from "date-fns";
import type { Job, Client, Employee } from "@shared/schema";

interface JobWithRelations extends Job { client?: Client; assignedEmployees?: Employee[]; }

// ── Block colour palette (cycles by stable job order) ─────────────────────────
const BLOCK = [
  { bg: "var(--bl-bg)", fg: "var(--bl-fg)", bd: "var(--bl-bd)" },
  { bg: "var(--gr-bg)", fg: "var(--gr-fg)", bd: "var(--gr-bd)" },
  { bg: "var(--pu-bg)", fg: "var(--pu-fg)", bd: "var(--pu-bd)" },
  { bg: "var(--am-bg)", fg: "var(--am-fg)", bd: "var(--am-bd)" },
];
const AV_BG = ["--av1","--av2","--av3","--av4","--av5","--av6"];
const AV_FG = ["--av1f","--av2f","--av3f","--av4f","--av5f","--av6f"];

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function weekDays(anchor: Date): Date[] {
  const mon = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 6 }, (_, i) => addDays(mon, i)); // Mon–Sat
}

function jobsForDay(jobs: JobWithRelations[], day: Date): { job: JobWithRelations; idx: number }[] {
  const d = day.getTime();
  return jobs.reduce<{ job: JobWithRelations; idx: number }[]>((acc, job, idx) => {
    if (!job.startDate) return acc;
    const s = new Date(job.startDate);
    s.setHours(0, 0, 0, 0);
    const e = job.endDate ? new Date(job.endDate) : new Date(s);
    e.setHours(23, 59, 59, 0);
    if (d >= s.getTime() && d <= e.getTime()) acc.push({ job, idx });
    return acc;
  }, []);
}

// ── Crew overlap row ──────────────────────────────────────────────────────────
function CrewPips({ employees, max = 4 }: { employees: Employee[]; max?: number }) {
  const shown = employees.slice(0, max);
  const extra = employees.length - shown.length;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {shown.map((emp, i) => (
        <div key={emp.id} style={{
          width: "20px", height: "20px", borderRadius: "50%",
          background: `var(${AV_BG[i % 6]})`, color: `var(${AV_FG[i % 6]})`,
          border: "2px solid var(--panel)", marginLeft: i === 0 ? 0 : "-6px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "9px", fontWeight: 700, flexShrink: 0, zIndex: i,
        }}>
          {initials(emp.name)}
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          width: "20px", height: "20px", borderRadius: "50%",
          background: "var(--track)", color: "var(--faint)",
          border: "2px solid var(--panel)", marginLeft: "-6px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "9px", fontWeight: 700, flexShrink: 0, zIndex: shown.length,
        }}>+{extra}</div>
      )}
    </div>
  );
}

// ── Job block card ────────────────────────────────────────────────────────────
function JobBlock({ job, colorIdx, employees }: { job: JobWithRelations; colorIdx: number; employees: Employee[] }) {
  const col = BLOCK[colorIdx % 4];
  return (
    <Link href="/jobs">
      <div data-testid={`job-block-${job.id}`} style={{
        display: "block", textDecoration: "none",
        border: `1px solid ${col.bd}`, background: col.bg,
        borderRadius: "9px", padding: "9px 10px",
        transition: "all .15s", cursor: "pointer",
      }}
        className="card">
        <div style={{ fontSize: "12px", fontWeight: 700, color: col.fg, lineHeight: 1.25 }}>
          {job.title}
        </div>
        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {job.client?.name ?? "—"}
        </div>
        {employees.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
            <CrewPips employees={employees} />
          </div>
        )}
      </div>
    </Link>
  );
}

// ── Month cell jobs ───────────────────────────────────────────────────────────
function MonthJobPip({ job, colorIdx }: { job: JobWithRelations; colorIdx: number }) {
  const col = BLOCK[colorIdx % 4];
  return (
    <Link href="/jobs">
      <div style={{ fontSize: "10.5px", fontWeight: 600, color: col.fg, background: col.bg, border: `1px solid ${col.bd}`, borderRadius: "5px", padding: "1px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} data-testid={`month-job-${job.id}`}>
        {job.title}
      </div>
    </Link>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Scheduling() {
  const [anchor, setAnchor] = useState(new Date());
  const [view, setView] = useState<"week" | "month">("week");
  const { toast } = useToast();

  const { data: jobs, isLoading: jobsLoading } = useQuery<JobWithRelations[]>({ queryKey: ["/api/jobs"] });
  const { data: employees } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const activeEmployees = useMemo(() => (employees ?? []).filter(e => e.status === "active"), [employees]);

  // Scheduled jobs = have a startDate and not just "quoted"
  const scheduledJobs = useMemo(() =>
    (jobs ?? []).filter(j => j.startDate && j.status !== "quoted" && j.status !== "completed"),
    [jobs]);

  // Backlog = no startDate OR status="quoted"
  const backlogJobs = useMemo(() =>
    (jobs ?? []).filter(j => !j.startDate || j.status === "quoted"),
    [jobs]);

  // Stable color index by position in full jobs list
  const colorMap = useMemo(() => {
    const m = new Map<string, number>();
    (jobs ?? []).forEach((j, i) => m.set(j.id, i));
    return m;
  }, [jobs]);

  // ── Week view ────────────────────────────────────────────────────────────────
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekStart = days[0];
  const weekEnd = days[days.length - 1];

  const isCurrentWeek = useMemo(() => {
    const todayMon = startOfWeek(new Date(), { weekStartsOn: 1 });
    return weekStart.getTime() === todayMon.getTime();
  }, [weekStart]);

  const crewsDeployed = useMemo(() => {
    const seen = new Set<string>();
    days.forEach(d => {
      jobsForDay(scheduledJobs, d).forEach(({ job }) => {
        (job.assignedEmployees ?? []).forEach(e => seen.add(e.id));
      });
    });
    return seen.size;
  }, [days, scheduledJobs]);

  const weekLabel = useMemo(() => {
    if (isCurrentWeek) return "This week";
    return `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`;
  }, [isCurrentWeek, weekStart, weekEnd]);

  // ── Month view ────────────────────────────────────────────────────────────────
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });

  // Subtitle
  const subtitle = view === "week"
    ? `Week of ${format(weekStart, "MMMM d")} – ${format(weekEnd, "d, yyyy")}${crewsDeployed > 0 ? ` · ${crewsDeployed} crew${crewsDeployed !== 1 ? "s" : ""} deployed` : ""}`
    : format(anchor, "MMMM yyyy");

  // ── Nav ────────────────────────────────────────────────────────────────────
  function prev() { view === "week" ? setAnchor(d => subWeeks(d, 1)) : setAnchor(d => subMonths(d, 1)); }
  function next() { view === "week" ? setAnchor(d => addWeeks(d, 1)) : setAnchor(d => addMonths(d, 1)); }
  function goToday() { setAnchor(new Date()); }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px 40px" }}>
      <div style={{ maxWidth: "1320px", margin: "0 auto" }}>

        {/* ── Title row ── */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-.02em" }}>Scheduling</h2>
            <p style={{ margin: "5px 0 0", fontSize: "13.5px", color: "var(--muted)" }}>{subtitle}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Week / period nav */}
            <div style={{ display: "flex", alignItems: "center", gap: "2px", background: "var(--track)", border: "1px solid var(--panel-bd)", borderRadius: "9px", padding: "3px" }}>
              <button onClick={prev} style={{ border: "none", background: "none", cursor: "pointer", width: "30px", height: "28px", borderRadius: "7px", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center" }} data-testid="button-prev-period">
                <ChevronLeft style={{ width: "16px", height: "16px" }} />
              </button>
              <button onClick={goToday} style={{ border: "none", background: "none", cursor: "pointer", fontSize: "12.5px", fontWeight: 600, padding: "0 8px", color: "var(--fg)", fontFamily: "inherit", borderRadius: "6px", height: "28px" }} data-testid="button-today">
                {isCurrentWeek && view === "week" ? "This week" : view === "week" ? weekLabel : format(anchor, "MMM yyyy")}
              </button>
              <button onClick={next} style={{ border: "none", background: "none", cursor: "pointer", width: "30px", height: "28px", borderRadius: "7px", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center" }} data-testid="button-next-period">
                <ChevronRight style={{ width: "16px", height: "16px" }} />
              </button>
            </div>
            {/* Week / Month toggle */}
            <div style={{ display: "flex", gap: "3px", background: "var(--track)", border: "1px solid var(--panel-bd)", borderRadius: "9px", padding: "3px" }}>
              {(["week", "month"] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  border: "none", cursor: "pointer", padding: "6px 13px", borderRadius: "7px",
                  fontSize: "12.5px", fontWeight: 700, fontFamily: "inherit",
                  background: view === v ? "var(--panel)" : "none",
                  color: view === v ? "var(--jox-primary)" : "var(--muted)",
                  boxShadow: view === v ? "0 1px 2px rgba(15,23,41,.1)" : "none",
                }} data-testid={`button-view-${v}`}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {/* Assign crew */}
            <button onClick={() => toast({ title: "Crew assignment", description: "Drag jobs onto days or use the Jobs page to set dates and crew." })}
              style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "9px 15px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(37,99,235,.3)" }}
              data-testid="button-assign-crew">
              <Plus style={{ width: "15px", height: "15px" }} /> Assign crew
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* ── WEEK BOARD ── */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {view === "week" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "12px", marginBottom: "22px", alignItems: "start" }}>
              {days.map(day => {
                const today = isToday(day);
                const dayBlocks = jobsForDay(scheduledJobs, day);
                return (
                  <div key={day.toISOString()} style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden", minHeight: "300px", display: "flex", flexDirection: "column" }}
                    data-testid={`day-col-${format(day, "EEE").toLowerCase()}`}>
                    {/* Day header */}
                    <div style={{ padding: "11px 13px", borderBottom: "1px solid var(--panel-bd)", background: today ? "var(--bl-bg)" : "var(--colhead)" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: today ? "var(--bl-fg)" : "var(--faint)" }}>
                        {format(day, "EEE")}
                      </div>
                      <div className="font-mono" style={{ fontSize: "18px", fontWeight: 600, color: "var(--fg)", lineHeight: 1.1, marginTop: "2px" }}>
                        {format(day, "d")}
                      </div>
                    </div>
                    {/* Day body */}
                    <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                      {dayBlocks.map(({ job, idx }) => (
                        <JobBlock key={job.id} job={job} colorIdx={colorMap.get(job.id) ?? idx} employees={job.assignedEmployees ?? activeEmployees.slice(0, 0)} />
                      ))}
                      {dayBlocks.length === 0 && (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px dashed var(--panel-bd)", borderRadius: "9px", color: "var(--faint)", fontSize: "11.5px", minHeight: "80px" }}>
                          No crews
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Unscheduled backlog ── */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "13px" }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#e0a020", flexShrink: 0 }} />
                <span style={{ fontSize: "14.5px", fontWeight: 600 }}>Unscheduled jobs</span>
                {backlogJobs.length > 0 && (
                  <span className="font-mono" style={{ fontSize: "11.5px", fontWeight: 600, padding: "1px 7px", borderRadius: "5px", background: "var(--am-bg)", color: "var(--am-fg)" }}>
                    {backlogJobs.length}
                  </span>
                )}
                <span style={{ fontSize: "12px", color: "var(--faint)" }}>Set a start date on the Jobs page to schedule</span>
              </div>

              {jobsLoading && (
                <div style={{ display: "flex", gap: "12px" }}>
                  {[1,2,3].map(i => <div key={i} style={{ width: "210px", height: "80px", background: "var(--track)", borderRadius: "10px", flexShrink: 0 }} />)}
                </div>
              )}

              {!jobsLoading && backlogJobs.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "var(--faint)", fontSize: "13px" }}>
                  All jobs are scheduled — 
                </div>
              )}

              {!jobsLoading && backlogJobs.length > 0 && (
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  {backlogJobs.map((job, i) => (
                    <Link key={job.id} href="/jobs">
                      <div className="card" style={{ textDecoration: "none", border: "1px solid var(--panel-bd)", background: "var(--track)", borderRadius: "10px", padding: "12px 14px", minWidth: "210px", maxWidth: "260px", transition: "all .15s", cursor: "pointer" }}
                        data-testid={`backlog-job-${job.id}`}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)" }}>{job.title}</div>
                        <div style={{ fontSize: "11.5px", color: "var(--faint)", marginTop: "2px" }}>
                          {job.client?.name ?? "—"} {job.address ? `· ${job.address}` : ""}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "9px" }}>
                          <span style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--am-fg)", background: "var(--am-bg)", padding: "2px 8px", borderRadius: "6px" }}>Needs date</span>
                          {job.status === "quoted" && (
                            <span style={{ fontSize: "10.5px", fontWeight: 600, color: "var(--faint)", padding: "2px 8px", borderRadius: "6px", background: "var(--b-gray-bg)" }}>Quoted</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* ── MONTH BOARD ── */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {view === "month" && (
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
            {/* Day-of-week header */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid var(--panel-bd)", background: "var(--colhead)" }}>
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                <div key={d} style={{ padding: "10px 8px", textAlign: "center", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--faint)" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
              {calDays.map((day, idx) => {
                const inMonth = isSameMonth(day, anchor);
                const today = isToday(day);
                const dayBlocks = jobsForDay(scheduledJobs, day);
                return (
                  <div key={idx} style={{
                    minHeight: "96px", padding: "6px", borderRight: "1px solid var(--panel-bd)", borderBottom: "1px solid var(--panel-bd)",
                    background: today ? "var(--bl-bg)" : !inMonth ? "var(--track)" : "var(--panel)",
                    opacity: !inMonth ? 0.55 : 1,
                  }} data-testid={`month-cell-${format(day, "yyyy-MM-dd")}`}>
                    <div className="font-mono" style={{ fontSize: "12px", fontWeight: today ? 700 : 400, color: today ? "var(--bl-fg)" : "var(--fg)", marginBottom: "4px", padding: "1px 4px" }}>
                      {format(day, "d")}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {dayBlocks.slice(0, 2).map(({ job }) => (
                        <MonthJobPip key={job.id} job={job} colorIdx={colorMap.get(job.id) ?? 0} />
                      ))}
                      {dayBlocks.length > 2 && (
                        <div style={{ fontSize: "10px", color: "var(--faint)", paddingLeft: "4px" }}>+{dayBlocks.length - 2} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
