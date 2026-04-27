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
