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
        <SynephoLogo height={12} />
        <span>AI Insight</span>
        <ChevronIcon open={expanded} />
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
