import type { Incident } from '../types/status';
import {
  URGENCY_LABEL,
  STANCE_LABEL,
  STANCE_URGENCY,
  LIKELIHOOD_LABEL,
  LIKELIHOOD_URGENCY,
  type BriefUrgency,
  type TechnicalBriefData,
  type ExecutiveBriefData,
} from '../utils/structuredBrief';
import { formatInline } from '../utils/formatBriefText';
import { formatRelative } from '../utils/formatters';

// Layout for structured AI briefs (src/utils/structuredBrief.ts). The PDF
// export (api/_lib/pdf/BriefDocument.ts) mirrors the same section order and
// urgency colors. Briefs generated before the structured format still render
// through formatBriefText() in IncidentBriefPanel.

function Pill({ urgency, label }: { urgency: BriefUrgency; label: string }) {
  return <span className={`sb-pill u-${urgency}`}>{label}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sb-sec">
      <h3 className="sb-h">{title}</h3>
      {children}
    </section>
  );
}

export function BriefMeta({ incident, generatedAt }: { incident?: Incident; generatedAt: string }) {
  return (
    <div className="sb-meta">
      {incident && <span className={`sb-sev ${incident.severity}`}>{incident.severity} severity</span>}
      {incident && incident.status !== 'unknown' && <span className="sb-status">{incident.status}</span>}
      <span>Generated {formatRelative(generatedAt)}</span>
    </div>
  );
}

export function TechnicalBriefView({ brief }: { brief: TechnicalBriefData }) {
  return (
    <div className="sb">
      <div className="sb-col">
        <Section title="What we know">
          <p className="sb-lead">{formatInline(brief.whatWeKnow, 'wwk')}</p>
        </Section>

        <Section title="Next actions">
          <ol className="sb-list">
            {brief.nextActions.map((a, i) => (
              <li key={i} className={`sb-item u-${a.urgency}`}>
                <Pill urgency={a.urgency} label={URGENCY_LABEL[a.urgency]} />
                <p>{formatInline(a.action, `a${i}`)}</p>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <div className="sb-col">
        {brief.servicesToCheck.length > 0 && (
          <Section title="Services to check">
            <div className="sb-cats">
              {brief.servicesToCheck.map((s, i) => (
                <div key={i} className="sb-cat">
                  <h4>{s.name}</h4>
                  <p>{formatInline(s.detail, `s${i}`)}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {brief.resiliencyQuestions.length > 0 && (
          <Section title="Resiliency questions">
            <div className="sb-list">
              {brief.resiliencyQuestions.map((g, i) => (
                <div key={i} className="sb-q">
                  <div className="sb-q-head">
                    <Pill urgency={g.urgency} label={URGENCY_LABEL[g.urgency]} />
                    <h4>{g.category}</h4>
                  </div>
                  <ul>
                    {g.questions.map((q, j) => (
                      <li key={j}>{formatInline(q, `q${i}-${j}`)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

export function ExecutiveBriefView({ brief }: { brief: ExecutiveBriefData }) {
  const stanceUrgency = STANCE_URGENCY[brief.bottomLine.stance];
  const impactUrgency = LIKELIHOOD_URGENCY[brief.customerImpact.likelihood];
  return (
    <div className="sb">
      <div className="sb-col">
        <div className={`sb-bottom u-${stanceUrgency}`}>
          <div className="sb-bottom-head">
            <span className="label">Bottom line</span>
            <Pill urgency={stanceUrgency} label={STANCE_LABEL[brief.bottomLine.stance]} />
          </div>
          <p>{formatInline(brief.bottomLine.text, 'bl')}</p>
        </div>

        <Section title="What's happening">
          <p className="sb-lead">{formatInline(brief.whatsHappening, 'wh')}</p>
        </Section>

        <Section title="How serious is it">
          <p className="sb-lead muted">{formatInline(brief.seriousness, 'ser')}</p>
        </Section>
      </div>

      <div className="sb-col">
        <Section title="Customer-facing impact">
          <div className="sb-row">
            <Pill urgency={impactUrgency} label={LIKELIHOOD_LABEL[brief.customerImpact.likelihood]} />
          </div>
          <p className="sb-lead muted">{formatInline(brief.customerImpact.detail, 'ci')}</p>
        </Section>

        {brief.decisions.length > 0 && (
          <Section title="Decisions to consider">
            <div className="sb-list">
              {brief.decisions.map((d, i) => (
                <div key={i} className={`sb-item u-${d.urgency}`}>
                  <Pill urgency={d.urgency} label={URGENCY_LABEL[d.urgency]} />
                  <div>
                    <h4>{d.scenario}</h4>
                    <p className="sub">{formatInline(d.recommendation, `d${i}`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
