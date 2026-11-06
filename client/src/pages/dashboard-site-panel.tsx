import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface JobDocumentMeta {
  id: string;
  jobId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface FeaturedJob {
  id: string;
  title: string;
  status: string;
  client: { name: string } | null;
}

type PhotoState = "loading" | "ready" | "error" | "empty";

function SitePhoto({
  document,
  onState,
}: {
  document?: JobDocumentMeta;
  onState: (state: PhotoState) => void;
}) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setImage(null);
    setFailed(false);
    onStateRef.current(document ? "loading" : "empty");
    if (!document) return;

    fetch(`/api/job-documents/${encodeURIComponent(document.id)}/download`, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load job photo");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ id: document.id, url: objectUrl });
        onStateRef.current("ready");
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        onStateRef.current("error");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document?.id]);

  if (!document || failed || image?.id !== document.id) return null;
  return (
    <img
      src={image.url}
      alt={`Site photo: ${document.fileName}`}
      className="absolute inset-0 z-0 h-full w-full object-cover"
      onError={() => {
        setFailed(true);
        onStateRef.current("error");
      }}
    />
  );
}

export default function DashboardSitePanel({
  job,
  todayJobIds,
  jobsLoading,
  jobsError,
  onRetryJobs,
}: {
  job?: FeaturedJob;
  todayJobIds: string[];
  jobsLoading: boolean;
  jobsError: boolean;
  onRetryJobs: () => void;
}) {
  const [photoState, setPhotoState] = useState<PhotoState>("empty");
  const { data: documents, isLoading: documentsLoading, isError: documentsError, refetch } = useQuery<JobDocumentMeta[]>({
    queryKey: ["/api/jobs", job?.id ?? "", "documents"],
    enabled: !!job?.id,
  });
  const photo = documents?.find((doc) => doc.fileType.toLowerCase().startsWith("image/"));
  const isToday = !!job && todayJobIds.includes(job.id);
  const statusLabel = job?.status === "in_progress"
    ? "IN PROGRESS"
    : isToday ? "SCHEDULED TODAY" : job ? "JOB FILE" : "SITE WORK";

  return (
    <div className="relative min-h-[320px] min-w-0 overflow-hidden rounded-[24px] border" style={{ background: "var(--jx-green-tint)", borderColor: "var(--jx-line)" }}>
      {job && <SitePhoto document={photo} onState={setPhotoState} />}
      <div
        className="absolute inset-0 z-[1]"
        style={{ background: photoState === "ready" ? "linear-gradient(180deg,rgba(12,20,14,.03) 22%,rgba(12,20,14,.54) 100%)" : "var(--jx-green-tint)" }}
        aria-hidden="true"
      />
      {photoState !== "ready" && (
        <div className="absolute inset-0 z-[2] flex items-center justify-center" aria-hidden="true">
          {jobsError || documentsError || photoState === "error"
            ? <ImageOff className="h-12 w-12" style={{ color: "var(--jx-green)" }} />
            : <BriefcaseBusiness className="h-12 w-12" style={{ color: "var(--jx-green)" }} />}
        </div>
      )}

      {jobsError ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-5 text-center">
          <AlertCircle className="mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
          <h2 className="font-display text-xl font-bold">Couldn’t load jobs</h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">Your site photo and job list are unavailable right now.</p>
          <Button variant="outline" className="mt-4 rounded-full" onClick={onRetryJobs}>Retry</Button>
        </div>
      ) : job ? (
        <Link
          href={`/jobs/${job.id}`}
          className="absolute inset-0 z-10 flex min-w-0 flex-col justify-between p-5 text-inherit no-underline sm:p-6"
          aria-label={`Open job ${job.title}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span
              className="rounded-full px-3 py-1.5 text-[10px] font-bold tracking-[.12em]"
              style={{
                color: photoState === "ready" ? "white" : "var(--jx-green-ink)",
                background: photoState === "ready" ? "rgba(18,20,18,.44)" : "hsl(var(--card))",
              }}
            >
              {statusLabel}
            </span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: "hsl(var(--card))", color: "var(--jx-green-ink)" }}>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div
            className="relative z-10 min-w-0 rounded-[17px] border p-4 sm:p-5"
            style={{
              background: "hsl(var(--card))",
              color: "hsl(var(--foreground))",
              borderColor: "hsl(var(--border))",
            }}
          >
            <div className="truncate text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--jx-green-ink)" }}>
              {job.client?.name ?? "Job"}
            </div>
            <h2 className="mt-1 break-words font-display text-[22px] !font-bold leading-tight tracking-[-.035em] sm:text-[25px]">{job.title}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {documentsLoading || photoState === "loading"
                ? <><Clock3 className="h-3.5 w-3.5 shrink-0" />Loading job files…</>
                : photoState === "ready"
                  ? <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Site photo from job files</>
                  : documentsError || photoState === "error"
                    ? <><ImageOff className="h-3.5 w-3.5 shrink-0" />Photo unavailable · open job files</>
                    : <><BriefcaseBusiness className="h-3.5 w-3.5 shrink-0" />View job details and documents</>}
            </p>
          </div>
        </Link>
      ) : jobsLoading ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-5 text-center">
          <BriefcaseBusiness className="mb-3 h-9 w-9" style={{ color: "var(--jx-green)" }} aria-hidden="true" />
          <h2 className="font-display text-xl font-bold">Loading job files</h2>
          <p className="mt-1 text-sm text-muted-foreground">Finding a current job and its photos.</p>
        </div>
      ) : (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-5 text-center">
          <BriefcaseBusiness className="mb-3 h-9 w-9" style={{ color: "var(--jx-green)" }} aria-hidden="true" />
          <h2 className="font-display text-xl font-bold">Your site photo goes here</h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">Add a job to keep site work and invoices together.</p>
          <Link href="/jobs" className="mt-4 inline-flex items-center gap-1 text-sm font-bold no-underline" style={{ color: "var(--jx-green-ink)" }}>
            View jobs <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
      {job && !jobsError && documentsError && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void refetch();
          }}
          className="absolute right-5 top-[66px] z-20 rounded-full border px-3 py-1.5 text-xs font-semibold"
          style={{ background: "hsl(var(--card))", color: "var(--jx-green-ink)", borderColor: "hsl(var(--border))" }}
        >
          Retry files
        </button>
      )}
    </div>
  );
}
