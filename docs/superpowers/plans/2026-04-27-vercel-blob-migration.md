# Vercel Blob Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển save-the-dates từ phụ thuộc Google Drive sang tự host trên Vercel: ảnh + metadata lưu trên Vercel Blob, có UI upload bảo vệ bằng mật khẩu admin nhập trực tiếp trên trang chính.

**Architecture:** Frontend HTML đơn file gọi serverless functions trong `api/`. Functions xác thực qua header `x-admin-password` (so với env var). Upload file dùng client-upload pattern của `@vercel/blob` (frontend PUT trực tiếp lên Blob, bypass 4.5 MB limit). Một file `data.json` trên Blob lưu cả config + milestones.

**Tech Stack:**
- Vanilla HTML/CSS/JS (single file, no build step)
- Node.js Vercel serverless functions
- `@vercel/blob` (server) + `@vercel/blob/client` (frontend qua esm.sh)
- Manual verification (curl + browser) — không thêm test framework cho project nhỏ

**Spec:** `docs/superpowers/specs/2026-04-27-vercel-blob-migration-design.md`

**Validation strategy:** Mỗi API task có 1 lệnh `curl` để verify trước khi commit. Frontend task verify bằng tay trên `vercel dev` localhost. Cuối cùng có manual checklist sau khi deploy production.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `vercel.json`

- [ ] **Step 1.1: Tạo `package.json`**

```json
{
  "name": "save-the-dates",
  "version": "1.0.0",
  "private": true,
  "description": "Counting Love landing page — Vercel + Blob",
  "dependencies": {
    "@vercel/blob": "^0.27.0"
  }
}
```

- [ ] **Step 1.2: Tạo `.gitignore`**

```
node_modules/
.vercel/
.env
.env.local
.env.*.local
*.log
.DS_Store
```

- [ ] **Step 1.3: Tạo `vercel.json`**

```json
{
  "headers": [
    {
      "source": "/api/data",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

- [ ] **Step 1.4: Cài dependency**

Run: `npm install`
Expected: `node_modules/@vercel/blob/` tồn tại.

- [ ] **Step 1.5: Cài Vercel CLI (nếu chưa có)**

Run: `npm install -g vercel`
Expected: `vercel --version` chạy được.

- [ ] **Step 1.6: Commit**

```bash
git add package.json package-lock.json .gitignore vercel.json
git commit -m "chore: scaffold Vercel project with @vercel/blob dependency"
```

---

## Task 2: Tạo Vercel project + Blob store + env vars (user thao tác trên dashboard)

> Đây là task **manual** — không có code. Phải chạy trước Task 3 vì các API cần BLOB_READ_WRITE_TOKEN để chạy `vercel dev`.

**Files:**
- Create: `.env.local` (local-only, KHÔNG commit)

- [ ] **Step 2.1: Tạo Vercel project**

Trên `vercel.com/dashboard`:
1. Add New → Project → Import từ GitHub (push repo trước nếu chưa).
   - Hoặc dùng CLI: trong thư mục project chạy `vercel link` → trả lời câu hỏi để link thư mục với Vercel project mới/cũ.
2. Build settings: Framework = Other. Output dir để mặc định.

- [ ] **Step 2.2: Tạo Blob store**

Trên project vừa tạo:
1. Tab `Storage` → `Create Database` → chọn `Blob` → đặt tên (vd `counting-love-blob`).
2. Connect to project → Vercel tự thêm env var `BLOB_READ_WRITE_TOKEN` cho cả 3 môi trường.

- [ ] **Step 2.3: Đặt `ADMIN_PASSWORD`**

Project → Settings → Environment Variables:
- Key: `ADMIN_PASSWORD`
- Value: chọn mật khẩu mạnh (vd ≥ 16 ký tự).
- Environment: Production + Preview + Development.

- [ ] **Step 2.4: Pull env vars về local**

Run trong thư mục project:
```bash
vercel env pull .env.local
```
Expected: tạo file `.env.local` chứa cả `BLOB_READ_WRITE_TOKEN` và `ADMIN_PASSWORD`.

- [ ] **Step 2.5: Verify `.env.local` không bị commit**

Run: `git status`
Expected: `.env.local` không xuất hiện (đã trong `.gitignore`).

- [ ] **Step 2.6: Không commit ở task này** (chưa có code mới)

---

## Task 3: Shared helper module

**Files:**
- Create: `api/_lib.js`

- [ ] **Step 3.1: Viết `api/_lib.js`**

```js
// api/_lib.js — shared helpers cho serverless functions
import { put, head, list, del } from '@vercel/blob';
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
  // Tìm data.json trên blob; nếu chưa có trả default empty.
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
  // Xóa toàn bộ blob có pathname bắt đầu bằng prefix.
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
```

- [ ] **Step 3.2: Lint check (cú pháp)**

Run: `node --check api/_lib.js`
Expected: không in gì (= cú pháp ổn). Nếu có lỗi sửa rồi chạy lại.

- [ ] **Step 3.3: Commit**

```bash
git add api/_lib.js
git commit -m "feat(api): add shared helpers for auth and Blob CRUD"
```

---

## Task 4: GET `/api/data`

**Files:**
- Create: `api/data.js`

- [ ] **Step 4.1: Viết `api/data.js`**

```js
import { readData, sendJson, handleError, HttpError } from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      throw new HttpError(405, 'Method not allowed');
    }
    const data = await readData();
    sendJson(res, 200, data);
  } catch (err) {
    handleError(res, err);
  }
}
```

- [ ] **Step 4.2: Khởi động `vercel dev` ở terminal khác**

Run (background terminal): `vercel dev`
Expected: server chạy trên `http://localhost:3000`.

- [ ] **Step 4.3: Verify endpoint**

Run: `curl -s http://localhost:3000/api/data`
Expected (lần đầu, blob trống): `{"config":{},"milestones":[]}`

- [ ] **Step 4.4: Commit**

```bash
git add api/data.js
git commit -m "feat(api): add GET /api/data endpoint"
```

---

## Task 5: POST `/api/auth`

**Files:**
- Create: `api/auth.js`

- [ ] **Step 5.1: Viết `api/auth.js`**

```js
import { verifyPassword, sendJson, handleError, HttpError } from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }
    verifyPassword(req);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    handleError(res, err);
  }
}
```

- [ ] **Step 5.2: Verify sai pass → 401**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H "x-admin-password: WRONG" \
  http://localhost:3000/api/auth
```
Expected: `401`

- [ ] **Step 5.3: Verify đúng pass → 200**

Run (thay `<MY_PASS>` bằng `ADMIN_PASSWORD` thật trong `.env.local`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H "x-admin-password: <MY_PASS>" \
  http://localhost:3000/api/auth
```
Expected: `200`

- [ ] **Step 5.4: Commit**

```bash
git add api/auth.js
git commit -m "feat(api): add POST /api/auth endpoint"
```

---

## Task 6: POST `/api/blob-upload` (client-upload token)

**Files:**
- Create: `api/blob-upload.js`

> **Lưu ý:** Password được verify qua field `clientPayload` (KHÔNG phải header `x-admin-password`). Lý do: `@vercel/blob/client.upload()` ở frontend không hỗ trợ truyền custom header — chỉ cho gửi `clientPayload` (string). Đây là điểm khác duy nhất so với spec section 6.

- [ ] **Step 6.1: Viết `api/blob-upload.js`**

```js
import { handleUpload } from '@vercel/blob/client';
import { timingSafeEqual } from 'node:crypto';
import {
  readJsonBody, sendJson, handleError, HttpError,
} from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }
    const body = await readJsonBody(req);

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload, _multipart) => {
        const provided = String(clientPayload || '');
        const expected = process.env.ADMIN_PASSWORD || '';
        if (!expected) throw new HttpError(500, 'Server chưa cấu hình ADMIN_PASSWORD');
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          throw new HttpError(401, 'Sai mật khẩu');
        }
        if (!/^(avatars\/|milestones\/)/.test(pathname)) {
          throw new HttpError(400, 'Pathname không hợp lệ');
        }
        return {
          allowedContentTypes: ['image/*', 'video/*'],
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
      onUploadCompleted: async () => {
        // No-op; commit metadata diễn ra ở /api/milestones hoặc /api/config.
      },
    });

    sendJson(res, 200, jsonResponse);
  } catch (err) {
    handleError(res, err);
  }
}
```

- [ ] **Step 6.2: Verify sai password → 401 (clientPayload rỗng)**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H "content-type: application/json" \
  --data '{"type":"blob.generate-client-token","payload":{"pathname":"avatars/test.jpg","callbackUrl":"http://localhost:3000/api/blob-upload","clientPayload":"","multipart":false}}' \
  http://localhost:3000/api/blob-upload
```
Expected: `401`

> Đường happy path sẽ verify qua UI ở Step 12.3 vì payload upload phức tạp.

- [ ] **Step 6.3: Commit**

```bash
git add api/blob-upload.js
git commit -m "feat(api): add POST /api/blob-upload for client-upload tokens"
```

---

## Task 7: POST `/api/config`

**Files:**
- Create: `api/config.js`

- [ ] **Step 7.1: Viết `api/config.js`**

```js
import {
  verifyPassword, readData, writeData, readJsonBody,
  sendJson, handleError, HttpError,
} from './_lib.js';

const ALLOWED_KEYS = [
  'start_date',
  'person1_name', 'person1_dob', 'person1_avatar_url',
  'person2_name', 'person2_dob', 'person2_avatar_url',
];

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }
    verifyPassword(req);
    const body = await readJsonBody(req);

    const patch = {};
    for (const k of ALLOWED_KEYS) {
      if (k in body) patch[k] = body[k] == null ? '' : String(body[k]);
    }

    const data = await readData();
    data.config = { ...data.config, ...patch };
    await writeData(data);

    sendJson(res, 200, { ok: true, config: data.config });
  } catch (err) {
    handleError(res, err);
  }
}
```

- [ ] **Step 7.2: Verify happy path**

Run (thay `<MY_PASS>`):
```bash
curl -s -X POST \
  -H "x-admin-password: <MY_PASS>" \
  -H "content-type: application/json" \
  --data '{"start_date":"2023-05-20","person1_name":"Hải","person2_name":"Yên"}' \
  http://localhost:3000/api/config
```
Expected: JSON `{"ok":true,"config":{"start_date":"2023-05-20","person1_name":"Hải","person2_name":"Yên"}}`

- [ ] **Step 7.3: Verify đã ghi vào blob**

Run: `curl -s http://localhost:3000/api/data`
Expected: chứa `"start_date":"2023-05-20"` trong config.

- [ ] **Step 7.4: Verify sai pass**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H "x-admin-password: WRONG" \
  -H "content-type: application/json" \
  --data '{"start_date":"2099-01-01"}' \
  http://localhost:3000/api/config
```
Expected: `401`

- [ ] **Step 7.5: Commit**

```bash
git add api/config.js
git commit -m "feat(api): add POST /api/config to update couple info"
```

---

## Task 8: POST + DELETE `/api/milestones`

**Files:**
- Create: `api/milestones.js`

- [ ] **Step 8.1: Viết `api/milestones.js`**

```js
import {
  verifyPassword, readData, writeData, readJsonBody, deletePrefix,
  sendJson, handleError, HttpError,
} from './_lib.js';

function sanitizeMilestone(input) {
  const id = String(input.id || '').trim();
  if (!/^[0-9]+$/.test(id)) throw new HttpError(400, 'id phải là số');
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'date sai định dạng (YYYY-MM-DD)');

  const media = Array.isArray(input.media) ? input.media : [];
  const cleanMedia = media.map(m => {
    const url = String(m?.url || '');
    const type = m?.type === 'video' ? 'video' : 'image';
    if (!/^https?:\/\//.test(url)) throw new HttpError(400, 'media.url không hợp lệ');
    return { url, type };
  });

  return {
    id,
    emoji: String(input.emoji || '💕').slice(0, 8),
    date,
    title: String(input.title || '').slice(0, 200),
    description: String(input.description || '').slice(0, 2000),
    media: cleanMedia,
  };
}

export default async function handler(req, res) {
  try {
    verifyPassword(req);

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const ms = sanitizeMilestone(body);
      const data = await readData();
      // Replace nếu trùng id, append nếu mới (giúp idempotent với client retry).
      const idx = data.milestones.findIndex(m => m.id === ms.id);
      if (idx >= 0) data.milestones[idx] = ms;
      else data.milestones.push(ms);
      await writeData(data);
      sendJson(res, 200, { ok: true, milestone: ms });
      return;
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id') || '';
      if (!/^[0-9]+$/.test(id)) throw new HttpError(400, 'id thiếu hoặc sai');
      const data = await readData();
      const before = data.milestones.length;
      data.milestones = data.milestones.filter(m => m.id !== id);
      if (data.milestones.length === before) {
        throw new HttpError(404, 'Không tìm thấy mốc với id đó');
      }
      await writeData(data);
      // Best-effort: xóa các blob media đi kèm. Nếu lỗi vẫn coi như xong.
      try { await deletePrefix(`milestones/${id}/`); }
      catch (e) { console.error('deletePrefix failed:', e); }
      sendJson(res, 200, { ok: true });
      return;
    }

    throw new HttpError(405, 'Method not allowed');
  } catch (err) {
    handleError(res, err);
  }
}
```

- [ ] **Step 8.2: Verify POST tạo mốc mới**

Run (thay `<MY_PASS>`):
```bash
curl -s -X POST \
  -H "x-admin-password: <MY_PASS>" \
  -H "content-type: application/json" \
  --data '{"id":"1714200000001","emoji":"🌸","date":"2023-03-15","title":"Test","description":"x","media":[{"url":"https://example.com/a.jpg","type":"image"}]}' \
  http://localhost:3000/api/milestones
```
Expected: JSON với `"ok":true`.

- [ ] **Step 8.3: Verify mốc xuất hiện trong /api/data**

Run: `curl -s http://localhost:3000/api/data`
Expected: mảng `milestones` chứa entry với `id: "1714200000001"`.

- [ ] **Step 8.4: Verify DELETE**

Run:
```bash
curl -s -X DELETE \
  -H "x-admin-password: <MY_PASS>" \
  "http://localhost:3000/api/milestones?id=1714200000001"
```
Expected: `{"ok":true}`

- [ ] **Step 8.5: Verify mốc đã biến mất**

Run: `curl -s http://localhost:3000/api/data`
Expected: mảng `milestones` rỗng (hoặc không còn id `1714200000001`).

- [ ] **Step 8.6: Verify DELETE không tồn tại → 404**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X DELETE -H "x-admin-password: <MY_PASS>" \
  "http://localhost:3000/api/milestones?id=9999999999999"
```
Expected: `404`

- [ ] **Step 8.7: Commit**

```bash
git add api/milestones.js
git commit -m "feat(api): add POST/DELETE /api/milestones"
```

---

## Task 9: Frontend — bỏ logic Drive, render từ /api/data

**Files:**
- Modify: `index.html` (rewrite block `<script>` cuối file; comment header; bỏ `setAvatar` cũ)

> Đây là task **viết đè** — sẽ rewrite phần JS đáng kể. Frontend cũ dùng Drive API + `mediaFileIds`; mới dùng `media: [{url, type}]`.

- [ ] **Step 9.1: Cập nhật comment header trong `<head>`**

Mở `index.html`, thay toàn bộ comment SETUP cũ (đoạn `<!-- SETUP (làm 1 lần) ... -->`) bằng:

```html
<!--
================================================================
 SETUP:
   1. Push lên GitHub → Vercel import project.
   2. Storage tab → Create Blob store → connect.
   3. Settings → Env vars → ADMIN_PASSWORD = <mật khẩu của bạn>.
   4. Deploy.
   5. Mở URL Vercel → click ✏️ góc dưới phải → nhập pass → điền config + tạo mốc.
 Spec đầy đủ: docs/superpowers/specs/2026-04-27-vercel-blob-migration-design.md
================================================================
-->
```

- [ ] **Step 9.2: Xóa toàn bộ block `<script>` cuối file (dòng `<script>` đến `</script>`)**

Block bắt đầu bằng `// ================== CẤU HÌNH — dán vào đây ==================` và kết thúc trước `</body>`. Xóa toàn bộ.

- [ ] **Step 9.3: Thêm block `<script>` mới (chỉ phần data fetch + render — chưa có admin)**

Trước `</body>` chèn:

```html
<script type="module">
  // ============== STATE ==============
  const state = {
    config: {},
    milestones: [],
  };

  // ============== DATA ==============
  async function loadData() {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error(`GET /api/data ${res.status}`);
    const json = await res.json();
    state.config = json.config || {};
    state.milestones = Array.isArray(json.milestones) ? json.milestones : [];
  }

  // ============== HELPERS ==============
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function defaultAvatar() {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <rect width="200" height="200" fill="#ffe0ec"/>
        <circle cx="100" cy="78" r="34" fill="#ff6b8a"/>
        <path d="M30 200 Q100 125 170 200 Z" fill="#ff6b8a"/>
      </svg>`);
  }
  function formatDob(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const [y, m, d] = iso.split('-');
    return `${d} · ${m} · ${y}`;
  }
  function formatDateLong(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${+d} tháng ${+m}, ${y}`;
  }

  // ============== RENDER ==============
  function renderHero() {
    const c = state.config;
    document.getElementById('p1-name').textContent = c.person1_name || '—';
    document.getElementById('p2-name').textContent = c.person2_name || '—';
    document.getElementById('p1-dob').textContent = formatDob(c.person1_dob);
    document.getElementById('p2-dob').textContent = formatDob(c.person2_dob);
    setAvatar('p1-avatar', c.person1_avatar_url);
    setAvatar('p2-avatar', c.person2_avatar_url);
  }
  function setAvatar(imgId, url) {
    const img = document.getElementById(imgId);
    if (!url) { img.src = defaultAvatar(); return; }
    img.src = url;
    img.onerror = () => { img.onerror = null; img.src = defaultAvatar(); };
  }
  function renderQuote() {
    const lastWord = s => (String(s || '').trim().split(/\s+/).pop() || '').toUpperCase();
    const p1 = lastWord(state.config.person1_name) || '—';
    const p2 = lastWord(state.config.person2_name) || '—';
    document.getElementById('quote-cite').textContent = `— ${p1} & ${p2} —`;
  }

  let countdownTimer = null;
  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
  function tick() {
    const startStr = state.config.start_date;
    if (!startStr) {
      document.getElementById('days').textContent = '—';
      document.getElementById('hours').textContent = '--';
      document.getElementById('minutes').textContent = '--';
      document.getElementById('seconds').textContent = '--';
      return;
    }
    const start = new Date(startStr + 'T00:00:00+07:00').getTime();
    const diff = Math.max(0, Date.now() - start);
    const d = Math.floor(diff / 86400000);
    const h = Math.floor(diff % 86400000 / 3600000);
    const m = Math.floor(diff % 3600000 / 60000);
    const s = Math.floor(diff % 60000 / 1000);
    document.getElementById('days').textContent = d.toLocaleString('vi-VN');
    document.getElementById('hours').textContent = String(h).padStart(2, '0');
    document.getElementById('minutes').textContent = String(m).padStart(2, '0');
    document.getElementById('seconds').textContent = String(s).padStart(2, '0');
  }

  function renderTimeline() {
    const container = document.getElementById('timeline');
    const empty = document.getElementById('timeline-empty');
    container.innerHTML = '';
    const sorted = [...state.milestones].sort((a, b) =>
      (a.date || '').localeCompare(b.date || ''));
    if (sorted.length === 0) { empty.hidden = false; return; }
    empty.hidden = true;

    for (const ms of sorted) {
      const item = document.createElement('div');
      item.className = 'tl-item';
      const card = document.createElement('div');
      card.className = 'tl-card';
      card.innerHTML = `
        <div class="tl-date">${escapeHtml(formatDateLong(ms.date))}</div>
        <div class="tl-title">${escapeHtml(ms.emoji || '💕')} ${escapeHtml(ms.title || '')}</div>
        <div class="tl-desc">${escapeHtml(ms.description || '')}</div>
        <div class="gallery"></div>`;
      const dot = document.createElement('div');
      dot.className = 'tl-dot';
      dot.textContent = ms.emoji || '💕';
      item.appendChild(card);
      item.appendChild(dot);
      container.appendChild(item);

      const gallery = card.querySelector('.gallery');
      const items = [];
      for (const m of (ms.media || [])) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'thumb';
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = m.type === 'video' ? defaultVideoThumb() : m.url;
        img.onerror = () => { img.onerror = null; img.src = defaultAvatar(); };
        btn.appendChild(img);
        if (m.type === 'video') {
          const play = document.createElement('span');
          play.className = 'play-badge';
          play.textContent = '▶';
          btn.appendChild(play);
        }
        gallery.appendChild(btn);
        items.push({ type: m.type, url: m.url });
      }
      gallery.querySelectorAll('.thumb').forEach((btn, i) => {
        btn.addEventListener('click', () => openLightbox(items, i));
      });
    }
  }
  function defaultVideoThumb() {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <rect width="200" height="200" fill="#3a2a3a"/>
        <polygon points="80,60 80,140 150,100" fill="#fff" opacity="0.85"/>
      </svg>`);
  }

  // ============== LIGHTBOX ==============
  const lightbox = document.getElementById('lightbox');
  const lbContent = document.getElementById('lb-content');
  const lbCounter = document.getElementById('lb-counter');
  let lbGroup = [], lbIndex = 0;

  function openLightbox(group, index) {
    lbGroup = group; lbIndex = index;
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    renderLb();
  }
  function closeLightbox() {
    lightbox.hidden = true;
    lbContent.innerHTML = '';
    document.body.style.overflow = '';
  }
  function renderLb() {
    const item = lbGroup[lbIndex];
    if (!item) return;
    lbContent.innerHTML = '';
    if (item.type === 'video') {
      const v = document.createElement('video');
      v.src = item.url;
      v.controls = true;
      v.autoplay = true;
      v.style.maxWidth = '100%';
      v.style.maxHeight = '85vh';
      v.style.borderRadius = '12px';
      lbContent.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = '';
      lbContent.appendChild(img);
    }
    lbCounter.textContent = `${lbIndex + 1} / ${lbGroup.length}`;
    document.getElementById('lb-prev').style.visibility = lbGroup.length > 1 ? 'visible' : 'hidden';
    document.getElementById('lb-next').style.visibility = lbGroup.length > 1 ? 'visible' : 'hidden';
  }
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-next').addEventListener('click', () => {
    lbIndex = (lbIndex + 1) % lbGroup.length; renderLb();
  });
  document.getElementById('lb-prev').addEventListener('click', () => {
    lbIndex = (lbIndex - 1 + lbGroup.length) % lbGroup.length; renderLb();
  });
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') document.getElementById('lb-next').click();
    else if (e.key === 'ArrowLeft') document.getElementById('lb-prev').click();
  });

  // ============== ERROR / LOADER ==============
  function showError(msg, detail) {
    document.getElementById('loader').hidden = true;
    document.getElementById('app').hidden = true;
    document.getElementById('error-screen').hidden = false;
    document.getElementById('error-msg').innerHTML = msg;
    if (detail) {
      const d = document.getElementById('error-detail');
      d.textContent = detail;
      d.hidden = false;
    }
  }

  // ============== CONFETTI ==============
  const confettiColors = ['#ff6b8a', '#ffd97d', '#7de5d0', '#ffb3c6', '#ff9a9e'];
  const confettiEmojis = ['💖', '✨', '🌸', '💕', '🌟', '💘'];
  function spawnConfetti(count) {
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      const duration = 7 + Math.random() * 9;
      c.style.animationDuration = duration + 's';
      c.style.animationDelay = Math.random() * duration + 's';
      if (Math.random() < 0.35) {
        c.textContent = confettiEmojis[Math.floor(Math.random() * confettiEmojis.length)];
        c.style.fontSize = (14 + Math.random() * 14) + 'px';
        c.style.background = 'transparent';
        c.style.width = 'auto'; c.style.height = 'auto';
      } else {
        c.style.background = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      }
      document.body.appendChild(c);
    }
  }
  spawnConfetti(22);

  // ============== INIT ==============
  async function init() {
    try {
      await loadData();
      renderHero();
      renderTimeline();
      renderQuote();
      document.getElementById('year').textContent = new Date().getFullYear();
      startCountdown();
      document.getElementById('loader').hidden = true;
      document.getElementById('app').hidden = false;
    } catch (err) {
      console.error(err);
      showError('Không tải được dữ liệu từ máy chủ.', err.message || String(err));
    }
  }
  init();
</script>
```

- [ ] **Step 9.4: Verify trên `vercel dev`**

Mở `http://localhost:3000` trong trình duyệt.
Expected:
- Loader biến mất.
- Hero hiện avatar default + tên Hải/Yên (đã set qua Task 7).
- Counter chạy từ 2023-05-20.
- Timeline rỗng (chưa có mốc nào sau khi Task 8 đã xóa).

- [ ] **Step 9.5: Commit**

```bash
git add index.html
git commit -m "feat(ui): replace Drive logic with /api/data fetching"
```

---

## Task 10: CSS cho admin panel + floating button

**Files:**
- Modify: `index.html` (thêm vào block `<style>`)

- [ ] **Step 10.1: Thêm CSS vào cuối block `<style>` (trước `</style>`)**

```css
/* === Admin floating button === */
.admin-fab {
  position: fixed; bottom: 24px; right: 24px; z-index: 90;
  width: 56px; height: 56px; border-radius: 50%; border: none;
  background: var(--coral); color: white; font-size: 1.6rem;
  box-shadow: var(--shadow-lg); cursor: pointer;
  transition: transform 0.2s; display: flex; align-items: center; justify-content: center;
}
.admin-fab:hover { transform: scale(1.08); }

/* === Modal mật khẩu === */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(22,10,22,0.55);
  backdrop-filter: blur(4px); z-index: 1000;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.modal-backdrop[hidden] { display: none; }
.modal-card {
  background: white; border-radius: 20px; padding: 28px 26px;
  box-shadow: var(--shadow-lg); max-width: 380px; width: 100%;
}
.modal-card h3 { color: var(--coral); margin-bottom: 14px; font-size: 1.15rem; }
.modal-card input[type="password"],
.modal-card input[type="text"],
.modal-card input[type="date"],
.modal-card textarea {
  width: 100%; padding: 10px 14px; border: 2px solid #ffd5e0; border-radius: 10px;
  font-family: inherit; font-size: 0.95rem; outline: none;
  transition: border-color 0.2s;
}
.modal-card input:focus, .modal-card textarea:focus { border-color: var(--coral); }
.modal-actions { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }
.btn {
  padding: 10px 18px; border: none; border-radius: 10px; font-family: inherit;
  font-weight: 600; cursor: pointer; font-size: 0.92rem; transition: opacity 0.2s;
}
.btn-primary { background: var(--coral); color: white; }
.btn-primary:hover { opacity: 0.88; }
.btn-ghost { background: transparent; color: var(--ink); }
.btn-ghost:hover { background: #f4e6ec; }
.btn-danger { background: #d94a6b; color: white; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* === Admin drawer === */
.drawer-backdrop {
  position: fixed; inset: 0; background: rgba(22,10,22,0.45);
  z-index: 990;
}
.drawer-backdrop[hidden] { display: none; }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 991;
  width: min(460px, 100vw); background: white;
  box-shadow: -10px 0 40px rgba(0,0,0,0.18);
  display: flex; flex-direction: column;
  animation: slide-in 0.25s ease;
}
.drawer[hidden] { display: none; }
@keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
.drawer-head {
  padding: 18px 22px; border-bottom: 1px solid #f0e0e8;
  display: flex; justify-content: space-between; align-items: center;
}
.drawer-head h2 { color: var(--coral); font-size: 1.1rem; }
.drawer-tabs {
  display: flex; border-bottom: 1px solid #f0e0e8; padding: 0 12px;
}
.drawer-tab {
  flex: 1; padding: 12px 8px; background: transparent; border: none; cursor: pointer;
  font-family: inherit; font-size: 0.85rem; color: var(--muted);
  border-bottom: 3px solid transparent; transition: color 0.2s, border-color 0.2s;
  font-weight: 600;
}
.drawer-tab.active { color: var(--coral); border-bottom-color: var(--coral); }
.drawer-body {
  flex: 1; overflow-y: auto; padding: 18px 22px;
}
.drawer-foot {
  padding: 14px 22px; border-top: 1px solid #f0e0e8;
  display: flex; gap: 10px; justify-content: space-between;
}
.field { margin-bottom: 14px; }
.field label {
  display: block; font-size: 0.82rem; color: var(--muted);
  font-weight: 600; margin-bottom: 6px;
}
.field-row { display: flex; gap: 10px; }
.field-row > .field { flex: 1; }
.avatar-preview {
  width: 72px; height: 72px; border-radius: 50%; object-fit: cover;
  background: #ffe0ec; margin-bottom: 8px;
}
.file-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.file-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; background: #fff8fa; border-radius: 8px;
}
.file-row img {
  width: 40px; height: 40px; object-fit: cover; border-radius: 6px;
  background: #f4e6ec;
}
.file-row .file-name {
  flex: 1; font-size: 0.85rem; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.file-row .progress {
  height: 4px; background: #f0e0e8; border-radius: 2px; flex: 1; overflow: hidden;
  max-width: 100px;
}
.file-row .progress > div {
  height: 100%; background: var(--coral); width: 0%;
  transition: width 0.2s;
}
.file-row .remove {
  background: transparent; border: none; color: #d94a6b;
  cursor: pointer; font-size: 1rem; padding: 4px;
}

.ms-row {
  display: flex; gap: 12px; padding: 12px;
  background: #fff8fa; border-radius: 10px; margin-bottom: 8px;
  align-items: center;
}
.ms-row .ms-emoji { font-size: 1.4rem; }
.ms-row .ms-info { flex: 1; min-width: 0; }
.ms-row .ms-info .ms-title { font-weight: 600; font-size: 0.92rem; }
.ms-row .ms-info .ms-meta { font-size: 0.78rem; color: var(--muted); }

.first-run-banner {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  background: var(--coral); color: white; padding: 10px 18px;
  border-radius: 999px; font-size: 0.88rem; z-index: 80;
  box-shadow: var(--shadow); font-weight: 600;
}
.first-run-banner[hidden] { display: none; }

@media (max-width: 720px) {
  .drawer { width: 100vw; }
  .admin-fab { bottom: 16px; right: 16px; width: 48px; height: 48px; font-size: 1.4rem; }
}
```

- [ ] **Step 10.2: Verify chưa có HTML (CSS không break trang hiện tại)**

Reload `http://localhost:3000`.
Expected: trang vẫn render bình thường, không có nút admin (chưa thêm HTML).

- [ ] **Step 10.3: Commit**

```bash
git add index.html
git commit -m "feat(ui): add CSS for admin floating button, modal, drawer"
```

---

## Task 11: Frontend — floating button + password modal

**Files:**
- Modify: `index.html` (thêm HTML + JS auth flow)

- [ ] **Step 11.1: Thêm HTML cho floating button + modal + drawer skeleton**

Trước `<div id="toast" class="toast" hidden></div>` (cuối body, gần `</body>`), chèn:

```html
  <!-- Admin floating button -->
  <button class="admin-fab" id="admin-fab" aria-label="Quản lý" hidden>✏️</button>

  <!-- First-run banner -->
  <div class="first-run-banner" id="first-run-banner" hidden>
    Chưa có dữ liệu — click ✏️ ở góc dưới phải để thiết lập
  </div>

  <!-- Password modal -->
  <div class="modal-backdrop" id="auth-modal" hidden>
    <div class="modal-card">
      <h3>Nhập mật khẩu admin</h3>
      <form id="auth-form">
        <input type="password" id="auth-pass" autocomplete="current-password" autofocus>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="auth-cancel">Đóng</button>
          <button type="submit" class="btn btn-primary" id="auth-submit">Mở khóa</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Admin drawer -->
  <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
  <aside class="drawer" id="drawer" hidden aria-label="Quản lý">
    <div class="drawer-head">
      <h2>Quản lý</h2>
      <button class="btn btn-ghost" id="drawer-close" aria-label="Đóng">✕</button>
    </div>
    <div class="drawer-tabs" role="tablist">
      <button class="drawer-tab active" data-tab="couple" role="tab">Cặp đôi</button>
      <button class="drawer-tab" data-tab="add" role="tab">Thêm mốc</button>
      <button class="drawer-tab" data-tab="list" role="tab">Danh sách</button>
    </div>
    <div class="drawer-body" id="drawer-body">
      <!-- nội dung 3 tab inject runtime -->
    </div>
    <div class="drawer-foot">
      <button class="btn btn-ghost" id="drawer-logout">Đăng xuất</button>
    </div>
  </aside>
```

- [ ] **Step 11.2: Trong block `<script type="module">`, thêm logic auth + drawer (chèn TRƯỚC `init()`)**

```js
  // ============== ADMIN AUTH ==============
  const PASS_KEY = 'admin_pw';
  function getPass() { return sessionStorage.getItem(PASS_KEY) || ''; }
  function setPass(p) { sessionStorage.setItem(PASS_KEY, p); }
  function clearPass() { sessionStorage.removeItem(PASS_KEY); }

  function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = isError ? '#d94a6b' : 'var(--ink)';
    t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 2400);
  }

  async function verifyPasswordAttempt(password) {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'x-admin-password': password },
    });
    if (res.status === 200) return true;
    if (res.status === 401) return false;
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `auth failed: ${res.status}`);
  }

  // Modal handlers
  const adminFab = document.getElementById('admin-fab');
  const authModal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const authPass = document.getElementById('auth-pass');
  const authCancel = document.getElementById('auth-cancel');
  const authSubmit = document.getElementById('auth-submit');

  adminFab.addEventListener('click', () => {
    if (getPass()) { openDrawer(); return; }
    authPass.value = '';
    authModal.hidden = false;
    setTimeout(() => authPass.focus(), 0);
  });
  authCancel.addEventListener('click', () => { authModal.hidden = true; });
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = authPass.value;
    if (!pass) return;
    authSubmit.disabled = true;
    try {
      const ok = await verifyPasswordAttempt(pass);
      if (!ok) { showToast('Sai mật khẩu', true); authPass.value = ''; return; }
      setPass(pass);
      authModal.hidden = true;
      openDrawer();
    } catch (err) {
      showToast(err.message || 'Lỗi xác thực', true);
    } finally {
      authSubmit.disabled = false;
    }
  });

  // Drawer handlers (skeleton — tab content sẽ thêm ở Task 12-14)
  const drawer = document.getElementById('drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerClose = document.getElementById('drawer-close');
  const drawerLogout = document.getElementById('drawer-logout');
  const drawerTabs = document.querySelectorAll('.drawer-tab');
  const drawerBody = document.getElementById('drawer-body');

  function openDrawer() {
    drawer.hidden = false;
    drawerBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    activateTab('couple');
  }
  function closeDrawer() {
    drawer.hidden = true;
    drawerBackdrop.hidden = true;
    document.body.style.overflow = '';
  }
  drawerClose.addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);
  drawerLogout.addEventListener('click', () => { clearPass(); closeDrawer(); });
  drawerTabs.forEach(b => b.addEventListener('click', () => activateTab(b.dataset.tab)));

  function activateTab(name) {
    drawerTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'couple') drawerBody.innerHTML = '<p style="color:var(--muted)">Tab Cặp đôi (Task 12)</p>';
    else if (name === 'add') drawerBody.innerHTML = '<p style="color:var(--muted)">Tab Thêm mốc (Task 13)</p>';
    else drawerBody.innerHTML = '<p style="color:var(--muted)">Tab Danh sách (Task 14)</p>';
  }

  function showFirstRunBannerIfNeeded() {
    const empty = !state.config.start_date && !state.config.person1_name;
    document.getElementById('first-run-banner').hidden = !empty;
  }
```

- [ ] **Step 11.3: Trong `init()`, hiện admin FAB + banner sau khi load**

Sửa hàm `init()` đang có để bật `adminFab`:

Tìm:
```js
      document.getElementById('app').hidden = false;
```
Thêm 2 dòng ngay sau:
```js
      document.getElementById('admin-fab').hidden = false;
      showFirstRunBannerIfNeeded();
```

- [ ] **Step 11.4: Verify trên trình duyệt**

Reload `http://localhost:3000`.
Expected:
- Nút ✏️ floating xuất hiện góc dưới phải.
- Click ✏️ → modal mật khẩu hiện.
- Nhập sai → toast đỏ "Sai mật khẩu".
- Nhập đúng → drawer mở từ phải, có 3 tab, body hiện text placeholder.
- Click "Đăng xuất" → drawer đóng, click ✏️ lại → modal hiện lại (chứng tỏ pass đã clear).
- Click ✏️ lần 2 trong cùng tab (chưa đăng xuất) → mở thẳng drawer (skip modal).

- [ ] **Step 11.5: Commit**

```bash
git add index.html
git commit -m "feat(ui): add admin password modal + drawer skeleton"
```

---

## Task 12: Frontend — Tab "Cặp đôi" (config form + avatar upload)

**Files:**
- Modify: `index.html` (thay placeholder của tab `couple`, thêm helper upload)

- [ ] **Step 12.1: Thêm BLOB UPLOAD HELPER (chèn trong block `<script type="module">` ngay sau phần ADMIN AUTH)**

```js
  // ============== BLOB UPLOAD HELPER ==============
  // @vercel/blob/client.upload load qua esm.sh để khỏi cần build step.
  let _blobClient = null;
  async function getBlobClient() {
    if (_blobClient) return _blobClient;
    _blobClient = await import('https://esm.sh/@vercel/blob@0.27.0/client');
    return _blobClient;
  }

  function slugifyFilename(name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    const slug = base
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // bỏ dấu tiếng Việt
      .toLowerCase()
      .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file';
    return slug + ext;
  }

  function detectMediaType(mime) {
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('image/')) return 'image';
    return 'image';
  }

  async function uploadBlob(file, pathname, onProgress) {
    const pass = getPass();
    if (!pass) throw new Error('Chưa đăng nhập');
    const { upload } = await getBlobClient();
    return upload(pathname, file, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload',
      contentType: file.type || 'application/octet-stream',
      clientPayload: pass,            // server-side đọc trong onBeforeGenerateToken
      onUploadProgress: ({ percentage }) => {
        if (typeof onProgress === 'function') onProgress(percentage);
      },
    });
    // Trả: { url, pathname, contentType, contentDisposition }
  }
```

- [ ] **Step 12.2: Render Tab "Cặp đôi" — sửa `activateTab` cho case `couple`**

Thay khối `if (name === 'couple') drawerBody.innerHTML = ...` bằng:

```js
    if (name === 'couple') renderCoupleTab();
    else if (name === 'add') renderAddTab();
    else renderListTab();
```

Rồi thêm function `renderCoupleTab()` (cùng block script):

```js
  function renderCoupleTab() {
    const c = state.config;
    drawerBody.innerHTML = `
      <div class="field">
        <label>Ngày bắt đầu yêu</label>
        <input type="date" id="cf-start" value="${escapeHtml(c.start_date || '')}">
      </div>
      <hr style="border:none;border-top:1px solid #f0e0e8;margin:18px 0">
      <div class="field-row">
        <div class="field">
          <label>Người 1 — avatar</label>
          <img class="avatar-preview" id="cf-p1-preview" src="${c.person1_avatar_url || defaultAvatar()}">
          <input type="file" id="cf-p1-file" accept="image/*">
        </div>
        <div class="field">
          <label>Người 2 — avatar</label>
          <img class="avatar-preview" id="cf-p2-preview" src="${c.person2_avatar_url || defaultAvatar()}">
          <input type="file" id="cf-p2-file" accept="image/*">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Tên người 1</label>
          <input type="text" id="cf-p1-name" value="${escapeHtml(c.person1_name || '')}">
        </div>
        <div class="field">
          <label>DOB người 1</label>
          <input type="date" id="cf-p1-dob" value="${escapeHtml(c.person1_dob || '')}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Tên người 2</label>
          <input type="text" id="cf-p2-name" value="${escapeHtml(c.person2_name || '')}">
        </div>
        <div class="field">
          <label>DOB người 2</label>
          <input type="date" id="cf-p2-dob" value="${escapeHtml(c.person2_dob || '')}">
        </div>
      </div>
      <button class="btn btn-primary" id="cf-save" style="width:100%;margin-top:8px;">Lưu</button>
    `;

    // Preview khi chọn file
    const p1File = document.getElementById('cf-p1-file');
    const p2File = document.getElementById('cf-p2-file');
    p1File.addEventListener('change', e => previewFile(e.target.files[0], 'cf-p1-preview'));
    p2File.addEventListener('change', e => previewFile(e.target.files[0], 'cf-p2-preview'));

    document.getElementById('cf-save').addEventListener('click', saveCouple);
  }

  function previewFile(file, imgId) {
    if (!file) return;
    const img = document.getElementById(imgId);
    img.src = URL.createObjectURL(file);
  }

  async function saveCouple() {
    const btn = document.getElementById('cf-save');
    btn.disabled = true;
    btn.textContent = 'Đang lưu…';
    try {
      const patch = {
        start_date: document.getElementById('cf-start').value || '',
        person1_name: document.getElementById('cf-p1-name').value || '',
        person1_dob: document.getElementById('cf-p1-dob').value || '',
        person2_name: document.getElementById('cf-p2-name').value || '',
        person2_dob: document.getElementById('cf-p2-dob').value || '',
      };
      const p1File = document.getElementById('cf-p1-file').files[0];
      const p2File = document.getElementById('cf-p2-file').files[0];
      if (p1File) {
        btn.textContent = 'Đang upload avatar 1…';
        const ext = p1File.name.split('.').pop().toLowerCase() || 'jpg';
        const r = await uploadBlob(p1File, `avatars/p1-${Date.now()}.${ext}`);
        patch.person1_avatar_url = r.url;
      }
      if (p2File) {
        btn.textContent = 'Đang upload avatar 2…';
        const ext = p2File.name.split('.').pop().toLowerCase() || 'jpg';
        const r = await uploadBlob(p2File, `avatars/p2-${Date.now()}.${ext}`);
        patch.person2_avatar_url = r.url;
      }
      btn.textContent = 'Đang lưu config…';
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'x-admin-password': getPass(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Lỗi ${res.status}`);
      }
      await loadData();
      renderHero();
      renderQuote();
      showFirstRunBannerIfNeeded();
      showToast('Đã lưu thông tin cặp đôi');
      renderCoupleTab(); // refresh form values
    } catch (err) {
      showToast(err.message || 'Lưu thất bại', true);
    } finally {
      btn.disabled = false;
    }
  }
```

- [ ] **Step 12.3: Verify**

Trên trình duyệt:
1. Reload `http://localhost:3000`.
2. Click ✏️ → nhập pass → drawer mở, tab "Cặp đôi" hiện form đã có data từ Task 7 (Hải/Yên).
3. Đổi tên người 1 → Lưu → toast "Đã lưu". Reload trang → tên mới giữ nguyên trong hero.
4. Chọn avatar người 1 (file ảnh) → preview cập nhật → Lưu → tên + avatar đều đổi sau reload.
5. Mở Vercel dashboard → Storage → Blob → kiểm tra có file `avatars/p1-<ts>.jpg`.

- [ ] **Step 12.4: Commit**

```bash
git add api/blob-upload.js index.html
git commit -m "feat(ui): admin tab \"Cặp đôi\" with avatar upload"
```

---

## Task 13: Frontend — Tab "Thêm mốc"

**Files:**
- Modify: `index.html`

- [ ] **Step 13.1: Thêm function `renderAddTab()` (chèn sau `saveCouple`)**

```js
  let pendingFiles = []; // { file, progress, key }

  function renderAddTab() {
    drawerBody.innerHTML = `
      <div class="field-row">
        <div class="field" style="flex:0 0 80px">
          <label>Emoji</label>
          <input type="text" id="ad-emoji" maxlength="4" value="🌸">
        </div>
        <div class="field">
          <label>Ngày</label>
          <input type="date" id="ad-date">
        </div>
      </div>
      <div class="field">
        <label>Tiêu đề</label>
        <input type="text" id="ad-title" maxlength="200">
      </div>
      <div class="field">
        <label>Mô tả</label>
        <textarea id="ad-desc" rows="4" maxlength="2000"></textarea>
      </div>
      <div class="field">
        <label>Ảnh / video (chọn nhiều)</label>
        <input type="file" id="ad-files" accept="image/*,video/*" multiple>
        <div class="file-list" id="ad-file-list"></div>
      </div>
      <button class="btn btn-primary" id="ad-save" style="width:100%;margin-top:8px;">Lưu mốc</button>
    `;
    pendingFiles = [];
    renderFileList();
    document.getElementById('ad-files').addEventListener('change', e => {
      for (const f of e.target.files) {
        pendingFiles.push({ file: f, progress: 0, key: Math.random().toString(36).slice(2) });
      }
      e.target.value = ''; // reset để có thể chọn lại cùng file
      renderFileList();
    });
    document.getElementById('ad-save').addEventListener('click', saveMilestone);
  }

  function renderFileList() {
    const list = document.getElementById('ad-file-list');
    if (!list) return;
    list.innerHTML = '';
    for (const item of pendingFiles) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const thumb = document.createElement('img');
      thumb.src = item.file.type.startsWith('image/')
        ? URL.createObjectURL(item.file)
        : defaultVideoThumb();
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = item.file.name;
      const prog = document.createElement('div');
      prog.className = 'progress';
      const fill = document.createElement('div');
      fill.style.width = item.progress + '%';
      prog.appendChild(fill);
      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        pendingFiles = pendingFiles.filter(p => p.key !== item.key);
        renderFileList();
      });
      row.append(thumb, name, prog, rm);
      list.appendChild(row);
    }
  }

  async function saveMilestone() {
    const btn = document.getElementById('ad-save');
    const emoji = document.getElementById('ad-emoji').value.trim() || '💕';
    const date = document.getElementById('ad-date').value;
    const title = document.getElementById('ad-title').value.trim();
    const description = document.getElementById('ad-desc').value.trim();

    if (!date) { showToast('Thiếu ngày', true); return; }
    if (!title) { showToast('Thiếu tiêu đề', true); return; }

    btn.disabled = true;
    try {
      const id = Date.now().toString();
      const media = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        const item = pendingFiles[i];
        btn.textContent = `Đang upload ${i + 1}/${pendingFiles.length}…`;
        const safe = slugifyFilename(item.file.name);
        const pathname = `milestones/${id}/${safe}`;
        const r = await uploadBlob(item.file, pathname, p => {
          item.progress = p; renderFileList();
        });
        media.push({ url: r.url, type: detectMediaType(item.file.type) });
      }
      btn.textContent = 'Đang lưu mốc…';
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: {
          'x-admin-password': getPass(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id, emoji, date, title, description, media }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Lỗi ${res.status}`);
      }
      await loadData();
      renderTimeline();
      showFirstRunBannerIfNeeded();
      showToast('Đã thêm mốc');
      renderAddTab(); // reset form
    } catch (err) {
      showToast(err.message || 'Lưu thất bại', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Lưu mốc';
    }
  }
```

- [ ] **Step 13.2: Verify**

Trên trình duyệt:
1. Mở admin → tab "Thêm mốc".
2. Chọn 1 ảnh + 1 video → cả 2 hiện trong file-list với thumbnail.
3. Điền emoji, ngày, tiêu đề, mô tả → click "Lưu mốc".
4. Quan sát: nút text đổi "Đang upload 1/2…", "Đang upload 2/2…", "Đang lưu mốc…", rồi toast "Đã thêm mốc".
5. Đóng drawer → timeline có mốc mới với cả 2 media.
6. Click ảnh trong gallery → lightbox mở. Click video → video play được.

- [ ] **Step 13.3: Commit**

```bash
git add index.html
git commit -m "feat(ui): admin tab \"Thêm mốc\" with multi-file upload + progress"
```

---

## Task 14: Frontend — Tab "Danh sách mốc" (xóa)

**Files:**
- Modify: `index.html`

- [ ] **Step 14.1: Thêm function `renderListTab()`**

```js
  function renderListTab() {
    if (state.milestones.length === 0) {
      drawerBody.innerHTML = '<p style="color:var(--muted);padding:20px 0;text-align:center">Chưa có mốc nào.</p>';
      return;
    }
    drawerBody.innerHTML = '';
    const sorted = [...state.milestones].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    for (const ms of sorted) {
      const row = document.createElement('div');
      row.className = 'ms-row';
      row.innerHTML = `
        <div class="ms-emoji">${escapeHtml(ms.emoji || '💕')}</div>
        <div class="ms-info">
          <div class="ms-title">${escapeHtml(ms.title || '')}</div>
          <div class="ms-meta">${escapeHtml(formatDateLong(ms.date))} · ${ms.media?.length || 0} ảnh/video</div>
        </div>
        <button class="btn btn-danger" data-id="${escapeHtml(ms.id)}">🗑</button>
      `;
      row.querySelector('button').addEventListener('click', () => deleteMilestone(ms.id, ms.title));
      drawerBody.appendChild(row);
    }
  }

  async function deleteMilestone(id, title) {
    if (!confirm(`Xóa mốc "${title}"? Hành động này không thể hoàn tác.`)) return;
    try {
      const res = await fetch(`/api/milestones?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': getPass() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Lỗi ${res.status}`);
      }
      await loadData();
      renderTimeline();
      renderListTab();
      showFirstRunBannerIfNeeded();
      showToast('Đã xóa mốc');
    } catch (err) {
      showToast(err.message || 'Xóa thất bại', true);
    }
  }
```

- [ ] **Step 14.2: Verify**

Trên trình duyệt:
1. Mở admin → tab "Danh sách".
2. Thấy mốc đã tạo ở Task 13.
3. Click 🗑 → confirm "OK" → toast "Đã xóa mốc".
4. Đóng drawer → timeline trống lại (hoặc chỉ còn mốc khác).
5. Mở lại admin → tab "Danh sách" → mốc đã biến mất.
6. Vercel dashboard → Storage → Blob → các file trong `milestones/<id>/` đã bị xóa.

- [ ] **Step 14.3: Commit**

```bash
git add index.html
git commit -m "feat(ui): admin tab \"Danh sách\" with delete"
```

---

## Task 15: Cleanup mock files cũ + final manual checklist

**Files:**
- Delete: `drive-mock/`

- [ ] **Step 15.1: Xóa folder drive-mock**

```bash
rm -rf drive-mock
git add -A
git commit -m "chore: remove drive-mock files (no longer needed)"
```

- [ ] **Step 15.2: Verify build production**

Run: `vercel build`
Expected: build thành công, không lỗi.

- [ ] **Step 15.3: Deploy preview**

Run: `vercel deploy`
Expected: trả về 1 URL `https://<project>-<hash>.vercel.app`. Mở URL đó.

- [ ] **Step 15.4: Manual checklist trên URL preview**

Đánh dấu khi pass:
- [ ] Trang load — hero hiện tên + avatar (data từ local dev đã sync? Nếu Blob production riêng thì preview rỗng → cần test bằng cách thêm config trên preview URL).
- [ ] Sai password → toast đỏ.
- [ ] Đúng password → drawer mở.
- [ ] Tab "Cặp đôi": đổi tên + upload avatar mới → reload → giữ.
- [ ] Tab "Thêm mốc": tạo mốc với 2 ảnh + 1 video → xuất hiện timeline.
- [ ] Click ảnh → lightbox full size. Click video → play.
- [ ] Tab "Danh sách": xóa mốc → biến mất khỏi timeline.
- [ ] Đóng tab, mở lại → cần nhập password lại để vào panel.
- [ ] `curl -X POST <preview>/api/milestones` (không header) → 401.
- [ ] Mobile (375px Chrome devtools): không tràn, drawer full-screen, lightbox vừa.

- [ ] **Step 15.5: Promote sang production**

Run: `vercel deploy --prod`
Expected: deploy lên domain Production.

- [ ] **Step 15.6: Final commit (nếu có sửa gì sau test)**

Nếu có fix → commit. Nếu không → bỏ qua.

---

## File Structure Tổng Kết (cuối plan)

```
save_the-dates/
├─ index.html                              ~1500 lines (UI + frontend logic)
├─ package.json
├─ package-lock.json
├─ .gitignore
├─ vercel.json
├─ api/
│   ├─ _lib.js                             helpers (auth, Blob CRUD)
│   ├─ data.js                             GET /api/data
│   ├─ auth.js                             POST /api/auth
│   ├─ blob-upload.js                      POST /api/blob-upload (handleUpload)
│   ├─ config.js                           POST /api/config
│   └─ milestones.js                       POST/DELETE /api/milestones
└─ docs/superpowers/
    ├─ specs/2026-04-27-vercel-blob-migration-design.md
    └─ plans/2026-04-27-vercel-blob-migration.md   ← FILE NÀY
```

---

## Self-Review Notes

- **Spec coverage:** Mỗi mục trong spec section 6 (API endpoints) → có 1 task code (Task 4-8). UI flow section 7 → Task 9-14. First-run section 8 → covered trong Task 11 + 12. Edge cases section 9 → handled trong sanitizeMilestone (validate date, type, url) + verifyPassword (timing-safe). Setup section 11 → Task 2 (manual).
- **Placeholder check:** Các verify command đều có expected output cụ thể. Code blocks đầy đủ. Không "TBD".
- **Type consistency:** `media` array shape `{url, type}` nhất quán giữa server (sanitizeMilestone in Task 8) và frontend (saveMilestone in Task 13). `id` luôn là string of digits. `clientPayload` = password (Task 12.2 và 12.3 cùng convention).
- **Decision điều chỉnh từ spec:** Spec section 5 nói pass đi qua `x-admin-password` header. Thực tế `@vercel/blob/client.upload()` không expose custom header → đổi sang `clientPayload`. Đã update trong Task 12.2. Endpoint khác (`/api/auth`, `/api/config`, `/api/milestones`) vẫn dùng header như spec.
