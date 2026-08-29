import type { ReactNode } from 'react';

// Bedrock briefs use lightweight markdown (**bold** spans, plain newlines
// for paragraphs/lists) — this renders just enough of that to read well
// without pulling in a markdown library. Splits into plain-text/<strong>
// React nodes rather than dangerouslySetInnerHTML.
export function formatBriefText(text: string): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}
