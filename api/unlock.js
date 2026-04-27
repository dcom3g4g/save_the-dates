import {
  verifyPassword, readData, writeData,
  sendJson, handleError, HttpError,
} from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      // Mở khóa one-time, không cần auth (public unlock).
      const data = await readData();
      if (!data.unlocked) {
        data.unlocked = true;
        await writeData(data);
      }
      sendJson(res, 200, { ok: true, unlocked: true });
      return;
    }
    if (req.method === 'DELETE') {
      // Reset lock screen (admin only).
      verifyPassword(req);
      const data = await readData();
      data.unlocked = false;
      await writeData(data);
      sendJson(res, 200, { ok: true, unlocked: false });
      return;
    }
    throw new HttpError(405, 'Method not allowed');
  } catch (err) {
    handleError(res, err);
  }
}
