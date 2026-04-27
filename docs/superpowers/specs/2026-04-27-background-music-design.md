# Background music — design

## Goal

Phát nhạc nền cho landing page, bắt đầu ngay sau khi unlock lần đầu (gesture của hold-5s) và cho user toggle bật/tắt sau đó.

## Scope

- File nhạc cố định, đặt thủ công vào `assets/music.mp3` (admin tự thay file).
- Loop vô hạn, volume cố định 0.5.
- Toggle 🔊 / 🔇 ở góc trên-phải màn hình unlocked.
- Lưu preference (đã tắt / đang phát) vào localStorage.
- Không có backend, không Blob, không config server-side.

Out of scope: nhiều bài, playlist, slider volume, fade in/out, lyrics, upload nhạc qua admin UI.

## Behavior

| Trạng thái | Hành vi audio | Nút loa |
|---|---|---|
| Lock screen (chưa unlock) | im lặng (autoplay sẽ bị block) | ẩn |
| Đang giữ trái tim 5s | im lặng | ẩn |
| Vừa unlock xong (lần đầu) | `audio.play()` ngay (gesture vẫn còn hiệu lực) | hiện, icon 🔊 |
| Reload sau khi đã unlock, lần trước đang bật | thử `play()`; nếu reject → paused | hiện, icon đúng theo state |
| Reload sau khi đã unlock, lần trước đã tắt | KHÔNG thử play; giữ paused | hiện, icon 🔇 |
| User click nút loa | toggle play/pause + cập nhật localStorage | icon đổi |

## Implementation

Tất cả gói gọn trong `index.html` + 1 file static.

### HTML
- `<audio id="bg-music" src="/assets/music.mp3" loop preload="auto" hidden></audio>` cuối `<body>`.
- `<button class="music-toggle" aria-label="Bật/tắt nhạc" hidden>🔊</button>` fixed top-right.

### CSS
- `.music-toggle`: position fixed, top + right ~16px, circular, glassmorphism (match style hiện có), z-index dưới `.lock-screen` (z-index lock screen rất cao) nhưng trên content thường.
- `.music-toggle[hidden] { display: none; }` — đảm bảo `[hidden]` thắng `display:flex/grid` nếu có.

### JS
- Constants: `MUSIC_PREF_KEY = 'music_pref_v1'` ('on' | 'off').
- `setMusicIcon(playing)` đổi text giữa 🔊/🔇.
- `playMusic()`: gọi `audio.play()`, nếu Promise resolve → set icon 🔊 + lưu pref 'on'; nếu reject → set icon 🔇 + KHÔNG ghi pref (vì user không chọn tắt, chỉ browser block — lần sau click loa sẽ thử lại).
- `pauseMusic()`: `audio.pause()` + icon 🔇 + lưu 'off'.
- `toggleMusic()`: nếu đang paused → `playMusic()`, ngược lại `pauseMusic()`.
- Trong `completeHold()` (sau POST /api/unlock thành công, set `state.unlocked = true`): show `.music-toggle`, gọi `playMusic()` (gesture còn hiệu lực).
- Sau khi load /api/data ở init, nếu `state.unlocked === true`: show `.music-toggle`, đọc pref:
  - pref === 'off' → giữ paused, icon 🔇.
  - pref khác (null/'on') → thử `playMusic()`; reject thì icon 🔇 nhưng KHÔNG ghi pref 'off'.
- Bind click trên `.music-toggle` → `toggleMusic()`.

### File asset
- `assets/music.mp3` — admin tự bỏ vào (em sẽ làm placeholder hoặc bỏ qua nếu chưa có).

## Edge cases

- File `assets/music.mp3` không tồn tại → audio element error event; nút loa vẫn hiện nhưng click không phát được. OK, không cần xử lý đặc biệt; user chỉ cần upload file là chạy.
- Admin reset (DELETE /api/unlock): state.unlocked = false → ẩn nút loa + pause music.
- Nhiều tab cùng phát: không xử lý — mỗi tab độc lập, OK.

## Risks

Không có rủi ro lớn — feature nhỏ, isolated, không đụng backend hay state đã tồn tại.
