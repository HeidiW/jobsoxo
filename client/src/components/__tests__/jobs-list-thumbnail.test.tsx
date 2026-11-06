// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import JobsListThumbnail from "../jobs-list-thumbnail";

class VisibleObserver {
  constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
  observe() { this.callback([{ isIntersecting: true }]); }
  disconnect() {}
}

function renderThumbnail(queryFn = vi.fn(async () => [
  { id: "photo", fileName: "site.svg", fileType: "image/svg+xml" },
])) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn } } });
  render(<QueryClientProvider client={client}><JobsListThumbnail jobId="job" title="Test site" /></QueryClientProvider>);
  return { client, queryFn };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Jobs list document thumbnails", () => {
  it("renders safely before metadata exists and does not fetch every job without visibility support", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { queryFn } = renderThumbnail();
    expect(screen.getByLabelText("No job photo for Test site")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("loads visible rows from the document endpoint and falls back after an invalid image", async () => {
    vi.stubGlobal("IntersectionObserver", VisibleObserver);
    const revoke = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:test-photo");
      static revokeObjectURL = revoke;
    });
    const fetchMock = vi.fn(async () => new Response("<svg />", { headers: { "Content-Type": "image/svg+xml" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderThumbnail();
    const image = await screen.findByRole("img", { name: "Job photo: Test site" });
    expect(fetchMock).toHaveBeenCalledWith("/api/job-documents/photo/download", { credentials: "include" });
    fireEvent.error(image);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Photo unavailable for Test site")).toBeInTheDocument();
    cleanup();
    expect(revoke).toHaveBeenCalledWith("blob:test-photo");
  });

  it("uses the fallback rather than a broken image when the download fails", async () => {
    vi.stubGlobal("IntersectionObserver", VisibleObserver);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    renderThumbnail();
    await waitFor(() => expect(screen.getByLabelText("Photo unavailable for Test site")).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
