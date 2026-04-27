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
