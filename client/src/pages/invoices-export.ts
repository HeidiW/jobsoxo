export type InvoiceCsvRow = Record<string, string | number | null | undefined>;

function safeCsvCell(value: string | number | null | undefined): string {
  let cell = String(value ?? "");
  // Spreadsheet applications may execute formula-like values on open.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

export function invoicesToCsv(rows: InvoiceCsvRow[]): string {
  const columns = [
    ["Invoice", "invoiceNumber"],
    ["Client", "client"],
    ["Job", "job"],
    ["Issued", "issued"],
    ["Due", "due"],
    ["Status", "status"],
    ["Total", "total"],
    ["Balance", "balance"],
  ] as const;
  return [
    columns.map(([label]) => safeCsvCell(label)).join(","),
    ...rows.map((row) => columns.map(([, key]) => safeCsvCell(row[key])).join(",")),
  ].join("\r\n");
}
