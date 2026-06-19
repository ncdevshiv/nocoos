// Find a free TCP port starting from a baseline.
// Strategy: bind to port 0 (let OS assign), read back the assigned port, release.
import net from 'node:net';

export async function findFreePort(start = 3000, end = 3010) {
  for (let port = start; port <= end; port++) {
    const free = await tryListen(port);
    if (free) return port;
  }
  // OS-assign fallback
  return await tryListen(0);
}

function tryListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(null));
    server.once('listening', () => {
      const assigned = server.address();
      server.close(() => {
        if (assigned && typeof assigned === 'object') resolve(assigned.port);
        else resolve(port);
      });
    });
    try { server.listen(port, '0.0.0.0'); }
    catch { resolve(null); }
  });
}

export async function isPortFree(port) {
  return (await tryListen(port)) === port;
}

export default { findFreePort, isPortFree };
