import type { ReactNode } from 'react';

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const RULE_RE = /^(-{3,}|_{3,}|\*{3,})\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
// **bold**, `code`, or *italic* (single asterisks, not touching whitespace
// on the inside so a stray "5 * 3" isn't read as emphasis).
const INLINE_RE = /(\*\*.+?\*\*|`[^`]+`|\*[^*\s](?:[^*]*[^*\s])?\*)/g;

function formatInline(line: string, key: string | number): ReactNode[] {
  return line.split(INLINE_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const k = `${key}-${i}`;
    if (part.startsWith('**')) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`')) return <code key={k}>{part.slice(1, -1)}</code>;
    return <em key={k}>{part.slice(1, -1)}</em>;
  });
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

// Bedrock briefs use lightweight markdown: **bold**/*italic*/`code` spans,
// plain newlines for paragraphs/lists, #/##/### headings, --- rules, and
// pipe tables (e.g. a "Priority | Action" next-steps table). Renders that
// subset into React nodes rather than dangerouslySetInnerHTML. Plain lines
// still rely on .brief-text's `white-space: pre-wrap` for line breaks (a
// bare '\n' string node between them); headings/rules/tables are block-level
// elements so they always start a new line regardless, and are excluded from
// the '\n'-joining so they don't leave a stray blank line above or below
// themselves.
export function formatBriefText(text: string): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let prevWasBlock = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A table is a header row immediately followed by a |---|---| separator;
    // a lone pipe-delimited line without one stays plain text.
    if (TABLE_ROW_RE.test(line) && TABLE_SEPARATOR_RE.test(lines[i + 1] ?? '')) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && TABLE_ROW_RE.test(lines[j])) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      nodes.push(
        <table key={i} className="brief-table">
          <thead>
            <tr>
              {header.map((cell, c) => (
                <th key={c}>{formatInline(cell, `${i}-h${c}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {header.map((_, c) => (
                  <td key={c}>{formatInline(row[c] ?? '', `${i}-${r}-${c}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      // Swallow the blank line that usually follows the table so it doesn't
      // render as an extra gap under a block element.
      if (lines[j]?.trim() === '') j++;
      i = j - 1;
      prevWasBlock = true;
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3);
      nodes.push(
        <div key={i} className={`brief-heading brief-heading-${level}`}>
          {formatInline(headingMatch[2], i)}
        </div>
      );
      prevWasBlock = true;
      continue;
    }
    if (RULE_RE.test(line.trim())) {
      nodes.push(<hr key={i} className="brief-rule" />);
      prevWasBlock = true;
      continue;
    }
    if (!prevWasBlock) nodes.push('\n');
    nodes.push(<span key={`t${i}`}>{formatInline(line, i)}</span>);
    prevWasBlock = false;
  }

  return nodes;
}
