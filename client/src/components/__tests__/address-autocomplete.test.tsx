// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressAutocomplete, type AddressDetails } from "@/components/address-autocomplete";

const suggestion = {
  placeId: "preview-place",
  label: "18 Example Street, Test City",
  mainText: "18 Example Street",
  secondaryText: "Test City",
};
const details = {
  formattedAddress: "18 Example Street, Test City, ZZ 12345",
  streetAddress: "18 Example Street",
  city: "Test City",
  state: "ZZ",
  postalCode: "12345",
  country: "US",
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

function AddressField({ onSelect = vi.fn() }: { onSelect?: (address: AddressDetails) => void }) {
  const [value, setValue] = useState("18 Example Street");
  return <AddressAutocomplete aria-label="Street address" value={value} onChange={setValue} onAddressSelect={onSelect} />;
}

async function finishDebounce() {
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

describe("Address autocomplete focus and async results", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      response(String(input).includes("/api/address-details") ? details : [suggestion]),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not open for a prefilled, unfocused field, but opens cached results on focus", async () => {
    render(<AddressField />);
    await finishDebounce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("does not reopen when a pending lookup completes after blur", async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    render(<AddressField />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await finishDebounce();
    fireEvent.blur(input);
    await act(async () => { complete(response([suggestion])); });
    await finishDebounce();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("18 Example Street");
  });

  it("keeps pending suggestions dismissed after Escape and allows a new search", async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    render(<AddressField />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await finishDebounce();
    fireEvent.keyDown(input, { key: "Escape" });
    await act(async () => { complete(response([suggestion])); });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "19 Example Street" } });
    await finishDebounce();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("preserves keyboard selection and structured address lookup", async () => {
    const onSelect = vi.fn();
    render(<AddressField onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await finishDebounce();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "address-suggestion-0");
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(onSelect).toHaveBeenCalledWith(details);
    expect(input).toHaveValue(details.formattedAddress);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps address entry available when suggestions are rate limited", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "Rate limited" }, 429));
    render(<AddressField />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await finishDebounce();
    expect(screen.getByRole("status")).toHaveTextContent("paused briefly");
    expect(input).toHaveValue("18 Example Street");
    expect(input).not.toBeDisabled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
