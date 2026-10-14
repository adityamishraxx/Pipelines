import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Shared PDF export — one or more tables in a single landscape PDF.
// tables: [{ heading?, columns: string[], rows: any[][] }]
export function exportRowsToPdf({ title, subtitle, tables, filename }) {
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 15);

  let y = 22;
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, 14, 21);
    y = 27;
  }

  tables.forEach(t => {
    if (t.heading) {
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(t.heading, 14, y);
      y += 4;
    }
    autoTable(doc, {
      head: [t.columns],
      body: t.rows,
      startY: y,
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
  });

  doc.save(filename);
}
