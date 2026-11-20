import type { NextFunction, Request, Response } from 'express';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) {
    return null;
  }
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

/**
 * The API only listens on loopback, but any website the user visits can still
 * send requests to it. Two checks keep it private:
 *
 * - Host must be a loopback name. Blocks DNS-rebinding, where an attacker's
 *   domain resolves to 127.0.0.1 so their page counts as same-origin.
 * - Requests carrying an Origin must come from a local origin, and POSTs must
 *   be JSON. Cross-site pages cannot send application/json without a CORS
 *   preflight, which this server never approves.
 */
export function localOnly(request: Request, response: Response, next: NextFunction): void {
  const host = hostnameOf(request.headers.host);
  if (!host || !LOCAL_HOSTNAMES.has(host)) {
    response.status(403).json({ error: 'Forbidden host' });
    return;
  }

  const origin = request.headers.origin;
  if (origin) {
    let originHost: string | null;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      originHost = null;
    }
    if (!originHost || !LOCAL_HOSTNAMES.has(originHost)) {
      response.status(403).json({ error: 'Forbidden origin' });
      return;
    }
  }

  // POST is the only state-changing method a cross-site page can send without
  // a preflight (as a form or text/plain). PUT/DELETE always need a preflight.
  if (request.method === 'POST' && !request.is('application/json')) {
    response.status(415).json({ error: 'Requests must be JSON' });
    return;
  }

  next();
}
