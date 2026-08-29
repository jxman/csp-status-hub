// Real incident_id values look like a full URL fragment
// (https://status.aws.amazon.com/#multipleservices-me-central-1), which is
// illegal/awkward as a Blob object path component. This produces a short,
// filesystem/URL-safe slug for use inside the Blob pathname.
export function slugifyForBlobPath(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
