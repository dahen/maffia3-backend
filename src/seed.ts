import { Store } from './db.ts';
import { seedDemo, seedRichDemo } from './demo.ts';
const store = new Store(); seedDemo(store); seedRichDemo(store); store.close(); console.log('Demodata klar, inklusive 4 grupper och flera förmågor. GM: 2468. Befintliga partier lämnas orörda.');
