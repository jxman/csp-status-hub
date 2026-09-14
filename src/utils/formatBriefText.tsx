import type { ReactNode } from 'react';

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const RULE_RE = /^(-{3,}|_{3,}|\*{3,})\s*$/;

function formatInline(line: string, key: string | number): ReactNode[] {
  const parts = line.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={`${key}-${i}`}>{part}</strong> : part));
}

// Bedrock briefs use lightweight markdown: **bold** spans, plain newlines for
// paragraphs/lists, and — it turns out — #/##/### headings and --- rules for
// section structure. Renders that subset into React nodes rather than
// dangerouslySetInnerHTML. Plain lines still rely on .brief-text's
// `white-space: pre-wrap` for line breaks (a bare '\n' string node between
// them); headings/rules are block-level elements so they always start a new
// line regardless, and are excluded from the '\n'-joining so they don't
// leave a stray blank line above or below themselves.
export function formatBriefText(text: string): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let prevWasBlock = true;

  lines.forEach((line, i) => {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3);
      nodes.push(
        <div key={i} className={`brief-heading brief-heading-${level}`}>
          {formatInline(headingMatch[2], i)}
        </div>
      );
      prevWasBlock = true;
      return;
    }
    if (RULE_RE.test(line.trim())) {
      nodes.push(<hr key={i} className="brief-rule" />);
      prevWasBlock = true;
      return;
    }
    if (!prevWasBlock) nodes.push('\n');
    nodes.push(<span key={`t${i}`}>{formatInline(line, i)}</span>);
    prevWasBlock = false;
  });

  return nodes;
}
