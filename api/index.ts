import type { VercelRequest, VercelResponse } from '@vercel/node';

let appPromise: Promise<any> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = import('../src/app').then(m => m.default).catch(err => {
      console.error('[Vercel] Failed to load app:', err);
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const app = await getApp();
    app(req, res);
  } catch (err: any) {
    console.error('[Vercel] Handler error:', err?.message ?? err);
    res.status(500).json({
      error: 'Server initialization failed',
      detail: err?.message ?? String(err),
    });
  }
}
