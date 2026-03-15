// Backend URL — always routes through the Next.js proxy (/api/backend/* → Railway)
// This avoids CORS entirely: the browser only ever talks to the same Vercel origin.
// next.config.js rewrites handle the actual routing to Railway (prod) or localhost (dev).
export const BACKEND = "/api/backend";
