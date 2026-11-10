// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptScanDialog } from "./receipt-scan-dialog";
import { queryClient } from "@/lib/queryClient";
import type { ReceiptScan } from "@shared/receipt-scan";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const jobs = [{ id: "job-a", title: "Hotel restoration" }, { id: "job-b", title: "Lobby repairs" }] as never[];
const scan: ReceiptScan = {
  isReceipt: true,
  vendor: "Sherwin-Williams",
  purchaseDate: "2026-11-07",
  items: [
    { name: "ProMar 200 eggshell", description: "Extra white, 1 gal", quantity: 3, unit: "each", price: 134.97 },
    { name: "Painter's tape", description: null, quantity: 2, unit: "each", price: 13.5 },
  ],
  tax: 9.65,
  total: 158.12,
  warnings: ["The second line was partly torn."],
};

let available: boolean;
let scanResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;
const onOpenChange = vi.fn();

function mount(props: Partial<Parameters<typeof ReceiptScanDialog>[0]> = {}) {
  return render(<QueryClientProvider client={queryClient}><ReceiptScanDialog open onOpenChange={onOpenChange} jobs={jobs} {...props} /></QueryClientProvider>);
}
function pickFile(type = "image/jpeg") {
  const file = new File(["fake"], "receipt.jpg", { type });
  fireEvent.change(screen.getByTestId("input-receipt-file"), { target: { files: [file] } });
}
function posts(path: string) { return fetchMock.mock.calls.filter(([url, init]) => String(url) === path && init?.method === "POST"); }

describe("ReceiptScanDialog", () => {
  beforeEach(() => {
    queryClient.clear(); toast.mockReset(); onOpenChange.mockReset();
    available = true;
    scanResponse = () => Response.json(scan);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => {} }));
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/materials/scan-receipt/status") return Response.json({ available });
      if (path === "/api/materials/scan-receipt") return scanResponse();
      if (path === "/api/materials/bulk") {
        const body = JSON.parse(String(init?.body));
        return Response.json(body.materials.map((m: object, i: number) => ({ id: `m-${i}`, ...m })), { status: 201 });
      }
      return Response.json({ error: `Unexpected ${path}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("scans a receipt, shows the lines for review and saves the kept ones to the chosen job", async () => {
    mount({ defaultJobId: "job-a" });
    expect(screen.getByTestId("receipt-dropzone")).toBeTruthy();
    pickFile();
    await screen.findByTestId("receipt-items");
    expect(posts("/api/materials/scan-receipt")[0][1]?.body).toBeInstanceOf(FormData);

    expect((screen.getByTestId("input-receipt-vendor") as HTMLInputElement).value).toBe("Sherwin-Williams");
    expect((screen.getByTestId("input-receipt-date") as HTMLInputElement).value).toBe("2026-11-07");
    expect(screen.getByTestId("receipt-warning").textContent).toContain("partly torn");
    expect(screen.queryByTestId("receipt-total-mismatch")).toBeNull();
    expect(screen.getByTestId("text-receipt-total").textContent).toBe("$148.47");

    // Drop the tape and fix a misread price; the total and the mismatch note follow.
    fireEvent.click(screen.getByTestId("check-receipt-item-scan-1"));
    fireEvent.change(screen.getByTestId("input-receipt-price-scan-0"), { target: { value: "130.00" } });
    expect(screen.getByTestId("text-receipt-total").textContent).toBe("$130.00");
    expect(screen.getByTestId("receipt-total-mismatch").textContent).toContain("add up to $130.00");

    fireEvent.click(screen.getByTestId("button-save-receipt"));
    await waitFor(() => expect(posts("/api/materials/bulk")).toHaveLength(1));
    const body = JSON.parse(String(posts("/api/materials/bulk")[0][1]?.body));
    expect(body.materials).toEqual([{
      jobId: "job-a", name: "ProMar 200 eggshell", description: "Extra white, 1 gal", purchaseDate: "2026-11-07",
      vendor: "Sherwin-Williams", quantity: "3", unit: "each", price: "130.00",
    }]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "1 purchase logged from the receipt" }));
  });

  it("explains when the server can't read the file and lets the person try another", async () => {
    scanResponse = () => Response.json({ error: "That file couldn't be read. Try a clearer photo or a smaller file." }, { status: 502 });
    mount();
    pickFile();
    expect((await screen.findByTestId("receipt-error")).textContent).toContain("Try a clearer photo");
    expect(screen.getByTestId("receipt-dropzone")).toBeTruthy();
    expect(posts("/api/materials/bulk")).toHaveLength(0);
  });

  it("refuses files that aren't photos or PDFs without calling the server", async () => {
    mount();
    pickFile("text/plain");
    expect((await screen.findByTestId("receipt-error")).textContent).toContain("Use a JPEG, PNG, WebP or GIF photo, or a PDF.");
    expect(posts("/api/materials/scan-receipt")).toHaveLength(0);
  });

  it("flags a non-receipt and blocks saving until a kept line is complete", async () => {
    scanResponse = () => Response.json({ ...scan, isReceipt: false, items: [], total: null, tax: null, warnings: [] });
    mount();
    pickFile();
    await screen.findByTestId("receipt-not-receipt");
    const save = screen.getByTestId("button-save-receipt") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-add-receipt-line"));
    const row = within(screen.getByTestId("receipt-items")).getAllByRole("row")[1];
    fireEvent.change(within(row).getByLabelText("Material name"), { target: { value: "Drop cloth" } });
    fireEvent.change(within(row).getByLabelText("Line total"), { target: { value: "24.99" } });
    expect(save.disabled).toBe(false);
  });

  it("says so when scanning isn't set up on the server", async () => {
    available = false;
    mount();
    await screen.findByTestId("receipt-scan-unavailable");
    expect((screen.getByTestId("button-choose-receipt") as HTMLButtonElement).disabled).toBe(true);
  });
});
