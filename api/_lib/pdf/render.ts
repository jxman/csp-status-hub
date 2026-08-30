// PDF generation + Blob upload for the Incident Briefing Engine, Phase 3
// (see README.md's Alerts & Admin section). Best-effort: called from
// api/analysis/run.ts AFTER the text brief has already been written —
// a failure here must never affect the already-successful brief.
import * as ReactPDF from '@react-pdf/renderer';
import { put } from '@vercel/blob';
import { DISCLAIMER_TEXT } from '../analysisPrompt.js';
import { BriefDocument } from './BriefDocument.js';
import { slugifyForBlobPath } from './slug.js';
import type { Incident, Provider } from '../../../src/types/status.js';

const { renderToBuffer } = ReactPDF;

interface RenderInput {
  provider: Provider;
  incidentId: string;
  rowId: string;
  incident: Incident;
  triggerEvent: string;
  createdAt: string;
  technicalBrief: string;
  executiveBrief: string;
}

interface RenderResult {
  technicalUrl: string | null;
  executiveUrl: string | null;
}

async function fetchLogoBuffer(): Promise<Buffer> {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new Error('APP_BASE_URL is not set');
  const response = await fetch(`${base}/logos/synepho-light.png`);
  if (!response.ok) throw new Error(`Logo fetch returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderAndUploadOne(
  kind: 'technical' | 'executive',
  input: RenderInput,
  logoBuffer: Buffer
): Promise<string | null> {
  try {
    // The executive prompt (api/_lib/analysisPrompt.ts) already appends
    // DISCLAIMER_TEXT as the brief's own final line — strip a trailing copy
    // here so it doesn't also repeat immediately below in the PDF's own
    // recurring footer, which shows the disclaimer on every page regardless.
    const rawBriefText = kind === 'technical' ? input.technicalBrief : input.executiveBrief;
    const briefText = rawBriefText.trim().endsWith(DISCLAIMER_TEXT)
      ? rawBriefText.trim().slice(0, -DISCLAIMER_TEXT.length).trim()
      : rawBriefText;
    const buffer = await renderToBuffer(
      BriefDocument({
        kind,
        provider: input.provider,
        incidentTitle: input.incident.title,
        affectedRegions: input.incident.affectedRegions,
        severity: input.incident.severity,
        triggerEvent: input.triggerEvent,
        createdAt: input.createdAt,
        briefText,
        logoBuffer,
        disclaimerText: DISCLAIMER_TEXT,
        siteUrl: process.env.APP_BASE_URL || 'https://cloudstatus.synepho.com',
      })
    );

    const pathname = `incident-analysis/${input.provider}/${slugifyForBlobPath(input.incidentId)}/${input.rowId}-${kind}.pdf`;
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
    });
    return blob.url;
  } catch (err) {
    console.error(`[analysis/pdf] ${kind} PDF failed for ${input.provider}/${input.incidentId} (row ${input.rowId})`, err);
    return null;
  }
}

export async function renderAndUploadBriefPdfs(input: RenderInput): Promise<RenderResult> {
  const logoBuffer = await fetchLogoBuffer();
  const [technicalUrl, executiveUrl] = await Promise.all([
    renderAndUploadOne('technical', input, logoBuffer),
    renderAndUploadOne('executive', input, logoBuffer),
  ]);
  return { technicalUrl, executiveUrl };
}
