import { put, list, del } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

const DATA_BLOB_PATH = 'data.json';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function verifyPassword(req) {
  const provided = req.headers['x-admin-password'] || '';
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) {
    throw new HttpError(500, 'Server chưa cấu hình ADMIN_PASSWORD');
  }
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, 'Sai mật khẩu');
  }
}

export async function readData() {
  try {
    const { blobs } = await list({ prefix: DATA_BLOB_PATH, limit: 1 });
    const match = blobs.find(b => b.pathname === DATA_BLOB_PATH);
    if (!match) return { config: {}, milestones: [] };
    const res = await fetch(match.url, { cache: 'no-store' });
    if (!res.ok) throw new HttpError(500, `Không đọc được data.json: ${res.status}`);
    const json = await res.json();
    return {
      config: json.config || {},
      milestones: Array.isArray(json.milestones) ? json.milestones : [],
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.message?.includes('BLOB_READ_WRITE_TOKEN')) {
      throw new HttpError(500, 'Server chưa cấu hình BLOB_READ_WRITE_TOKEN');
    }
    throw err;
  }
}

export async function writeData(data) {
  await put(DATA_BLOB_PATH, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function deletePrefix(prefix) {
  const urls = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    urls.push(...page.blobs.map(b => b.url));
    cursor = page.cursor;
  } while (cursor);
  if (urls.length) await del(urls);
}

export function sendJson(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function handleError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : 'Lỗi server không rõ';
  if (!(err instanceof HttpError)) console.error('Unexpected:', err);
  sendJson(res, status, { error: message });
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new HttpError(400, 'Body không phải JSON hợp lệ'); }
}
