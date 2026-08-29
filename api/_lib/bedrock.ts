// AWS Bedrock client for the Incident Briefing Engine (see README.md's
// Alerts & Admin section). Credentials come from Vercel's native OIDC ->
// AWS federation (a short-lived Vercel-issued OIDC token exchanged for
// temporary AWS credentials via sts:AssumeRoleWithWebIdentity) rather than
// long-lived AWS keys, matching this account's existing OIDC-over-static-keys
// standard. See scripts/setup-bedrock-oidc.sh for the IAM role this depends on.
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

// AWS_REGION is set explicitly as a Vercel project env var rather than
// relying on any auto-injected value — Vercel can auto-set AWS_REGION to the
// function's execution region, which can drift under multi-region routing.
export const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION!,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN! }),
});

// Claude Sonnet 5 only supports INFERENCE_PROFILE invocation on Bedrock, not
// a bare on-demand model ID — confirmed via GetFoundationModelAvailability
// against this AWS account (inferenceTypesSupported: ["INFERENCE_PROFILE"]).
export const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-5';
