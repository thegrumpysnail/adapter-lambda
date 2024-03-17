/* eslint-disable import/no-unresolved */
/* eslint-disable import/no-extraneous-dependencies */

import 'SHIMS';
import fs from 'node:fs';
import path from 'node:path';
import sirv from 'sirv';
import { Readable } from 'stream';
import { fileURLToPath } from 'node:url';
import { parse as parseUrl } from '@polka/url';
import { getRequest } from '@sveltejs/kit/node';
import { Server } from 'SERVER';
import { manifest, prerendered } from 'MANIFEST';
import { env } from 'ENV';

/* global ENV_PREFIX */

const server = new Server(manifest);
await server.init({ env: process.env });
const origin = env('ORIGIN', undefined);
const xffDepth = parseInt(env('XFF_DEPTH', '1'), 10);
const addressHeader = env('ADDRESS_HEADER', '').toLowerCase();
const protocolHeader = env('PROTOCOL_HEADER', '').toLowerCase();
const hostHeader = env('HOST_HEADER', 'host').toLowerCase();
const bodySizeLimit = parseInt(env('BODY_SIZE_LIMIT', '524288'), 10);

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} path
 * @param {boolean} isClient
 */
const serve = (path, isClient = false) => {
  if (!fs.existsSync(path)) {
    return null;
  }

  return sirv(path, {
    etag: true,
    gzip: true,
    brotli: true,
    setHeaders: isClient && ((res, pathname) => {
      // only apply to build directory, not e.g. version.json
      if (pathname.startsWith(`/${manifest.appPath}/immutable/`) && res.statusCode === 200) {
        res.setHeader('cache-control', 'public,max-age=31536000,immutable');
      }
    }),
  });
};

// required because the static file server ignores trailing slashes
/** @returns {import('express').RequestHandler} */
const servePrerendered = () => {
  const handler = serve(path.join(dir, 'prerendered'));

  return (req, res, next) => {
    const parsedUrl = parseUrl(req);
    const { search, query } = parsedUrl;
    let { pathname } = parsedUrl;

    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // ignore invalid URI
    }

    if (prerendered.has(pathname)) {
      return handler(req, res, next);
    }

    // remove or add trailing slash as appropriate
    let location = pathname.at(-1) === '/'
      ? pathname.slice(0, -1)
      : `${pathname}/`;

    if (prerendered.has(location)) {
      if (query) {
        location += search;
      }

      res.writeHead(308, { location }).end();
    } else {
      next();
    }

    return null;
  };
};

/**
 * @param {import('express').Response} res
 * @param {{ headers: any, status: number, body: any }} response
 */
const setResponse = async (res, response) => {
  const headers = Object.fromEntries(response.headers);

  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();

    return;
  }

  const stream = Readable.from(response.body);

  stream.pipe(res);
};

/**
 * @param {import('http').IncomingHttpHeaders} headers
 * @returns {string}
 */
const getOrigin = (headers) => {
  const protocol = (protocolHeader && headers[protocolHeader]) || 'https';
  const host = headers[hostHeader];

  return `${protocol}://${host}`;
};

/** @type {import('express').RequestHandler} */
const ssr = async (req, res) => {
  const request = await getRequest({
    base: origin || getOrigin(req.headers),
    request: req,
    bodySizeLimit,
  });

  setResponse(
    res,
    await server.respond(request, {
      platform: { req },
      getClientAddress: () => {
        if (addressHeader) {
          if (!(addressHeader in req.headers)) {
            throw new Error(
              `Address header was specified with ${
                `${ENV_PREFIX}ADDRESS_HEADER`
              }=${addressHeader} but is absent from request`,
            );
          }

          const value = /** @type {string} */ (req.headers[addressHeader]) || '';

          if (addressHeader === 'x-forwarded-for') {
            const addresses = value.split(',');

            if (xffDepth < 1) {
              throw new Error(`${`${ENV_PREFIX}XFF_DEPTH`} must be a positive integer`);
            }

            if (xffDepth > addresses.length) {
              throw new Error(
                `${`${ENV_PREFIX}XFF_DEPTH`} is ${xffDepth}, but only found ${
                  addresses.length
                } addresses`,
              );
            }
            return addresses[addresses.length - xffDepth].trim();
          }

          return value;
        }

        return (
          req.connection?.remoteAddress
          // @ts-expect-error
          || req.connection?.socket?.remoteAddress
          || req.socket?.remoteAddress
          // @ts-expect-error
          || req.info?.remoteAddress
        );
      },
    }),
  );
};

/** @param {import('express').RequestHandler[]} handlers */
const sequence = (handlers) => (
  /** @type {import('express').RequestHandler} */
  (req, res, next) => {
    /**
     * @param {number} i
     * @returns {ReturnType<import('express').RequestHandler>}
     */
    const handle = (i) => {
      if (i < handlers.length) {
        return handlers[i](req, res, () => handle(i + 1));
      }

      return next();
    };

    return handle(0);
  }
);

export const handler = sequence(
  [
    serve(path.join(dir, 'client'), true),
    serve(path.join(dir, 'static')),
    servePrerendered(),
    ssr,
  ].filter(Boolean),
);

export default handler;
