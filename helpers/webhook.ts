import http from 'http';
import https from 'https';

interface WebhookArgs {
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
}

export interface StoredWebhook {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: string;
  body: string;
}

function validateWebhookRequest(args: WebhookArgs): { url: URL; method: string; headers: Record<string, string>; body: string } {
  if (typeof args.url !== 'string' || typeof args.method !== 'string'
    || typeof args.headers !== 'string' || typeof args.body !== 'string') {
    throw new Error('Webhook URL, method, headers and body must be provided as text.');
  }
  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS webhook URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Webhook URLs must use HTTP or HTTPS and must not contain credentials.');
  }
  const method = args.method.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error('Unsupported webhook method.');
  }
  let headers: unknown;
  try {
    headers = args.headers.trim() ? JSON.parse(args.headers) : {};
  } catch {
    throw new Error('Webhook headers must be a JSON object with string values.');
  }
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)
    || !Object.values(headers).every((value) => typeof value === 'string')) {
    throw new Error('Webhook headers must be a JSON object with string values.');
  }
  try {
    Object.entries(headers).forEach(([name, value]) => {
      http.validateHeaderName(name);
      http.validateHeaderValue(name, value);
    });
  } catch {
    throw new Error('Webhook header names and values must be valid HTTP headers.');
  }
  if (Buffer.byteLength(args.body) > 1024 * 1024) {
    throw new Error('Webhook body must not exceed 1 MB.');
  }
  return {
    url, method, headers: headers as Record<string, string>, body: args.body,
  };
}

export function validateStoredWebhooks(value: unknown): StoredWebhook[] {
  if (!Array.isArray(value) || value.length > 50 || Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) {
    throw new Error('Saved webhooks must be a list of at most 50 entries and 512 KB.');
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || !('name' in entry)
      || !('url' in entry) || !('method' in entry) || !('headers' in entry) || !('body' in entry)
      || typeof entry.id !== 'string' || !/^[a-f0-9]{32}$/.test(entry.id)
      || typeof entry.name !== 'string' || entry.name !== entry.name.trim() || !entry.name || entry.name.length > 80
      || typeof entry.url !== 'string' || entry.url !== entry.url.trim() || entry.url.length > 4096
      || typeof entry.method !== 'string' || entry.method !== entry.method.toUpperCase()
      || typeof entry.headers !== 'string' || Buffer.byteLength(entry.headers) > 16384
      || typeof entry.body !== 'string' || Buffer.byteLength(entry.body) > 65536) {
      throw new Error('A saved webhook has invalid fields.');
    }
    const name = entry.name.toLowerCase();
    if (ids.has(entry.id) || names.has(name)) throw new Error('Webhook names and IDs must be unique.');
    ids.add(entry.id);
    names.add(name);
    validateWebhookRequest(entry);
    return {
      id: entry.id, name: entry.name, url: entry.url, method: entry.method, headers: entry.headers, body: entry.body,
    };
  });
}

export default async function sendWebhook(args: WebhookArgs): Promise<void> {
  const {
    url, method, headers, body,
  } = validateWebhookRequest(args);
  await new Promise<void>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method,
      headers,
    }, (response) => {
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy(new Error('Webhook response too large.'));
      });
      response.on('error', () => reject(new Error('Webhook response failed.')));
      response.on('aborted', () => reject(new Error('Webhook response was interrupted.')));
      response.on('end', () => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`Webhook returned HTTP ${status}.`));
        } else {
          resolve();
        }
      });
    });
    if (body && !request.hasHeader('content-length') && !request.hasHeader('transfer-encoding')) {
      request.setHeader('Content-Length', Buffer.byteLength(body));
    }
    const timeout = setTimeout(() => request.destroy(new Error('Webhook request timed out.')), 15000);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', () => reject(new Error('Webhook request failed or timed out.')));
    request.end(body);
  });
}
