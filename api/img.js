// Coin logos through our own domain: some image hosts refuse to be shown on other sites (Cross-Origin-Resource-Policy),
// and IPFS gateways are slow. Cached at Vercel's edge for a week.
// GET /api/img?u=<https image URL>
module.exports = async (req, res) => {
  let u;
  try { u = new URL(String((req.query && req.query.u) || "")); } catch (_) { res.status(400).end(); return; }
  if (u.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname) || u.hostname.endsWith(".internal")) { res.status(400).end(); return; }
  try {
    const cid = (u.pathname.match(/^\/ipfs\/([A-Za-z0-9]{40,}.*)$/) || [])[1];
    if (cid) u = new URL("https://ipfs.filebase.io/ipfs/" + cid);                                  // the fast gateway, whatever the coin's metadata named
    const r = await fetch(u.href, { headers: { accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !/^image\//i.test(type) || /svg/i.test(type)) { res.setHeader("cache-control", "public, s-maxage=600"); res.status(404).end(); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2e6) { res.status(413).end(); return; }
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=604800, immutable");
    res.setHeader("cross-origin-resource-policy", "cross-origin");
    res.status(200).send(buf);
  } catch (_) { res.setHeader("cache-control", "no-store"); res.status(504).end(); }
};
