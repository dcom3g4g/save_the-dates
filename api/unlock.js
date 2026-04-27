import {
  verifyPassword, readData, writeData,
  sendJson, handleError, HttpError,
} from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      // Mở khóa, không cần auth. Luôn refresh unlocked_at = now để counter
      // bắt đầu lại từ 0 mỗi lần qua flow lock screen.
      const data = await readData();
      data.unlocked = true;
      data.unlocked_at = new Date().toISOString();
      await writeData(data);
      sendJson(res, 200, { ok: true, unlocked: true, unlocked_at: data.unlocked_at });
      return;
    }
    if (req.method === 'DELETE') {
      // Reset lock screen (admin only).
      verifyPassword(req);
      const data = await readData();
      data.unlocked = false;
      data.unlocked_at = null;
      await writeData(data);
      sendJson(res, 200, { ok: true, unlocked: false });
      return;
    }
    throw new HttpError(405, 'Method not allowed');
  } catch (err) {
    handleError(res, err);
  }
}
