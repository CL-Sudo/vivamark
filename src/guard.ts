// Request checks shared by every route. The server listens on loopback only;
// these checks stop a web page in the reviewer's browser, or another local
// process, from using it without the session's token.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** The only addresses the server ever binds. There is deliberately no way to add to this list. */
export const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

/** Hostnames a browser uses for this machine's loopback, as they appear in Host and Origin. */
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * True when `authority` (a Host header, or an Origin without its scheme) names
 * loopback with an explicit port. Any port is accepted: a port forwarder (VS
 * Code's WSL forwarding, `ssh -L`) may reach us on a different one, and the
 * DNS-rebinding defence turns on the hostname alone.
 */
export function loopbackAuthority(authority: string): boolean {
  const m = /^(.+):([0-9]{1,5})$/.exec(authority.toLowerCase());
  if (!m) return false;
  const port = Number(m[2]);
  return port >= 1 && port <= 65535 && LOOPBACK_NAMES.has(m[1]);
}

/** DNS-rebinding defence: the Host header must name loopback. */
export function hostAllowed(req: IncomingMessage): boolean {
  const host = req.headers.host;
  return typeof host === 'string' && loopbackAuthority(host);
}

/**
 * Cross-site defence. A request that carries an Origin must come from a
 * loopback origin. When `required`, a missing Origin is refused too, which
 * limits the route to the review UI in a browser. Every API route also needs
 * the session's token, which only the review page holds (in its URL fragment
 * and its own origin's sessionStorage), so a page on another loopback port
 * passes this check but still cannot act.
 */
export function originAllowed(req: IncomingMessage, required: boolean): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return !required;
  return origin.startsWith('http://') && loopbackAuthority(origin.slice('http://'.length));
}

export function tokensEqual(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer\s+([A-Za-z0-9]+)$/.exec(h.trim());
  return m ? m[1] : undefined;
}

/** The token a browser sends as a WebSocket subprotocol: `vivamark.token.<hex>`. */
export function wsToken(req: IncomingMessage): string | undefined {
  const h = req.headers['sec-websocket-protocol'];
  if (typeof h !== 'string') return undefined;
  for (const p of h.split(',').map((s) => s.trim())) {
    if (p.startsWith('vivamark.token.')) return p.slice('vivamark.token.'.length);
  }
  return undefined;
}

/**
 * Proof that a server holds the admin token, given a fresh challenge. The CLI
 * checks it before sending the token, so a process squatting on the port
 * after a restart learns nothing.
 */
export function tokenProof(token: string, challenge: string): string {
  return createHmac('sha256', token).update(`vivamark-proof:${challenge}`).digest('hex');
}
