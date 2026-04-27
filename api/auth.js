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
