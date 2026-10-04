// Loaded with `node --import` into every vivamark process a test starts (the
// CLI, and through the inherited environment the daemon). Any attempt to
// open a connection to a non-loopback address, look up a host name in DNS,
// or send a UDP datagram is recorded in $VIVAMARK_EGRESS_LOG and refused
// before a packet leaves the machine. The egress tests fail on any record.

import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';

const LOG = process.env.VIVAMARK_EGRESS_LOG;

function isLoopback(host) {
  if (host === undefined || host === null || host === '') return true; // Node's default is localhost.
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^::ffff:127\.\d+\.\d+\.\d+$/.test(h)) return true;
  return false;
}

function record(kind, target) {
  const line = JSON.stringify({ pid: process.pid, argv: process.argv.slice(1), kind, target: String(target) });
  if (LOG) fs.appendFileSync(LOG, line + '\n');
  return new Error(`egress blocked by test guard: ${kind} ${target}`);
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  let first = args[0];
  // Node's internals pass already-normalised arguments as an array.
  if (Array.isArray(first)) first = first[0];
  let host;
  let isPath = false;
  if (first && typeof first === 'object') {
    if (first.path) isPath = true;
    host = first.host;
  } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
    isPath = true; // A Unix socket or named pipe path.
  } else {
    host = typeof args[1] === 'string' ? args[1] : undefined;
  }
  if (!isPath && !isLoopback(host)) throw record('tcp', host);
  return connect.apply(this, args);
};

for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'resolveSrv', 'reverse']) {
  const orig = dns[name];
  if (typeof orig !== 'function') continue;
  dns[name] = function guardedDns(host, ...rest) {
    if (name === 'lookup' && isLoopback(host)) return orig.call(this, host, ...rest);
    throw record(`dns.${name}`, host);
  };
  const porig = dns.promises[name];
  if (typeof porig === 'function') {
    dns.promises[name] = function guardedDnsPromise(host, ...rest) {
      if (name === 'lookup' && isLoopback(host)) return porig.call(this, host, ...rest);
      return Promise.reject(record(`dns.promises.${name}`, host));
    };
  }
}

const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedSend(...args) {
  const host = args.find((a, i) => i > 0 && typeof a === 'string');
  if (!isLoopback(host)) throw record('udp', host);
  return send.apply(this, args);
};
