/**
 * Certificate loader for the Russian MinTsifry (Минцифры) root CA.
 *
 * The PEM file at `./russian-trusted-ca.pem` must contain the actual certificate
 * downloaded from https://www.gosuslugi.ru/crt. If the file is missing or contains
 * only the placeholder comment (no PEM block), a warning is logged and `certBuffer`
 * is set to `undefined`. The HTTP client then falls back to the system CA bundle
 * while still enforcing `rejectUnauthorized: true`.
 */

import * as fs from 'fs';
import * as path from 'path';

function loadCert(): Buffer | undefined {
  // When running from compiled dist/, the pem lives next to this file.
  // When running tests from source, resolve relative to this source file.
  const candidates = [
    path.join(__dirname, 'russian-trusted-ca.pem'),
    path.join(__dirname, '..', '..', '..', 'nodes', 'shared', 'certs', 'russian-trusted-ca.pem'),
  ];

  for (const certPath of candidates) {
    try {
      const raw = fs.readFileSync(certPath, 'utf8');
      if (raw.includes('-----BEGIN CERTIFICATE-----')) {
        return Buffer.from(raw, 'utf8');
      }
    } catch {
      // file not found — try next candidate
    }
  }

  console.warn(
    '[n8n-nodes-gigachat] Russian MinTsifry CA certificate not found or is a placeholder. ' +
      'Download the real certificate from https://www.gosuslugi.ru/crt and place it at ' +
      'nodes/shared/certs/russian-trusted-ca.pem. ' +
      'Falling back to system CAs (rejectUnauthorized: true is still enforced).',
  );
  return undefined;
}

/** The raw PEM buffer for the MinTsifry root CA, or undefined if unavailable. */
export const certBuffer: Buffer | undefined = loadCert();
