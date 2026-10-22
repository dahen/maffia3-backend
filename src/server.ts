import { Store } from './db.ts';
import { createApp } from './app.ts';
const store = new Store();
const port = Number(process.env.PORT || 3047);
const app = createApp(store);
const timer = setInterval(() => { try { app.locals.tick(); } catch(e) { console.error('Nedräkningen kunde inte uppdateras:',e); } },1000);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Maffia backend: http://127.0.0.1:${port}`));
function shutdown() { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); server.closeAllConnections(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
