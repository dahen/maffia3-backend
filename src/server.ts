import { Store } from './db.ts';
import { createApp } from './app.ts';
import { networkInterfaces } from 'node:os';
const store = new Store();
const port = Number(process.env.PORT || 3047);
const app = createApp(store);
const timer = setInterval(() => { try { app.locals.tick(); } catch(e) { console.error('Nedräkningen kunde inte uppdateras:',e); } },1000);
const host = process.env.HOST || (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(port, host, () => {
  console.log(`Maffia backend: http://127.0.0.1:${port}`);
  if (host === '0.0.0.0') for (const addresses of Object.values(networkInterfaces())) for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`Lokal nätverksadress: http://${address.address}:${port}`);
  }
});
function shutdown() { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); server.closeAllConnections(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
