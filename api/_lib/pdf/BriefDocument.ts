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
  page: { padding: 40, paddingBottom: 70, fontSize: 10, fontFamily: 'Helvetica', color: INK },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  logo: { width: 100, height: 21 },
  headerLabel: { fontSize: 9, color: INK_SOFT, textAlign: 'right' },
  rule: { borderBottomWidth: 2, borderBottomColor: BRAND_BLUE, marginBottom: 14 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  metaTable: { marginBottom: 16, borderWidth: 1, borderColor: '#d9dcd7', borderRadius: 4, padding: 10 },
  metaRow: { flexDirection: 'row', marginBottom: 4 },
  metaLabel: { width: 110, fontFamily: 'Helvetica-Bold', color: INK_SOFT },
  metaValue: { flex: 1 },
  bodyLine: { marginBottom: 6, lineHeight: 1.5 },
  bold: { fontFamily: 'Helvetica-Bold' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#d9dcd7',
    paddingTop: 8,
    fontSize: 8,
    color: INK_SOFT,
  },
});

const KIND_LABEL: Record<'technical' | 'executive', string> = {
  technical: 'Technical Brief',
  executive: 'Executive Brief',
};

// Adapts src/utils/formatBriefText.tsx's **bold**-span parsing for react-pdf,
// which has no white-space: pre-wrap equivalent — paragraphs/lines must be
// split into their own block-level <Text> elements first.
function renderBriefBody(text: string) {
  return text
    .split('\n')
    .map((line, i) => {
      if (line.trim().length === 0) return null;
      const segments = line.split(/\*\*(.+?)\*\*/g);
      return h(
        Text,
        { key: i, style: styles.bodyLine },
        ...segments.map((segment, j) => (j % 2 === 1 ? h(Text, { key: j, style: styles.bold }, segment) : segment))
      );
    })
    .filter(Boolean);
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
}: BriefDocumentProps) {
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
      h(Text, { style: styles.footer, fixed: true }, disclaimerText)
    )
  );
}
