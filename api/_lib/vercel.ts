// Request/response types for Vercel's Node.js runtime, copied from
// @vercel/node@10's dist/index.d.ts. The package was only ever used for these
// type aliases (`import type`), and it pulled in ts-morph, an old minimatch
// and other vulnerable dev dependencies. Vercel adds the query/cookies/body
// fields and the send/json/status/redirect helpers at runtime whether or not
// the package is installed.
import type { IncomingMessage, ServerResponse } from 'node:http';

export type VercelRequestCookies = { [key: string]: string };
export type VercelRequestQuery = { [key: string]: string | string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Vercel's own type
export type VercelRequestBody = any;

export type VercelRequest = IncomingMessage & {
  query: VercelRequestQuery;
  cookies: VercelRequestCookies;
  body: VercelRequestBody;
};

export type VercelResponse = ServerResponse & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Vercel's own type
  send: (body: any) => VercelResponse;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Vercel's own type
  json: (jsonBody: any) => VercelResponse;
  status: (statusCode: number) => VercelResponse;
  redirect: (statusOrUrl: string | number, url?: string) => VercelResponse;
};
