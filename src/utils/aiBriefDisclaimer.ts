// Shared verbatim by the Incident Briefing Engine's Bedrock prompt
// (api/_lib/analysisPrompt.ts), its PDF export (api/_lib/pdf/render.ts), and
// the web UI (IncidentBriefPanel.tsx) so all three surfaces show
// byte-identical disclaimer text.
export const AI_BRIEF_DISCLAIMER_TEXT =
  "This brief is AI-generated guidance based on the provider's public status update only — it has no visibility into your account, architecture, or configuration, and your environment may differ and require other steps. Do not assume automatic failover is configured; evaluate and execute any failover action based on your own architecture.";
