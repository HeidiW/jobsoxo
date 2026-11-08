// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayrollSummary } from "../payroll-summary";

describe("PayrollSummary", () => {
  it("labels local values as estimates separate from Gusto", () => {
    render(<PayrollSummary loading={false} items={[
      { label: "Local net estimate", value: "$1,240", testId: "local-net", tone: "gold" },
    ]} />);

    expect(screen.getByRole("region", { name: "Pay run history summary" })).toBeTruthy();
    expect(screen.getByText(/Estimates from JobsOxo records/)).toBeTruthy();
    expect(screen.getByTestId("local-net").textContent).toBe("$1,240");
  });

  it("shows a labeled skeleton while payroll values load", () => {
    render(<PayrollSummary loading items={[
      { label: "Gross this period", value: "$0", testId: "gross" },
    ]} />);

    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(screen.queryByTestId("gross")).toBeNull();
  });
});
