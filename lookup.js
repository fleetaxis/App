// api/lookup.js
//
// FleetAxis FMCSA Carrier Lookup
// ================================
// GET /api/lookup?usdot=2589042
//
// Returns combined carrier data: identity + BASIC scores + cargo + authority.
// The FMCSA webkey lives in process.env.FMCSA_WEBKEY (set in Vercel dashboard).

const FMCSA_BASE = 'https://mobile.fmcsa.dot.gov/qc/services';

async function fmcsaFetch(path) {
  const webKey = process.env.FMCSA_WEBKEY;
  if (!webKey) {
    throw new Error('FMCSA_WEBKEY not set in environment variables');
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FMCSA_BASE}${path}${sep}webKey=${encodeURIComponent(webKey)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`FMCSA returned ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  // CORS headers - allow our frontend to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { usdot } = req.query;
  if (!usdot) {
    return res.status(400).json({ error: 'Provide ?usdot=NUMBER' });
  }

  // Strip non-digits
  const dot = String(usdot).replace(/\D/g, '');
  if (!dot) {
    return res.status(400).json({ error: 'Invalid USDOT number' });
  }

  try {
    // Fetch the four key data sets in parallel for speed
    const [identity, basics, cargo, authority] = await Promise.all([
      fmcsaFetch(`/carriers/${dot}`),
      fmcsaFetch(`/carriers/${dot}/basics`).catch(() => null),
      fmcsaFetch(`/carriers/${dot}/cargo-carried`).catch(() => null),
      fmcsaFetch(`/carriers/${dot}/authority`).catch(() => null),
    ]);

    if (!identity) {
      return res.status(404).json({ error: 'Carrier not found', usdot: dot });
    }

    // Cache responses for 5 minutes (reduces FMCSA API hits)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      dotNumber: dot,
      identity,
      basics,
      cargo,
      authority,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Lookup error:', err);
    return res.status(500).json({ error: 'Lookup failed', message: err.message });
  }
}
