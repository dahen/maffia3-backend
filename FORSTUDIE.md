# Version 3 – förstudie

Datum: 2026-10-22. Underlag: lokal källkod i version 1 och 2.
Detta är en kodgranskning, inte en verifiering av apparna i drift.
Version 3:s frontend- och backendrepository innehöll enbart .git vid granskningen.

## Utgångspunkt

Återskapa version 1:s spelnytta och samlade arbetsyta i Node.js med SQLite
och ett moderniserat, kompakt gränssnitt. Version 1 är funktionell referens.
Version 2 är en källa till utvalda förbättringar, inte en färdig kravspecifikation.
Förslagen nedan är arbetsriktning, inte användarbekräftade detaljbeslut.

## Version 1: det som behöver bevaras

- Angular 14 i Cangro, Express/Mongoose/MongoDB i nodesis.
- Fyra faser: 0 möte, 1 natt/inlämning, 2 GM bearbetar, 3 morgon/besked.
- GM styr resultat manuellt. Någon generell automatisk regelmotor finns inte.
- GM-tabellen samlar status, vinstgrupp, porträtt, roll, spelare,
  riktade handlingar, inskickade handlingar, GM-svar och anteckningar.
- Översikt över handlingar grupperade efter mål samt summering av Ja/Nej.
- Inkallning, blockering, villkorad aktivering av powers, döda/levande,
  globala och rollspecifika GM-anteckningar.
- Separata definitioner för personer, roller, powers och vinstvillkor.
- Powers med Text, Name, Yes/No och None. None kan ändå kräva GM-besked.
- Grupphandlingar delar val och håller reda på vem som utför handlingen.
- Spelarvy med rollbeskrivning, vinstvillkor, powers och chattar.
- GM-besked visas i morgonfasen; inkallning kan ersätta det synliga beskedet.
- Personlig GM-chatt och gemensamma rum med medlemskap kopplat till roller.
- Spelarchattar stängs för skrivning på morgonen; GM-chatt förblir öppen.
- GM kan se spelarperspektivet, skicka massmeddelanden och påminna ej klara.
- Nedräkning under natt, rollslumpning, import, porträtt/kamera och namnlista.

## Version 1: konkreta problem i koden

1. ChatUpdateService skickar JSON-ping men den granskade chatservern har
   ingen motsvarande message/pong-hantering. Heartbeat kontrollerar därmed
   inte att servern faktiskt svarar.
2. Websocket-klientens manualClose återställs inte i connect. Efter en manuell
   disconnect kan en ny anslutning därför sakna automatisk återanslutning.
3. ChatroomViewComponent lägger HTTP-svaret från postChatMessage i
   meddelandelistan. Servern returnerar en kvittens, inte meddelandeobjektet.
4. Fel från reload i switchMap avslutar prenumerationen på chattnotiser;
   error-callbacken loggar men återupprättar inte prenumerationen.
5. Notisen innehåller seq men ChatUpdateService skickar bara chatId vidare.
   Sekvensen används alltså inte där för att upptäcka missade notiser.
6. GET /chatrooms/:id kräver inloggning men saknar kontroll av rumsmedlemskap.
7. updateMyPower använder klientens uppgifter om roll/power/grupphandling.
   Kontrollen ska i version 3 göras mot serverns egna relationer.
8. Actions/svar skrivs över på rollen. Rundhistorik bygger på externa exporter,
   med hårdkodad serversökväg, och separat rensning av aktuella värden.

Detta är identifierade felkällor. Exakt vilka som orsakade användarens
tidigare driftproblem är ännu inte reproducerat.

## Version 2: användbart att ta med

- TypeScript och React/Vite som moderniseringsunderlag.
- Separation mellan återanvändbara roll-/power-/vinstmallar och spelinstanser.
- Scenarioformat med färdiga definitioner i maffia-2025h och maffia-2027v.
- Setup med spelplatser, rollantal, presets och slumpad tilldelning.
- PIN-inloggning, sessionscookie, serverkontroller för flera spelaroperationer.
- Meddelanden som egna rader med sekvens per rum och sparad läsposition.
- Händelselogg, snapshots, export och återställning.
- Nattimulering och tester av bland annat auth, scenarioimport och runtime.

Version 2 är mer implementerad än dess äldre feature-completeness-dokument
anger. Den har både spelarvy, GM-vy, skrivoperationer och chatt via HTTP.
Den granskade frontendkoden använder polling; någon SSE-implementation
återfanns inte i serverns ingångsfil.

## Version 2: sådant som inte bör följa med oförändrat

- GM-navigering med separata paneler för inbox, status, mål och vald roll
  fragmenterar samma information som version 1 samlar i tabellen.
- Frontendens main.tsx innehåller omkring 2 000 rader med nästan hela appen.
- Backendens index.ts blandar routing, sessioner, kompatibilitet och migrering.
- sql.js-lagret läser in hela databasfilen vid varje operation och exporterar
  hela filen vid skrivning. V3 bör använda en vanlig SQLite-anslutning,
  parametriserade frågor och transaktioner.
- submitPlayerAction uppdaterar grupphandlingar efter power_template_id utan
  avgränsning till spel. Grupphandlingar måste avgränsas till rätt spel/grupp.
- advanceRound ökar rundan och sparar snapshot men nollställer inte aktuella
  actions/svar. clearRoundData är en separat operation som tömmer dessa värden.
  V3 bör skapa ny runddata och behålla tidigare rundors data direkt sökbara.
- Malländringar kan påverka pågående spel genom direkta joins. Spelinstansens
  rolltexter och definitioner bör ha en tydlig policy för ändring under spel.

## Viktig regelskillnad att reda ut

V1 visar blocked som GM-markering men updateMyPower stoppar inte inlämning
för en blockerad roll. V2 stoppar inlämningen på servern. Det påverkar både
spelregler och om spelaren kan förstå att den blivit blockerad.

## Föreslagen utformning för V3

- Node.js + TypeScript i den befintliga backendmappen.
- React + TypeScript + Vite + Tailwind i den befintliga frontendmappen.
  Exakta biblioteksversioner verifieras när implementationen startar.
- Vanlig SQLite-fil med anslutning som lever i serverprocessen, foreign keys,
  transaktioner och schemaändringar via migreringar.
- Korta, tydliga moduler för auth, setup, spel, rundor, handlingar och chatt.
- Kompakt GM-tabell med redigering direkt i raden, tydlig sparstatus,
  fast tabellhuvud och kort fasrad. Sök/filter kompletterar hela översikten.
- Chatt ska kunna öppnas utan att man tappar sin plats i GM-tabellen.
  Oläst och hanterat är separata begrepp.
- Spelarvy som fungerar på telefon med roll, aktuella val/besked och chatt.
- Servern filtrerar bort hemlig GM-information och ännu ej publicerade svar.
- Skicka chatt via HTTP och föreslagsvis ta emot uppdateringar via SSE.
  Spara först, meddela efter commit, hämta ikapp från beständig sekvens efter
  avbrott, undvik dubbletter vid omsändning och visa anslutningsstatus.
- Nya rundor ska inte kräva att GM manuellt raderar föregående natt.
- GM fortsätter avgöra effekter och resultat manuellt.

## Första körbara leverans

1. Gemensamt typat kontrakt, SQLite-migrering och reproducerbar demodata.
2. En sammanhängande väg: login → GM-tabell/spelarvy → natthandling →
   GM-svar → morgon → ny runda med bevarad historik.
3. Personlig GM-chatt och gruppchatt med återanslutning och olästindikering.
4. Testpartier med litet deltagarantal och ett med 25 deltagare. Testfallen
   ska omfatta grupphandling, villkorad power, None, Ja/Nej och bortkoppling.
5. Därefter fullständig setup/redigering/import och övriga V1-funktioner.

Demodata ska vara fiktiva och ligga avskilt från riktiga partier. Scenarierna
i V2 innehåller även historiska personnamn, anteckningar och statusprover;
de ska inte okritiskt bli startdata i ett nytt parti.

## Kontroll inför speltest

- Två spelare ändrar samma grupphandling samtidigt.
- Meddelande sparas men nätet bryts innan klienten får kvittens.
- Telefonen låses, återkommer och hämtar missade händelser.
- Servern startas om under ett parti.
- GM skriver ett osparat svar samtidigt som liveuppdateringar kommer.
- Spelare försöker läsa annat rum, GM-anteckningar eller opublicerade svar.
- Ny runda visar tomma aktuella val och bevarar föregående natt.
- 25 deltagare kan överblickas och hanteras utan ständig växling av panel.

Inga gamla projekt har ändrats och inga paket installerats i denna förstudie.
