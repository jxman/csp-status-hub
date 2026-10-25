// Side-effect-free credential checks for scripts/rotate-secrets.sh: proves a
// freshly rotated credential works without writing data or sending email.
//
// Usage: node --env-file=.env.local scripts/rotate-secrets-check.mjs <neon|upstash|blob|resend>
import { neon } from '@neondatabase/serverless';
import { Redis } from '@upstash/redis';
import { list } from '@vercel/blob';

const checks = {
  neon: async () => {
    const sql = neon(process.env.DATABASE_URL);
    await sql`select 1`;
    return 'DATABASE_URL connects (select 1)';
  },
  upstash: async () => {
    const pong = await Redis.fromEnv().ping();
    if (pong !== 'PONG') throw new Error(`unexpected PING reply: ${pong}`);
    return 'KV_REST_API_URL/TOKEN answer PING';
  },
  blob: async () => {
    await list({ limit: 1 });
    return 'BLOB_READ_WRITE_TOKEN can list the store';
  },
  resend: async () => {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (res.ok) return 'RESEND_API_KEY authenticates (GET /domains)';
    const body = await res.json().catch(() => ({}));
    // A sending-only key authenticates but can't list domains
    if (body.name === 'restricted_api_key') return 'RESEND_API_KEY authenticates (sending-only key)';
    throw new Error(`Resend returned ${res.status}: ${body.message ?? res.statusText}`);
  },
};

const service = process.argv[2];
if (!checks[service]) {
  console.error(`usage: rotate-secrets-check.mjs <${Object.keys(checks).join('|')}>`);
  process.exit(2);
}

try {
  console.log(`  ok: ${await checks[service]()}`);
} catch (err) {
  console.error(`  FAILED (${service}): ${err.message}`);
  process.exit(1);
}
