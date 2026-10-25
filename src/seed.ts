import { Store } from './db.ts';
import { seedDemo, seedRichDemo } from './demo.ts';
import { seedLibrary } from './setup-seed.ts';
const store = new Store(); seedDemo(store); seedRichDemo(store); seedLibrary(store); store.close(); console.log('Demodata, rollbibliotek och partimallar klara. GM: 2468. Befintliga partier lämnas orörda.');
