import { useEffect, useState } from 'react';
import type { Provider } from '../types/status';
import { useIncidentBrief } from '../hooks/useIncidentBrief';
import { formatBriefText } from '../utils/formatBriefText';
import { formatRelative } from '../utils/formatters';
import { SynephoLogo } from './SynephoLogo';

interface Props {
  provider: Provider;
  incidentId: string;
  autoExpand?: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  new: 'New',
  content_changed: 'Updated',
  resolved: 'Resolved',
};

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    style={{ color: 'var(--ink-4)', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
  >
    <path d="M19 9l-7 7-7-7" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="sparkle">
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96l6.14-1.58A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0Z" />
  </svg>
);

export function IncidentBriefPanel({ provider, incidentId, autoExpand }: Props) {
  const [expanded, setExpanded] = useState(autoExpand ?? false);
  const [activeTab, setActiveTab] = useState<'technical' | 'executive'>('technical');
  const [versionIndex, setVersionIndex] = useState(0);
  const { state, versions, error, load, retry } = useIncidentBrief(provider, incidentId);

  const toggle = () => {
    setExpanded((e) => !e);
    load();
  };

  useEffect(() => {
    if (autoExpand) {
      setExpanded(true);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand]);

  const version = versions[versionIndex];

  return (
    <div className="ai-insight">
      <div
        className="ai-insight-head"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && toggle()}
      >
        <SparkleIcon />
        <span>AI Insight</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="ai-insight-powered">
            Powered by <SynephoLogo height={12} />
          </span>
          <ChevronIcon open={expanded} />
        </span>
      </div>

      {expanded && (
        <div className="ai-insight-body">
          {state === 'loading' && <div className="brief-loading">Generating…</div>}

          {state === 'error' && (
            <div className="brief-error">
              Couldn&apos;t load AI analysis ({error}).{' '}
              <button className="btn-ghost" onClick={retry}>Retry</button>
            </div>
          )}

          {state === 'loaded' && versions.length === 0 && (
            <div className="brief-empty">No AI analysis yet for this incident.</div>
          )}

          {state === 'loaded' && version && (
            <>
              <div className="brief-tabs">
                <button
                  className={`brief-tab${activeTab === 'technical' ? ' active' : ''}`}
                  onClick={() => setActiveTab('technical')}
                >
                  Technical
                </button>
                <button
                  className={`brief-tab${activeTab === 'executive' ? ' active' : ''}`}
                  onClick={() => setActiveTab('executive')}
                >
                  Executive
                </button>
              </div>

              <div className="brief-text">
                {formatBriefText(activeTab === 'technical' ? version.technicalBrief : version.executiveBrief)}
              </div>

              {(activeTab === 'technical' ? version.pdfTechnicalUrl : version.pdfExecutiveUrl) && (
                <a
                  className="brief-pdf-link"
                  href={(activeTab === 'technical' ? version.pdfTechnicalUrl : version.pdfExecutiveUrl) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <DownloadIcon />
                  Download PDF
                </a>
              )}

              {versions.length > 1 && (
                <div className="brief-version-stepper">
                  <button
                    className="btn-ghost"
                    disabled={versionIndex >= versions.length - 1}
                    onClick={() => setVersionIndex((i) => i + 1)}
                  >
                    ‹
                  </button>
                  <span>
                    Update {versionIndex + 1} of {versions.length} · {TRIGGER_LABELS[version.triggerEvent] ?? version.triggerEvent} · {formatRelative(version.createdAt)}
                  </span>
                  <button
                    className="btn-ghost"
                    disabled={versionIndex <= 0}
                    onClick={() => setVersionIndex((i) => i - 1)}
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
