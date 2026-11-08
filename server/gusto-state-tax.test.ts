import { describe, expect, it, vi } from "vitest";
import { prefillWithholdingAllowance } from "./gusto-state-tax";

const question = (key: string, value?: unknown) => ({ key, answers: value === undefined ? [] : [{ value, valid_from: "2026-01-01", valid_up_to: "" }] });

function fakeCall(stateTaxes: unknown) {
  const puts: unknown[] = [];
  const call = vi.fn(async (path: string, options: any = {}) => {
    if ((options.method ?? "GET") === "GET" && path === "/v1/employees/g-1/state_taxes") return stateTaxes;
    if (options.method === "PUT" && path === "/v1/employees/g-1/state_taxes") { puts.push(options.body); return {}; }
    throw new Error(`Unexpected ${options.method ?? "GET"} ${path}`);
  });
  return { call, puts };
}

describe("prefillWithholdingAllowance", () => {
  it("fills an empty withholding allowance for every state that asks", async () => {
    const { call, puts } = fakeCall([
      { state: "NY", questions: [question("filing_status", "S"), question("withholding_allowance"), question("additional_withholding", "0.0")] },
      { state: "NJ", questions: [question("withholding_allowance")] },
    ]);

    const result = await prefillWithholdingAllowance(call as any, "g-1", 2);

    expect(result).toEqual({ outcome: "set", states: ["NY", "NJ"] });
    expect(puts).toHaveLength(1);
    const body = puts[0] as any;
    expect(body.states.map((s: any) => s.state)).toEqual(["NY", "NJ"]);
    for (const state of body.states) {
      expect(state.questions).toHaveLength(1);
      expect(state.questions[0]).toMatchObject({ key: "withholding_allowance", answers: [{ value: 2 }] });
      expect(state.questions[0].answers[0].valid_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("never overwrites an answer Gusto already has", async () => {
    const { call, puts } = fakeCall([{ state: "NY", questions: [question("withholding_allowance", 1)] }]);
    expect(await prefillWithholdingAllowance(call as any, "g-1", 3)).toEqual({ outcome: "already_set" });
    expect(puts).toHaveLength(0);
  });

  it("does nothing when Gusto doesn't ask, or when no value was entered", async () => {
    const asked = fakeCall([{ state: "TX", questions: [question("file_new_hire_report")] }]);
    expect(await prefillWithholdingAllowance(asked.call as any, "g-1", 1)).toEqual({ outcome: "not_asked" });
    expect(asked.puts).toHaveLength(0);

    const blank = fakeCall([{ state: "NY", questions: [question("withholding_allowance")] }]);
    expect(await prefillWithholdingAllowance(blank.call as any, "g-1", null)).toEqual({ outcome: "skipped" });
    expect(await prefillWithholdingAllowance(blank.call as any, "g-1", undefined)).toEqual({ outcome: "skipped" });
    expect(await prefillWithholdingAllowance(blank.call as any, "g-1", -1)).toEqual({ outcome: "skipped" });
    expect(blank.call).not.toHaveBeenCalled();
  });
});
