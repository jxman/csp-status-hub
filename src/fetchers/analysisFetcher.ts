import type { Provider } from '../types/status';

export interface BriefVersion {
  id: string;
  triggerEvent: 'new' | 'content_changed' | 'resolved';
  technicalBrief: string;
  executiveBrief: string;
  pdfTechnicalUrl: string | null;
  pdfExecutiveUrl: string | null;
  model: string;
  createdAt: string;
}

interface HistoryResponse {
  provider: Provider;
  incidentId: string;
  versions: BriefVersion[];
}

export async function fetchIncidentBriefHistory(provider: Provider, incidentId: string): Promise<BriefVersion[]> {
  const url = `/api/analysis/history?provider=${provider}&incidentId=${encodeURIComponent(incidentId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Brief history request returned ${response.status} ${response.statusText}`);
  }

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
    throw new Error('Brief history endpoint returned an unexpected HTML response.');
  }

  const data: HistoryResponse = JSON.parse(text);
  return data.versions;
}
