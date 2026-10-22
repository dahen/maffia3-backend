# Återuppta arbetet här

Uppdaterad: 2026-10-22. Läs BESLUT.md för användarkrav och PLAN.md för idéer.
FORSTUDIE.md i reporoten beskriver granskningen av V1/V2.

## Aktuell produkt och återkoppling

Användaren testkör den första GM-prototypen och är nöjd med grundriktningen.
Nuvarande arbete är justeringar efter verklig återkoppling, inte en omstart.

Senaste beställningar är implementerade i källkod:

- Inkommande ligger direkt efter Spelare / roll.
- Ett separat exempelparti har fyra grupper och 2–3 förmågor per spelare.
- Förmåga, val och GM-besked ligger på samma tabellrad; identitet/status och
  inkommande använder gemensamma celler över rollens förmågor.
- Gruppmarkering och legend bygger på partiets grupper, inte två hårdkodade.
- Spelarvalstypen är nu player-kill eller player-other. Äldre snapshots läses
  kompatibelt utan att skrivas om: Name blir player-other, den kända äldre
  demoförmågan Nattens jakt blir player-kill.
- GM kan bekräfta ett dödsfall från en inkommande player-kill. Dödsorsaken
  bevarar utförare, förmåga och revisionen med det ursprungliga valet.
- Möte har Dagens utfall: flera dödsfall med orsak (förvalt Utröstning) eller
  uttryckligen Ingen dog. Sparas till hela partiets logg och morgonunderlag.
- Enter i ett GM-besked sparar och flyttar fokus till nästa tillgängliga ruta
  i tabellordning, inklusive flera förmågor. Vid sparfel behålls text/fokus.
- I gryningen markeras förväntade men osparade GM-besked direkt i fältet:
  ljus bärnstensbakgrund, tydlig kant och "Saknas – skriv besked…". Markeringen
  bygger på sparat innehåll och försvinner efter lyckad sparning. Klar/Väntar
  finns kvar. Historiska dygn, döda roller och ej behövda besked markeras inte.
- Natt/gryning har fasstatus med exakt antal saknade val/besked, Visa återstående
  och grön knapp vidare när allt är klart. Fasbyte med utestående arbete ger
  serverkontrollerad bekräftelse med spelare/förmågor. Bekräftelsetoken gäller
  aktuell lista och mål-fas; gamla listor eller hopp Natt→Morgon kan inte
  oavsiktligt kringgå kraven. Uttryckliga undantag loggas.
- Tredje rollanteckningstypen Morgon är tillagd i tabell och rollkort. Den är
  dygnskopplad och visas i GM:s morgonvy även för levande spelare. Döda får
  anteckningen i sitt befintliga kort, övriga under Övriga morgonanteckningar.
- Rollens anteckningar är nu uppdelade i bestående och dygnsvisa. Båda syns
  kort under rollnamnet. En egen Anteckningar-kolumn har nu direktredigering
  i höjdjusterbar textarea och växel Bestående/Dygn N. Redigering finns även
  i rolldetaljerna. Spara vid blur eller Ctrl+Enter; vanlig Enter ger ny rad.
  Båda editorerna hålls monterade vid växling för att behålla osparade utkast.
  Sparfel skickas vidare till fältet, så ett misslyckat försök inte visas som
  sparat. Nya dygn får tom dygnstext; äldre text finns kvar i historiken.

## Fungerande prototyp

- Node/TypeScript/Express och inbyggd SQLite med oföränderliga revisioner.
- Kompakt GM-tabell, simulering, faser, GM-svar, villkor, blockering och inkallning.
- Historiska dygn, bakåt/framåt och alternativa grenar för testpartier.
- Personlig GM-chatt, gruppchatt, olästindikering och SSE utan omladdning.
- Simulerade spelarchattavsändare i testpartier.
- Manuella broadcasts och servernedräkning med påminnelser. Fasbyte görs bara av GM.
- Sökbar/filterbar loggsida för hela partiet, inklusive alternativa testgrenar.
- Separat mobil GM-morgonvy: nattens dödsfall, dagens dödsfall före natten,
  ledtrådar, dödsorsak, utförare och full rollinfo. Aldrig tillgänglig för spelare.
- Djungel/Klassiskt färgtema per parti.
- Spelarnas mobilvy och förberedelse-/mallportalen återstår avsiktligt.

## Lokal körning

- Adress: http://127.0.0.1:3047. Användaren har själv öppnat och testat appen.
- Port 3045 gav timeout i denna Windowsmiljö, 3047 fungerar och är nu standard.
- Backend serverar frontendens byggda dist direkt. Ingen extern hosting/deploy.
- Node 26.12.1 finns lokalt. Projekten kräver Node >=24.12.
- Frontendutveckling: port 3046 med /api-proxy till 3047.
- Starta backend: npm start. Utveckling med omstart: npm run dev.
- Bygg frontend: npm run build i ../maffia3-frontend, ladda sedan om webbsidan.
- Dold bakgrundsserver: egen processidentitet finns i data/preview.pid och
  loggar i data/preview.log och data/preview-error.log. Kontrollera exakt process
  och kommandorad före eventuell omstart. Stoppa inga andra Node-processer.
- Databas data/maffia3.sqlite ignoreras av Git. Ändringar i befintliga partier
  ska bevaras. npm run seed lägger till det nya fyrgruppsexemplet idempotent.
- Båda reporna versionshanteras på main med beskrivande commits. Backend har
  en grundcommit för appen, en separat testcommit och dokumentation för fortsatt
  arbete. Frontend har app- och dokumentationscommits. Gör fortsättningsvis
  löpande commits av fungerande delsteg, enligt användarens uttryckliga önskemål.
- GitHub-remotes: https://github.com/dahen/maffia3-backend.git och
  https://github.com/dahen/maffia3-frontend.git. Användaren har beställt push
  av båda reporna. Bekräfta synk med git status och remote-HEAD vid push.
- Sites-skillens installerare hade ett Windows-sökvägsfel; npm install fungerade.

## Senast verifierat

- Backend npm run check: passerar.
- 16 beteendetester passerar efter fasstatus/Morgon-utbyggnaden. Täcker bland annat
  gruppisolering, flera förmågor, exakt dödsorsak, dagsutfall, legacy-snapshots,
  hemlig blockering, 25 deltagare/10 dygn, beständighet/grenar, chatt,
  broadcasts/timer och riktig HTTP/SSE samt GM-behörighet.
- HTTP-testet verifierar dessutom 409 med återstående lista vid fasbyte,
  normalt byte efter full inlämning och uttryckligt bekräftat undantag.
- Frontend bygger, inklusive Enter-navigering och de två rollanteckningsfälten.
- Senaste frontendbygget omfattar också Morgon, fasstatus och bekräftelsedialog.
- Senaste ändringen med direktredigerbar Anteckningar-kolumn bygger också
  utan TypeScript-fel. Endast frontend ändrades; ingen serveromstart krävs.
- Den egna bakgrundsservern är omstartad på port 3047 med senaste backend.
- Verkliga HTTP-anrop mot preview verifierar hälsosida, inloggning, HTML och
  fyrgruppspartiet: 8 spelare med 2,2,3,2,3,2,2,2 förmågor, nya power-typer
  och de nya anteckningsfälten. Befintliga testpartier och sessioner finns kvar.
- Visuell automation kunde inte verifieras: inbyggda webbläsarverktyget
  blockerade inspektion via URL-policy. Försök inte kringgå den policyn.
- Användaren har däremot själv sett och testat gränssnittet i appens webbläsare.

## Nästa steg

1. Fortsätt med användarens återkoppling från prototypen på port 3047.
2. Inga beställda ändringar i den senaste omgången återstår.
3. Visuell kontroll av Enter-fokus, täthet och mobillayout görs via användarens
   återkoppling tills tillåten browserinspektion finns.
4. Ta spelarens mobilvy och mallportalen när användaren vill gå vidare.

## Demokonton

GM / 2468. Fiktiva spelare Alex / 1101, Billie / 1102, Charlie / 1103 … Ziggy / 1125.
Dessa är lokala testuppgifter. Ingen slutlig driftpolicy/inloggning är fastställd.

## Viktiga kvarvarande begränsningar

Hela speltillståndet dupliceras per revision. Det är enkelt att återställa och
är verifierat för ett litet normalparti, men stor chattvolym bör på sikt få
separat lagring/mer delade snapshots. Läspositioner ligger separat från spelets
historik. Morgonvyns Genomgånget är lokal, tillfällig UI-markering.
