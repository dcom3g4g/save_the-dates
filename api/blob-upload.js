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
      onUploadCompleted: async () => {},
    });

    sendJson(res, 200, jsonResponse);
  } catch (err) {
    handleError(res, err);
  }
}
