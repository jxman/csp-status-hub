import type { Provider } from '../types/status';
import type { StructuredBriefs } from '../utils/structuredBrief';

export interface LatestBrief {
  id: string;
  triggerEvent: 'new' | 'content_changed' | 'resolved';
  technicalBrief: string;
  executiveBrief: string;
  // Present on briefs generated after the structured-brief change; older
  // rows only have the markdown text above.
  structured?: StructuredBriefs | null;
  pdfTechnicalUrl: string | null;
  pdfExecutiveUrl: string | null;
  model: string;
  createdAt: string;
}

export interface BriefPointer {
  id: string;
  createdAt: string;
}

interface LatestPointerResponse {
  provider: Provider;
  incidentId: string;
  pointer: BriefPointer | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  // Vite dev server returns index.html (200 OK) for unknown /api/* routes.
  // Detect this before calling JSON.parse to avoid a cryptic parse error.
  const text = await response.text();
  if (text.trimStart().startsWith('<')) {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocal) {
      throw new Error(
        'AI Insight requires a Vercel serverless function. Run `vercel dev` instead of `npm run dev` to enable it locally.'
      );
    }
    throw new Error('Analysis endpoint returned an unexpected HTML response.');
  }

  if (!response.ok) {
    throw new Error(`Request to ${url} returned ${response.status} ${response.statusText}`);
  }

  return JSON.parse(text) as T;
}

// Step 1 of 2 — the mutable, cheap-to-query pointer for an incident's most
// recent complete analysis row. Cached at the edge for minutes (see
// api/analysis/latest.ts), since it can only advance at most once per
// analysis-debounce interval.
export async function fetchBriefPointer(provider: Provider, incidentId: string): Promise<BriefPointer | null> {
  const url = `/api/analysis/latest?provider=${provider}&incidentId=${encodeURIComponent(incidentId)}`;
  const data = await fetchJson<LatestPointerResponse>(url);
  return data.pointer;
}

// Step 2 of 2 — the immutable brief content for one specific analysis row
// id. Cached at the edge (and in-browser) for a year once finalized (see
// the ?id= branch in api/analysis/latest.ts), since a given id's content
// never changes.
export async function fetchBriefContent(id: string): Promise<LatestBrief> {
  const url = `/api/analysis/latest?id=${encodeURIComponent(id)}`;
  return fetchJson<LatestBrief>(url);
}
