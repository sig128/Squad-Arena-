// Live stream to every open page (Server-Sent Events). One connection per page; events are small JSON lines.
const clients = new Set();
let seq = 0;
export function attach(req, res, origin) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive",
    "access-control-allow-origin": origin || "*", "x-accel-buffering": "no"
  });
  res.write(`retry: 3000\n\n`);
  const c = { res, at: Date.now() }; clients.add(c);
  const ping = setInterval(() => { try { res.write(`: ping\n\n`); } catch (_) {} }, 20000);
  req.on("close", () => { clearInterval(ping); clients.delete(c); });
}
export function emit(event, data) {
  if (!clients.size) return;
  const line = `id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.res.write(line); } catch (_) { clients.delete(c); } }
}
export const online = () => clients.size;
