import type { Element, ElementContent, Root, RootContent } from "hast";

/**
 * Prose tables: rows that are records of sentences rather than values to compare. On a narrow
 * column they stack (docs/typography.md, "Tables"); everything else stays a grid and scrolls
 * sideways if it must. The same line is drawn for agents in the brief (app/lib/agentPrompt.ts):
 * a table is for short values; a cell that needs a sentence belongs in a list.
 */
export const STACK_MIN_COLUMNS = 3;
export const STACK_MIN_CELL_CHARS = 60;

export function isProseTable(header: string[], rows: string[][]) {
  return header.length >= STACK_MIN_COLUMNS && rows.some(row => row.some(cell => cell.trim().length > STACK_MIN_CELL_CHARS));
}

const textOf = (node: ElementContent): string =>
  node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";
const elements = (node: Element, tag: string) =>
  node.children.filter((child): child is Element => child.type === "element" && child.tagName === tag);

function shape(table: Element) {
  const sections = [...elements(table, "thead"), ...elements(table, "tbody")];
  const headRow = elements(table, "thead").flatMap(head => elements(head, "tr"))[0];
  const header = headRow ? elements(headRow, "th").map(cell => textOf(cell).trim()) : [];
  const bodyRows = elements(table, "tbody").flatMap(body => elements(body, "tr"));
  const cells = (row: Element) => [...elements(row, "td"), ...elements(row, "th")];
  const prose = isProseTable(header, bodyRows.map(row => cells(row).map(textOf)));
  table.properties = { ...table.properties, dataShape: prose ? "prose" : "grid" };
  if (!prose) return;
  // Stacked rows are display: block, which drops table semantics in some browsers; say them.
  table.properties.role = "table";
  for (const section of sections) {
    section.properties = { ...section.properties, role: "rowgroup" };
    for (const row of elements(section, "tr")) {
      row.properties = { ...row.properties, role: "row" };
      for (const cell of elements(row, "th")) cell.properties = { ...cell.properties, role: "columnheader" };
      elements(row, "td").forEach((cell, index) => {
        cell.properties = { ...cell.properties, role: "cell", dataLabel: header[index] ?? "" };
      });
    }
  }
}

/** Rehype plugin: marks each table's shape, and labels a prose table's cells with their column. */
export function tableShapes() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => node.children.forEach((child: RootContent) => {
      if (child.type !== "element") return;
      if (child.tagName === "table") shape(child);
      walk(child);
    });
    walk(tree);
  };
}
