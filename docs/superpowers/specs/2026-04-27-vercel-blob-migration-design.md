# Counting Love — Migration sang Vercel Blob

**Ngày:** 2026-04-27
**Trạng thái:** Đã duyệt (chờ implementation plan)
**Phiên bản trước:** Đọc dữ liệu từ Google Drive public folder qua API key.
**Phiên bản này:** Tự host trên Vercel — ảnh + dữ liệu lưu trên Vercel Blob, có form upload bảo vệ bằng mật khẩu admin.

---

## 1. Mục tiêu

- Deploy site "Counting Love" lên Vercel.
- Lưu cả ảnh/video lẫn metadata (config + milestones) trên Vercel Blob — không phụ thuộc Google Drive nữa.
- Owner thêm/xóa mốc + sửa thông tin cặp đôi qua UI ngay trên trang chính, sau khi nhập đúng mật khẩu admin.
- Khách (không có mật khẩu) chỉ xem được trang, không upload/sửa được.

## 2. Out of scope (MVP)

- Multi-user / OAuth (chỉ 1 admin password chung).
- Sửa nội dung mốc (chỉ thêm + xóa — sai thì xóa rồi tạo lại).
- Rate-limit brute force mật khẩu.
- i18n (giữ tiếng Việt cứng).
- SSR / framework (Next.js, v.v.) — vẫn HTML đơn file + serverless functions.

## 3. Kiến trúc

### 3.1 File layout

```
save_the-dates/
├─ index.html              UI chính (sửa: gọi /api/* thay vì Drive)
├─ api/
│   ├─ data.js             GET   — trả về {config, milestones}
│   ├─ auth.js             POST  — verify mật khẩu
│   ├─ blob-upload.js      POST  — cấp token client-upload (handleUpload)
│   ├─ milestones.js       POST  — thêm mốc; DELETE — xóa mốc + media
│   └─ config.js           POST  — ghi đè config (tên/DOB/avatar/start_date)
├─ package.json            phụ thuộc: "@vercel/blob"
├─ vercel.json             (optional) cache headers cho /api/data
└─ .gitignore              node_modules, .vercel, .env*
```

### 3.2 Storage trên Vercel Blob

Một file metadata duy nhất + nhiều file media:

```
blob://
  ├─ data.json                        (config + milestones)
  ├─ avatars/<personKey>-<ts>.<ext>   (avatar)
  └─ milestones/<milestoneId>/<filename>   (ảnh/video mỗi mốc)
```

`data.json`:

```json
{
  "config": {
    "start_date": "2023-05-20",
    "person1_name": "Trần Văn Hải",
    "person1_dob": "1998-03-15",
    "person1_avatar_url": "https://<id>.public.blob.vercel-storage.com/avatars/p1-1714200000000.jpg",
    "person2_name": "Trần Thị Thùy Yên",
    "person2_dob": "2000-07-22",
    "person2_avatar_url": "https://<id>.public.blob.vercel-storage.com/avatars/p2-1714200000001.jpg"
  },
  "milestones": [
    {
      "id": "1714200123456",
      "emoji": "🌸",
      "date": "2023-03-15",
      "title": "Lần đầu gặp gỡ",
      "description": "...",
      "media": [
        { "url": "https://<id>.public.blob.vercel-storage.com/milestones/1714200123456/img1.jpg", "type": "image" },
        { "url": "https://<id>.public.blob.vercel-storage.com/milestones/1714200123456/vid1.mp4", "type": "video" }
      ]
    }
  ]
}
```

Khác bản Drive:
- Bỏ `mediaFileIds` → thay bằng `media: [{url, type}]` (URL trực tiếp, không cần resolve qua API).
- `type` xác định ngay khi upload từ MIME type của file → không cần cache mimeMap runtime.
- ID milestone = `Date.now().toString()` — đủ unique cho 1 admin.

### 3.3 Env vars (Vercel Project Settings)

| Tên | Bắt buộc | Nguồn | Mô tả |
|---|---|---|---|
| `ADMIN_PASSWORD` | có | user đặt | Mật khẩu admin để mở giao diện upload. |
| `BLOB_READ_WRITE_TOKEN` | có | Vercel auto khi connect Blob store | Token `@vercel/blob` dùng để put/del. |

## 4. Auth model

- Stateless, không session, không JWT.
- Sau khi user nhập đúng mật khẩu, frontend lưu password vào `sessionStorage` (mất khi đóng tab) — không lưu localStorage để tránh persist.
- Mọi API write/delete (POST/DELETE) gửi `x-admin-password: <password>` header.
- Server so sánh constant-time với `process.env.ADMIN_PASSWORD`. Sai → 401. Thiếu env → 500 với message rõ ràng.
- Không có "logout" thật — chỉ có nút "Đóng" xóa `sessionStorage` rồi đóng panel.
- Truyền plaintext qua HTTPS chấp nhận được vì:
  - Vercel ép HTTPS mặc định.
  - Site cá nhân, threat model thấp.
  - Đơn giản hơn token pattern (không có refresh, không có expiry).

## 5. Luồng upload (client-upload pattern)

Vercel serverless functions có body limit ~4.5 MB → video sẽ vượt. Dùng `@vercel/blob/client.handleUpload` để client PUT trực tiếp lên Blob:

```
[1] Client: POST /api/blob-upload
    body: { type: 'blob.generate-client-token',
            payload: { pathname, callbackUrl, ... } }
    header: x-admin-password
       │
       ▼
[2] Server: handleUpload({
      request, body,
      onBeforeGenerateToken: async (pathname) => {
        verifyPassword(req);  // throws nếu sai
        return { allowedContentTypes: ['image/*', 'video/*'],
                 maximumSizeInBytes: 100 * 1024 * 1024 };
      },
      onUploadCompleted: async ({ blob }) => { /* no-op */ },
    });
    → trả token tạm thời cho file đó.
       │
       ▼
[3] Client (qua @vercel/blob/client.upload): PUT thẳng lên Blob.
       │
       ▼
[4] Trả về { url, pathname, contentType }.
       │
       ▼
[5] Client gom array URLs → POST /api/milestones (hoặc /api/config)
    để commit metadata vào data.json.
```

`pathname` được client tự sinh có namespace để tránh va chạm:
- Avatar: `avatars/p1-<ts>.<ext>` hoặc `avatars/p2-<ts>.<ext>`.
- Media mốc: `milestones/<milestoneId>/<slugifiedFilename>` — `milestoneId` được client sinh trước khi upload (dùng `Date.now()`), reuse khi POST milestone. Client slugify filename (lowercase, thay space + ký tự đặc biệt bằng `-`, giữ phần extension) để tránh URL kỳ cục với tên file tiếng Việt có dấu / khoảng trắng.

## 6. API endpoints

| Method | Path | Auth | Body | Trả về |
|---|---|---|---|---|
| GET | `/api/data` | không | — | `{ config, milestones }`. Nếu data.json chưa tồn tại trên Blob → trả `{ config: {}, milestones: [] }`. |
| POST | `/api/auth` | header | — | 200 nếu khớp, 401 nếu sai. Dùng để check trước khi mở panel. (Password lấy từ header `x-admin-password`, không cần body.) |
| POST | `/api/blob-upload` | header | (vercel/blob handleUpload payload) | token client-upload. |
| POST | `/api/milestones` | header | `{ id, emoji, date, title, description, media }` | mốc đã được append → trả `{ ok: true, milestone }`. `id` do client sinh (`Date.now().toString()`), server trust nguyên xi (không validate format). |
| DELETE | `/api/milestones?id=<id>` | header | — | `{ ok: true }`. Server xóa mốc khỏi data.json + xóa toàn bộ blob trong `milestones/<id>/`. |
| POST | `/api/config` | header | `{ start_date?, person1_name?, person1_dob?, person1_avatar_url?, person2_*? }` | `{ ok: true, config }`. Merge với config hiện tại (không ghi đè field thiếu). |

Helper function chung cho tất cả file (đặt trong `api/_lib.js` hoặc inline):
- `verifyPassword(req)` — throw 401 nếu sai.
- `readData()` — `head()` để check file tồn tại; nếu có thì `fetch(url).then(r => r.json())`; nếu không trả default empty.
- `writeData(data)` — `put('data.json', JSON.stringify(data), { contentType: 'application/json', access: 'public', addRandomSuffix: false })` để giữ nguyên path.

## 7. UI design (`index.html`)

### 7.1 Trang chính (đã render)

Giữ nguyên layout cũ: hero (couple cards + heart + countdown) → timeline → quote → footer. Chỉ thay nguồn dữ liệu (gọi `/api/data` thay Drive API).

Thêm **1 nút floating "✏️"** ở góc phải dưới (`position: fixed; bottom: 24px; right: 24px;`) — luôn hiển thị, không phụ thuộc auth.

### 7.2 Modal mật khẩu

Click ✏️ → modal nhỏ giữa màn hình:

```
┌──────────────────────────────┐
│  Nhập mật khẩu admin         │
│  ┌────────────────────────┐  │
│  │ ●●●●●●                 │  │
│  └────────────────────────┘  │
│  [Đóng]          [Mở khóa]   │
└──────────────────────────────┘
```

- Sai mật khẩu → toast đỏ "Sai mật khẩu" + clear input.
- Đúng → lưu vào `sessionStorage.admin_pw` → đóng modal → mở panel admin.
- Nếu `sessionStorage.admin_pw` đã có sẵn (cùng tab) → click ✏️ mở thẳng panel, bỏ qua modal.

### 7.3 Panel admin (drawer)

Full-screen trên mobile (<720px), side drawer 460px trên desktop.

3 tab:

**Tab "Cặp đôi":**
- 2 column: mỗi column 1 person.
  - Avatar preview + nút "Đổi avatar" (input file).
  - Input tên.
  - Input DOB (date picker).
- Input "Ngày bắt đầu yêu" (date picker).
- Nút **[Lưu]** → upload avatar mới (nếu có) → POST `/api/config`.

**Tab "Thêm mốc":**
- Input emoji (text — ký tự đầu là emoji được).
- Date picker.
- Input title.
- Textarea description (4 dòng).
- Drop zone / file picker — multi-file, accept image/* + video/*.
- Mỗi file selected hiển thị: thumbnail + tên + thanh tiến trình + nút ✕ remove.
- Nút **[Lưu mốc]** → upload tuần tự từng file (cập nhật progress) → POST `/api/milestones` → reset form + reload data.

**Tab "Danh sách mốc":**
- List card (compact) mỗi mốc: emoji, ngày, title, số lượng media, nút **[🗑]**.
- Click 🗑 → confirm dialog → DELETE `/api/milestones?id=<id>` → reload.

Footer panel: nút "Đăng xuất" (xóa `sessionStorage`) + "Đóng".

## 8. Lifecycle / first run

1. User deploy lần đầu — `data.json` chưa tồn tại trên Blob.
2. Truy cập trang → `GET /api/data` trả `{ config: {}, milestones: [] }`.
3. Hero hiện avatar default + tên `—` + counter `0`. Empty state cho timeline.
4. Banner nhỏ (chỉ khi config rỗng): "Chưa có dữ liệu — click ✏️ ở góc dưới để thiết lập".
5. User click ✏️ → nhập password → tab "Cặp đôi" → điền + upload avatar → Lưu.
6. Sau Lưu lần đầu, `data.json` được tạo trên Blob.
7. User chuyển tab "Thêm mốc" → tạo các mốc lần lượt.

## 9. Edge cases & error handling

| Trường hợp | Hành vi |
|---|---|
| Sai mật khẩu | 401, frontend toast + clear input. |
| Quên `ADMIN_PASSWORD` env | Mọi write API trả 500 + message: "Server chưa cấu hình ADMIN_PASSWORD". |
| Quên `BLOB_READ_WRITE_TOKEN` env | `/api/data` GET vẫn chạy nhưng trả empty (không có blob); mọi write trả 500. |
| Upload file > 100 MB | `handleUpload` reject (cấu hình `maximumSizeInBytes`). Frontend toast. |
| Upload file sai content-type | `handleUpload` reject (cấu hình `allowedContentTypes`). Frontend toast. |
| Mất mạng giữa upload nhiều file | File đã upload xong giữ nguyên, file đang dở mất. User retry phần lỗi. Mốc chỉ commit khi user bấm [Lưu mốc] sau cùng. |
| User đóng tab giữa upload | Blob đã PUT thành công còn lại trên storage nhưng không có entry trong `data.json` → orphan. Chấp nhận → dọn tay khi cần (không build cleanup job ở MVP). |
| 2 tab cùng save | Race condition lý thuyết: tab nào ghi sau thắng. Hiếm với 1 admin → chấp nhận. |
| Xóa mốc | Xóa entry khỏi `data.json` + `del()` toàn bộ blob trong prefix `milestones/<id>/`. Nếu xóa blob thất bại nhưng entry đã xóa → log lỗi server, vẫn coi như thành công (rác blob có thể dọn tay sau). |
| `data.json` corrupt (parse fail) | `/api/data` trả 500 + frontend hiện error screen. User phải sửa Blob bằng tay. (Hiếm vì chỉ admin ghi.) |
| `sessionStorage` mất giữa chừng (vd reload) | Frontend coi như chưa login, click ✏️ lại mở modal pass. |

## 10. Bảo mật

- HTTPS bắt buộc (Vercel mặc định).
- Password so sánh bằng `crypto.timingSafeEqual` để tránh timing attack (dù site nhỏ).
- Không log password ra console hay error message.
- `handleUpload` chỉ gen token sau khi verifyPassword pass → khách không thể upload bypass.
- File upload bị giới hạn content-type và size để tránh lạm dụng.
- Content trên Blob là `access: 'public'` (cố ý — link share được). Nếu sau này muốn private cần đổi sang `access: 'private'` + signed URL.

## 11. Setup deployment (user làm 1 lần)

1. Push code lên GitHub.
2. Vercel dashboard → New Project → import repo.
3. Storage tab → Create Blob store → Connect to project → tự động set `BLOB_READ_WRITE_TOKEN`.
4. Settings → Environment Variables → add `ADMIN_PASSWORD = <pass>` cho cả Production/Preview/Development.
5. Deploy.
6. Mở URL Vercel → click ✏️ → nhập pass → tab "Cặp đôi" → điền + upload avatar → Lưu → tab "Thêm mốc" → tạo các mốc.

## 12. Testing (manual checklist trước khi gọi xong)

- [ ] Deploy lần đầu, data.json chưa tồn tại → trang vẫn render được với empty state.
- [ ] Sai password → toast "Sai mật khẩu", panel không mở.
- [ ] Đúng password → panel mở, 3 tab hoạt động.
- [ ] Upload avatar mới → preview cập nhật, refresh trang vẫn còn.
- [ ] Tạo mốc mới với 2 ảnh + 1 video → xuất hiện trong timeline, click thumb → lightbox hoạt động (ảnh hiện full, video play được).
- [ ] Xóa mốc → biến mất khỏi timeline, blob của mốc bị xóa khỏi storage.
- [ ] Reload trang sau khi đóng tab → cần nhập password lại để mở panel.
- [ ] Gửi request `POST /api/milestones` không header → 401.
- [ ] Mobile (375px): hero không tràn, panel admin full-screen, lightbox vừa.
- [ ] Upload file > 100 MB → reject với message.

## 13. Rollback / migration

- Drive version cũ giữ trong git history (commit `a798bca` + sau). Nếu Vercel version sai có thể `git revert` hoặc checkout commit cũ.
- Folder `drive-mock/` (config.txt + milestones.json mock) có thể xóa sau khi migration ổn — không cần thiết nữa.

## 14. Nhánh phụ trong tương lai (không làm trong scope này)

- Sửa mốc (chứ không chỉ xóa-tạo lại).
- Drag-reorder timeline manual (hiện sort theo date).
- Multi-user OAuth.
- Lưu thumbnail riêng để load nhanh hơn.
- Export sang PDF / sticker.
