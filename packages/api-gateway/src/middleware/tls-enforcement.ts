/**
 * API Gateway TLS Enforcement Middleware
 * Requires transport-layer encryption for every connection and refuses
 * connections that are not encrypted, rejecting any data transmission.
 * Validates: Requirements 18.2, 18.3
 */

import type { Request, Response, NextFunction } from 'express';

export interface TlsEnforcementConfig {
  /**
   * Whether TLS enforcement is active.
   * Defaults to `true` in production (NODE_ENV === 'production') and `false`
   * otherwise so local development over plain HTTP is not blocked.
   */
  enabled?: boolean;
  /**
   * Whether to trust the `X-Forwarded-Proto` header when the gateway runs
   * behind a TLS-terminating proxy / load balancer. Defaults to `true`.
   */
  trustProxyHeader?: boolean;
  /**
   * Value of the HSTS `max-age` directive in seconds. Defaults to one year.
   */
  hstsMaxAgeSeconds?: number;
}

/**
 * Determines whether the incoming request arrived over an encrypted
 * transport. A connection is considered secure when either the socket is
 * a TLS socket (`req.secure`) or, when running behind a trusted proxy, the
 * `X-Forwarded-Proto` header advertises `https`.
 */
export function isConnectionSecure(req: Request, trustProxyHeader: boolean): boolean {
  if (req.secure) {
    return true;
  }

  if (trustProxyHeader) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    if (proto) {
      // The header may contain a comma-separated list; the left-most value
      // is the protocol used by the original client.
      const firstProto = proto.split(',')[0]?.trim().toLowerCase();
      if (firstProto === 'https') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Creates middleware that requires transport-layer encryption.
 * If encryption cannot be established, the request is refused with 403 and
 * no downstream handler (and therefore no data transmission) runs.
 */
export function createTlsEnforcement(config: TlsEnforcementConfig = {}) {
  const enabled = config.enabled ?? process.env.NODE_ENV === 'production';
  const trustProxyHeader = config.trustProxyHeader ?? true;
  const hstsMaxAgeSeconds = config.hstsMaxAgeSeconds ?? 31536000;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled) {
      next();
      return;
    }

    if (!isConnectionSecure(req, trustProxyHeader)) {
      // Refuse the connection and reject any data transmission (Req 18.3).
      res.status(403).json({
        error: {
          code: 'TLS_REQUIRED',
          message:
            'Transport-layer encryption is required. Connect over HTTPS to access this API.',
        },
      });
      return;
    }

    // Instruct clients to always use HTTPS for subsequent requests.
    res.setHeader(
      'Strict-Transport-Security',
      `max-age=${hstsMaxAgeSeconds}; includeSubDomains`
    );

    next();
  };
}
