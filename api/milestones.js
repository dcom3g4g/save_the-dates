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
