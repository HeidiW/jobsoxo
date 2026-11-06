import { CalendarDays, CircleDollarSign, Clock3, Landmark, UsersRound } from "lucide-react";

export type PayrollSummaryItem = {
  label: string;
  value: string;
  testId: string;
  tone?: "gold" | "green" | "amber";
  detail?: string;
};

export function PayrollSummary({ items, loading }: { items: PayrollSummaryItem[]; loading: boolean }) {
  const icons = [CircleDollarSign, UsersRound, Landmark, CalendarDays, Clock3];

  return (
    <section className="payroll-summary" aria-label="Local payroll summary" data-testid="payroll-summary">
      <div className="payroll-summary__intro">
        <span className="payroll-eyebrow">Local payroll history</span>
        <p>Reference estimates only. Gusto calculates actual payroll amounts and payment status.</p>
      </div>
      <div className="payroll-summary__grid">
        {items.map((item, index) => {
          const Icon = icons[index % icons.length];
          return (
            <article key={item.testId} className={`payroll-stat payroll-stat--${item.tone ?? "neutral"}`}>
              <Icon aria-hidden="true" className="payroll-stat__icon" />
              <span className="payroll-stat__label">{item.label}</span>
              {loading
                ? <span className="payroll-stat__skeleton" aria-label="Loading" />
                : <strong className="payroll-stat__value" data-testid={item.testId}>{item.value}</strong>}
              {item.detail && <span className="payroll-stat__detail">{item.detail}</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
