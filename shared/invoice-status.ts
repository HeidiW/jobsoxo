// Invoice status after a payment changes the balance. Paid only when money
// has actually arrived; a zero-total invoice never auto-marks itself paid.
export function statusForBalance(current: string, balance: number, amountPaid: number): string {
  if (amountPaid > 0) return balance <= 0 ? "paid" : current === "paid" ? "partial" : current;
  return current === "paid" || current === "partial" ? "draft" : current;
}
