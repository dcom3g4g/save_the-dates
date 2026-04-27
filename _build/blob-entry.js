// Re-export only what the frontend needs from @vercel/blob/client.
// Bundled into /assets/blob-client.js so we do not depend on esm.sh
// (esm.sh dynamic imports were hanging on iOS Chrome).
export { upload } from '@vercel/blob/client';
