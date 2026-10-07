import io

p = 'src/adapters/regulatory/benchmark-extractor.ts'
s = io.open(p, encoding='utf-8').read()

# 1. tableCell/tableRowFor return the RAW LINE too.
s = s.replace('''function tableCell(markdown: string, rowLabel: RegExp): string | null {
  const lines = markdown.split("\\n");
  for (const line of lines) {
    if (rowLabel.test(line) && line.trim().startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      // ["", "<label>", "<value>", ""] for a two-column table row
      return cells.length >= 3 ? cells[cells.length - 2] : null;
    }
  }
  return null;
}''', '''type CellMatch = { cell: string; line: string };

function tableCell(markdown: string, rowLabel: RegExp): CellMatch | null {
  const lines = markdown.split("\\n");
  for (const line of lines) {
    if (rowLabel.test(line) && line.trim().startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      // ["", "<label>", "<value>", ""] for a two-column table row
      if (cells.length >= 3) return { cell: cells[cells.length - 2], line };
    }
  }
  return null;
}''')
s = s.replace('''function tableRowFor(markdown: string, useLabel: RegExp): string | null {
  const lines = markdown.split("\\n");
  for (const line of lines) {
    if (useLabel.test(line) && line.trim().startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      return cells.length >= 3 ? cells[cells.length - 2] : null;
    }
  }
  return null;
}''', '''function tableRowFor(markdown: string, useLabel: RegExp): CellMatch | null {
  const lines = markdown.split("\\n");
  for (const line of lines) {
    if (useLabel.test(line) && line.trim().startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length >= 3) return { cell: cells[cells.length - 2], line };
    }
  }
  return null;
}''')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('helpers converted')
