import { businessDay } from "./business-time";

// Pre-fills Gusto's state "withholding allowance" question from the value the
// admin entered on the JobsOxo employee (e.g. NY IT-2104 box 1), so the
// employee doesn't hit an empty required field in Gusto's onboarding.
//
// Only ever fills a question Gusto asks and that has no answer yet, and only
// when the admin actually entered a number. Other tax questions are untouched.

export type GustoCall = <T = any>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

export type PrefillResult =
  | { outcome: "set"; states: string[] }
  | { outcome: "already_set" | "not_asked" | "skipped" };

const QUESTION = "withholding_allowance";

function hasAnswer(question: any): boolean {
  const value = question?.answers?.[0]?.value;
  return value !== undefined && value !== null && value !== "";
}

export async function prefillWithholdingAllowance(call: GustoCall, employeeUuid: string, allowances: number | null | undefined): Promise<PrefillResult> {
  if (allowances === null || allowances === undefined || !Number.isInteger(allowances) || allowances < 0) return { outcome: "skipped" };
  const stateTaxes = await call<any[]>(`/v1/employees/${employeeUuid}/state_taxes`);
  const blocks = Array.isArray(stateTaxes) ? stateTaxes : [];
  const asked = blocks.filter((block) => (block.questions ?? []).some((q: any) => q.key === QUESTION));
  if (asked.length === 0) return { outcome: "not_asked" };
  const empty = asked.filter((block) => !hasAnswer(block.questions.find((q: any) => q.key === QUESTION)));
  if (empty.length === 0) return { outcome: "already_set" };
  await call(`/v1/employees/${employeeUuid}/state_taxes`, {
    method: "PUT",
    body: {
      states: empty.map((block) => ({
        state: block.state,
        questions: [{ key: QUESTION, answers: [{ value: allowances, valid_from: businessDay() }] }],
      })),
    },
  });
  return { outcome: "set", states: empty.map((block) => block.state) };
}
