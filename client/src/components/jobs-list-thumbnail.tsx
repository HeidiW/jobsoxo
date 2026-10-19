import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Image as ImageIcon } from "lucide-react";

interface JobDocumentMeta {
  id: string;
  fileName: string;
  fileType: string;
}

function useNearViewport(ref: RefObject<HTMLDivElement | null>) {
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof window.IntersectionObserver !== "function") {
      // Older browsers still get the honest placeholder rather than firing
      // hundreds of metadata requests without visibility information.
      return;
    }
    // Query document metadata only for rows near the viewport; this avoids one request per
    // job when a company has a long list, while warming the next few thumbnails during scroll.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return nearViewport;
}

export default function JobsListThumbnail({ jobId, title }: { jobId: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearViewport = useNearViewport(containerRef);
  const { data: documents, isError } = useQuery<JobDocumentMeta[]>({
    queryKey: ["/api/jobs", jobId, "documents"],
    enabled: isNearViewport,
    staleTime: 5 * 60 * 1000,
  });
  const imageDocument = documents?.find((document) => document.fileType.toLowerCase().startsWith("image/"));
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [failedDocumentId, setFailedDocumentId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setPreview(null);
    setFailedDocumentId(null);
    if (!imageDocument) return;

    fetch(`/api/job-documents/${encodeURIComponent(imageDocument.id)}/download`, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Job photo unavailable");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ id: imageDocument.id, url: objectUrl });
      })
      .catch(() => {
        if (active) {
          setPreview(null);
          setFailedDocumentId(imageDocument.id);
        }
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageDocument?.id]);

  const currentPreview = preview && preview.id === imageDocument?.id && preview.id !== failedDocumentId ? preview.url : null;
  return (
    <div
      ref={containerRef}
      className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-jx-green-tint text-jx-green-ink"
      aria-label={currentPreview ? `Document thumbnail for ${title}` : isError || failedDocumentId ? `Photo unavailable for ${title}` : `No job photo for ${title}`}
    >
      {currentPreview ? (
        <img src={currentPreview} alt={`Job photo: ${title}`} className="h-full w-full object-cover" onError={() => setFailedDocumentId(imageDocument?.id ?? null)} />
      ) : imageDocument ? (
        <ImageIcon className="h-5 w-5" aria-hidden="true" />
      ) : documents?.some((document) => document) ? (
        <FileText className="h-5 w-5" aria-hidden="true" />
      ) : (
        <BriefcaseMark />
      )}
    </div>
  );
}

function BriefcaseMark() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2.2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" />
    </svg>
  );
}
