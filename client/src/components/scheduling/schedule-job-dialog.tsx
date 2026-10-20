import { useIsMutating } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import JobForm from "@/components/job-form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatScheduleDate, parseScheduleDate, type ScheduleJob } from "@/pages/scheduling-logic";

interface ScheduleJobDialogProps {
  open: boolean;
  job: ScheduleJob | null;
  jobs: ScheduleJob[];
  isLoading: boolean;
  isError: boolean;
  onSelect: (job: ScheduleJob) => void;
  onClose: () => void;
}

export function ScheduleJobDialog({ open, job, jobs, isLoading, isError, onSelect, onClose }: ScheduleJobDialogProps) {
  // The shared JobForm uses an unkeyed mutation; don't dismiss its editor during a save.
  const saving = useIsMutating() > 0;
  const close = () => { if (!saving) onClose(); };
  const eligible = jobs.filter((entry) => entry.status !== "completed");
  const editorJob = job ? { ...job, startDate: parseScheduleDate(job.startDate), endDate: parseScheduleDate(job.endDate) } : null;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent key={job?.id ?? "chooser"} className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden rounded-[24px] border-jx-line bg-card p-0 text-jx-ink sm:max-w-[720px]" data-testid={job ? "dialog-schedule-job" : "dialog-schedule-chooser"}>
      <DialogHeader className="shrink-0 border-b border-jx-line px-5 py-4 sm:px-7">
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-jx-green-ink">{job ? "Schedule job" : "Crew assignment"}</p>
        <DialogTitle className="break-words pr-5 font-display text-2xl !font-bold leading-tight tracking-[-.04em]">{job?.title ?? "Choose a job"}</DialogTitle>
        <DialogDescription className="text-sm text-jx-ink-2">{saving ? "Saving the job. Please keep this window open." : job ? "Set real dates and the crew assigned to this site." : "Open a job to set its dates and assign its crew."}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        {editorJob ? <JobForm job={editorJob} onSuccess={onClose} onClose={close} />
          : isLoading ? <p role="status" className="p-5 text-sm text-jx-ink-2">Loading jobs…</p>
            : isError ? <p role="alert" className="p-5 text-sm text-jx-orange-ink">Jobs are unavailable. Close this window and retry the schedule.</p>
              : eligible.length === 0 ? <p className="p-5 text-sm text-jx-ink-2">There are no active jobs to assign.</p>
                : eligible.map((entry) => <button key={entry.id} type="button" onClick={() => onSelect(entry)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-jx-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-jx-green" data-testid={`button-choose-job-${entry.id}`}>
                  <span className="min-w-0"><span className="block truncate text-sm font-bold">{entry.title}</span><span className="mt-0.5 block truncate text-xs text-jx-ink-2">{entry.client?.name ?? "Client not set"} · {entry.startDate ? formatScheduleDate(entry.startDate) : "Needs dates"}</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-jx-ink-3" />
                </button>)}
      </div>
    </DialogContent>
  </Dialog>;
}
