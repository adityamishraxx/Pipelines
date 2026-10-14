// Shared XLSX export helper. Builds a worksheet from an array of plain-object rows with:
//   * auto-sized columns (widest of the header / cell content, capped so a long note can't explode)
//   * an Excel auto-filter across the whole data range, so every column has a filter dropdown
// This keeps every export in the app consistently readable and filterable out of the box.
//
// `XLSX` is passed in (rather than imported here) so callers keep the existing dynamic
// `await import('xlsx')` and the library stays out of the main bundle.
export function writeFormattedSheet(XLSX, rows, sheetName, filename) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map(h => {
    let width = h.length + 2;
    for (const r of rows) {
      const len = String(r[h] ?? '').length + 2;
      if (len > width) width = len;
    }
    return { wch: Math.min(45, width) };
  });

  // Auto-filter dropdowns across the full table (header + data rows).
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
