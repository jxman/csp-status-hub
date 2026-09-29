// PDF template for the Incident Briefing Engine (see README.md's Alerts &
// Admin section, Phase 3). Written with React.createElement rather than
// JSX — Vercel's Node function builder only runs the JSX transform on the
// route entrypoint file, not on traced .tsx dependencies, so a .tsx here
// silently drops out of the bundle (confirmed via a local `vercel build`:
// the compiled output was missing this file entirely with no error).
// Plain createElement calls sidestep that build-pipeline gap.
//
// Uses react-pdf's built-in Helvetica fonts — no Font.register()/external
// font-file fetch, since no font files exist anywhere in this repo (the
// app's Geist/Geist Mono are browser-only via a Google Fonts <link>, not
// usable server-side) and a function already doing an LLM call + render +
// Blob upload shouldn't add another external-fetch failure point for a
// cosmetic gain. PDFs are always a static white page regardless of
// dashboard theme, so there's no dark-mode variant.
import { createElement as h } from 'react';
import * as ReactPDF from '@react-pdf/renderer';

const { Document, Page, Text, View, Image, StyleSheet } = ReactPDF;

// Same hue family as src/index.css's --blue (oklch, unusable by react-pdf) —
// the closest literal hex this app already uses for its own brand mark, in
// public/favicon.svg and public/social-image.svg.
const BRAND_BLUE = '#1d4ed8';
const INK = '#171b20';
const INK_SOFT = '#5b6570';

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 84, fontSize: 10, fontFamily: 'Helvetica', color: INK },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  logo: { width: 100, height: 21 },
  headerLabel: { fontSize: 9, color: INK_SOFT, textAlign: 'right' },
  rule: { borderBottomWidth: 2, borderBottomColor: BRAND_BLUE, marginBottom: 14 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  metaTable: { marginBottom: 16, borderWidth: 1, borderColor: '#d9dcd7', borderRadius: 4, padding: 10 },
  metaRow: { flexDirection: 'row', marginBottom: 4 },
  metaLabel: { width: 110, fontFamily: 'Helvetica-Bold', color: INK_SOFT },
  metaValue: { flex: 1 },
  // One block per real paragraph/section (split on blank lines in the
  // source) — NOT one block per line. Each block's own lines (e.g. bullet
  // items with no blank line between them) are joined as literal "\n"
  // inside a single <Text>, so line-height applies once per wrapped line
  // the normal way instead of compounding a margin + full line-height on
  // every individual bullet, which is what made everything look
  // double-spaced.
  bodyBlock: { marginBottom: 9, lineHeight: 1.35 },
  bold: { fontFamily: 'Helvetica-Bold' },
  italic: { fontFamily: 'Helvetica-Oblique' },
  code: { fontFamily: 'Courier', fontSize: 9 },
  table: { marginBottom: 10, borderWidth: 1, borderColor: '#d9dcd7', borderBottomWidth: 0 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#d9dcd7' },
  tableHeaderRow: { backgroundColor: '#f2f4f1' },
  tableCell: { paddingVertical: 3, paddingHorizontal: 5, lineHeight: 1.3 },
  tableCellFirst: { width: 80, borderRightWidth: 1, borderRightColor: '#d9dcd7' },
  tableCellFlex: { flex: 1 },
  heading1: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 6 },
  heading2: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 9, marginBottom: 5 },
  heading3: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
  sectionRule: { borderBottomWidth: 1, borderBottomColor: '#d9dcd7', marginTop: 6, marginBottom: 10 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#d9dcd7',
    paddingTop: 8,
  },
  disclaimer: { fontSize: 8, fontFamily: 'Helvetica-Oblique', color: INK_SOFT, lineHeight: 1.35 },
  poweredBy: { fontSize: 8, color: INK_SOFT, marginTop: 5 },
  poweredByBrand: { color: BRAND_BLUE, fontFamily: 'Helvetica-Bold' },
});

const KIND_LABEL: Record<'technical' | 'executive', string> = {
  technical: 'Technical Brief',
  executive: 'Executive Brief',
};

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const RULE_RE = /^(-{3,}|_{3,}|\*{3,})\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const INLINE_RE = /(\*\*.+?\*\*|`[^`]+`|\*[^*\s](?:[^*]*[^*\s])?\*)/g;
// react-pdf's built-in Helvetica only covers WinAnsi, so emoji the model
// uses as visual markers (🔴/🟠/🟡/🟢 priority dots, ✅, ⚠️) render as
// garbage glyphs. Strip them (plus variation selectors/ZWJ and the space
// that followed) rather than registering an emoji font.
const EMOJI_RE = /(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D})+\s?/gu;
const HEADING_STYLES = { 1: styles.heading1, 2: styles.heading2, 3: styles.heading3 } as const;

type PdfNode = ReturnType<typeof h>;

function renderInline(line: string, key: string): Array<string | PdfNode> {
  const out: Array<string | PdfNode> = [];
  line.split(INLINE_RE).forEach((part, i) => {
    if (part === '') return;
    if (i % 2 === 0) {
      out.push(part);
      return;
    }
    const k = `${key}-${i}`;
    if (part.startsWith('**')) out.push(h(Text, { key: k, style: styles.bold }, part.slice(2, -2)));
    else if (part.startsWith('`')) out.push(h(Text, { key: k, style: styles.code }, part.slice(1, -1)));
    else out.push(h(Text, { key: k, style: styles.italic }, part.slice(1, -1)));
  });
  return out;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderTable(header: string[], rows: string[][], key: string): PdfNode {
  // First column (e.g. "Priority") sized to content; the rest share the width.
  const cellStyle = (c: number) => [styles.tableCell, c === 0 && header.length > 1 ? styles.tableCellFirst : styles.tableCellFlex];
  return h(
    View,
    { key, style: styles.table },
    h(
      View,
      { style: [styles.tableRow, styles.tableHeaderRow] },
      ...header.map((cell, c) => h(Text, { key: c, style: [...cellStyle(c), styles.bold] }, ...renderInline(cell, `${key}-h${c}`)))
    ),
    ...rows.map((row, r) =>
      h(
        View,
        { key: r, style: styles.tableRow, wrap: false },
        ...header.map((_, c) => h(Text, { key: c, style: cellStyle(c) }, ...renderInline(row[c] ?? '', `${key}-${r}-${c}`)))
      )
    )
  );
}

// Adapts src/utils/formatBriefText.tsx's markdown-subset parsing (**bold**,
// *italic*, `code`, #/##/### headings, --- rules, pipe tables) for
// react-pdf. Blank-line-separated blocks that are a single heading or rule
// line render as their own standalone element (matching how the model
// reliably surrounds them with blank lines); any stray heading/rule text
// mixed into a multi-line paragraph block is dropped rather than leaking
// through as literal "### "/"---". A table (header row + |---| separator)
// inside a block splits it: text before and after become their own
// paragraphs around the table.
function renderBriefBody(text: string) {
  const blocks = text
    .replace(EMOJI_RE, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const nodes: PdfNode[] = [];

  blocks.forEach((block, blockIndex) => {
    const lines = block.split('\n');

    if (lines.length === 1) {
      const headingMatch = lines[0].match(HEADING_RE);
      if (headingMatch) {
        const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
        nodes.push(h(Text, { key: blockIndex, style: HEADING_STYLES[level] }, ...renderInline(headingMatch[2], `${blockIndex}`)));
        return;
      }
      if (RULE_RE.test(lines[0].trim())) {
        nodes.push(h(View, { key: blockIndex, style: styles.sectionRule }));
        return;
      }
    }

    let children: Array<string | PdfNode> = [];
    let linesEmitted = 0;
    let part = 0;
    const flush = () => {
      if (children.length > 0) nodes.push(h(Text, { key: `${blockIndex}-${part++}`, style: styles.bodyBlock }, ...children));
      children = [];
      linesEmitted = 0;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (TABLE_ROW_RE.test(line) && TABLE_SEPARATOR_RE.test(lines[i + 1] ?? '')) {
        flush();
        const header = splitTableRow(line);
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && TABLE_ROW_RE.test(lines[j])) rows.push(splitTableRow(lines[j++]));
        nodes.push(renderTable(header, rows, `${blockIndex}-${part++}`));
        i = j - 1;
        continue;
      }
      if (HEADING_RE.test(line) || RULE_RE.test(line.trim())) continue;
      if (linesEmitted > 0) children.push('\n');
      children.push(...renderInline(line, `${blockIndex}-${i}`));
      linesEmitted++;
    }
    flush();
  });

  return nodes;
}

export interface BriefDocumentProps {
  kind: 'technical' | 'executive';
  provider: string;
  incidentTitle: string;
  affectedRegions: string[];
  severity: string;
  triggerEvent: string;
  createdAt: string;
  briefText: string;
  logoBuffer: Buffer;
  disclaimerText: string;
  siteUrl: string;
}

function metaRow(label: string, value: string) {
  return h(View, { style: styles.metaRow }, h(Text, { style: styles.metaLabel }, label), h(Text, { style: styles.metaValue }, value));
}

export function BriefDocument({
  kind,
  provider,
  incidentTitle,
  affectedRegions,
  severity,
  triggerEvent,
  createdAt,
  briefText,
  logoBuffer,
  disclaimerText,
  siteUrl,
}: BriefDocumentProps) {
  const siteHost = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return h(
    Document,
    null,
    h(
      Page,
      { size: 'A4', style: styles.page },
      h(
        View,
        { style: styles.header },
        h(Image, { src: logoBuffer, style: styles.logo }),
        h(Text, { style: styles.headerLabel }, `Incident Briefing Engine\n${KIND_LABEL[kind]}`)
      ),
      h(View, { style: styles.rule }),
      h(Text, { style: styles.title }, incidentTitle),
      h(
        View,
        { style: styles.metaTable },
        metaRow('Provider', provider.toUpperCase()),
        metaRow('Affected region(s)', affectedRegions.join(', ') || '—'),
        metaRow('Severity', severity),
        metaRow('Trigger', triggerEvent),
        metaRow('Generated', createdAt)
      ),
      ...renderBriefBody(briefText),
      h(
        View,
        { style: styles.footer, fixed: true },
        h(Text, { style: styles.disclaimer }, disclaimerText),
        h(
          Text,
          { style: styles.poweredBy },
          'Powered by ',
          h(Text, { style: styles.poweredByBrand }, 'Synepho'),
          ' — for live status and updates, visit ',
          h(Text, { style: styles.poweredByBrand }, siteHost)
        )
      )
    )
  );
}
