// Employee pay in JobsOxo is a day rate. Hours convert through a standard
// 8-hour day, the same assumption the Gusto import (rate × 8) and invite
// (rate ÷ 8) use, so local estimates line up with the provider's hourly rate.
export const HOURS_PER_DAY = 8;

export function hourlyRateFromDayRate(dayRate: number | string): number {
  const rate = Number(dayRate);
  return Number.isFinite(rate) ? rate / HOURS_PER_DAY : 0;
}

/** Local gross estimate for straight-time hours. Gusto's calculation is authoritative. */
export function estimatedPayForHours(hours: number | string, dayRate: number | string): number {
  const worked = Number(hours);
  return Number.isFinite(worked) ? worked * hourlyRateFromDayRate(dayRate) : 0;
}
