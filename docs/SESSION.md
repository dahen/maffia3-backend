# Återuppta arbetet här

Uppdaterad: 2026-10-23. Läs BESLUT.md för användarkrav och PLAN.md för idéer.
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
- Mobil spelarvy och de fyra GM-sidorna för bibliotek/mallar/spelare/start är implementerade.

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
- 17 beteendetester passerar efter fasstatus/Morgon-utbyggnaden. Täcker bland annat
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
4. Följ upp de fyra nya GM-sidorna och startflödet med användarens testning.

## Demokonton

GM / 2468. Fiktiva spelare Alex / 1101, Billie / 1102, Charlie / 1103 … Ziggy / 1125.
Dessa är lokala testuppgifter. Ingen slutlig driftpolicy/inloggning är fastställd.

## Viktiga kvarvarande begränsningar

Hela speltillståndet dupliceras per revision. Det är enkelt att återställa och
är verifierat för ett litet normalparti, men stor chattvolym bör på sikt få
separat lagring/mer delade snapshots. Läspositioner ligger separat från spelets
historik. Morgonvyns Genomgånget är lokal, tillfällig UI-markering.


## Mobiltest 2026-10-23

Beställt: testa spelarvyn från telefon på samma wifi. Implementerat i
frontendens PlayerApp: egna rollkort/vinstvillkor, flera förmågor, alla
valstyper, gruppval med utförare, kvittenser, morgonbesked/inkallning och
personlig GM-/gruppchatt med olästtal. SSE, återanslutning och återkomst till
synlig flik hämtar nya data. Utkast behålls mellan liveuppdateringar och
chattbyten; sparfel behåller text. Chatten använder getRandomValues-UUID
även över HTTP på LAN, där randomUUID annars kräver en säker kontext.

Backend `npm run start:lan` använder --lan, lyssnar på 0.0.0.0 och visar
IPv4-adresser. Vanlig start är fortsatt localhost. Egen preview är omstartad
med --lan, samma databas. HTTP via både loopback och wifi-adress verifierar
HTML, inloggning och spelarfiltrerat fyrgruppsparti (Alex, två powers/två rum).
Nytt HTTP-test täcker egna/andras handlingar, nattspärr, hemlig blockering,
GM-anteckningar, morgonpublicering, inkallning, chattmedlemskap och Origin.
17 tester samt backend-typkontroll passerar. Frontend bygger.
1000 UUID:n har kontrollerats för format/unikhet. Verklig telefonlayout och
wifi från separat enhet behöver användarens test; inga visuella resultat påstås.

Brandväggsregel: Maffia3-LocalWifi-3047, TCP 3047, Node, Private, LocalSubnet,
Wi-Fi och aktuell wifi-IP. Direkt skapande nekades av Windows (saknade admin,
inte Codex automatisk granskningsblockering). En dold RunAs-hjälpare i ignorerade
data/allow-local-wifi.ps1 öppnar UAC; resultat i data/wifi-firewall-result.txt.
Kontrollera resultat innan nätverksåtkomst anses färdig. Byts wifi-IP behöver
regeln uppdateras. Ingen internetpublicering eller routerändring.

## Återkoppling från telefon: oläst chatt

Användaren har nu testat spelarvyn från telefon och skickat skärmbilder.
Olästtal syntes för svagt både på Chatt-fliken från Min roll och på annan
chatt än den öppna. Användaren tyckte förstärkningen syntes tydligt men att rött/gult/grönt
skar sig. Olästa knappar använder nu temats ljusa accentbakgrund, tydlig
accentkant och större accentfärgad badge med vit text (1 nytt / N nya).
I djungeltemat blir det en sammanhållen grönskala; i klassiskt följer det
temats accent. På aktiv knapp är badge vit med accentfärgad text. Rumsknappar
har badge på egen rad så långa gruppnamn får plats. Aktiv flik behåller sin
gröna markering; badge skiljer oläst från aktiv. Ingen blinkning eller
ny panel. Tillgänglig status anger antal och vilka rum som har oläst.
Befintlig serverbaserad läsmarkering är oförändrad. Frontendbygget passerar.
Telefonens skärmbilder bekräftar fungerande LAN-åtkomst; eventuell historisk
UAC-status ovan ska inte tolkas som ett aktuellt anslutningshinder.

## Mobilchatt: senaste meddelandet först

Användaren upplever att senaste längst ner kräver för mycket skroll för att
hänga med. Spelarens chattar visar nu senaste meddelandet överst. Skrivfält
(två rader) och Skicka ligger före meddelandena, direkt efter chattvalet.
Ordningen anges med texten Senaste meddelandet först. Automatisk skroll till
botten är borttagen. Äldre historik läses nedåt. API-ordning och läsmarkering
använder fortfarande serverns kronologiska lista; bara renderingen vänds med
en kopia. GM:s befintliga chattlayout är oförändrad. Frontendbygget kontrolleras.


## Aktuellt: fyra GM-sidor och kontrollerad spelstart

Användaren förtydligade att mallar ska byggas från ett fristående bibliotek.
Ingen spara-roller-/spara-mall-funktion ska finnas i Spelöversikten. Den
felaktigt tolkade funktionen har tagits bort före commit/publicering.

Implementerat och igång på lokal server:

1. **Rollbibliotek** (SetupPortal/LibraryPage): CRUD för roller, powers,
   vinstvillkor och grupper. Kopplingar mellan roll/grupp/win/powers.
   power-typerna player-kill/player-other/Text/Yes-No/None, villkor,
   GM-besked, delat gruppval och gruppchatt konfigureras här.
2. **Partimallar**: namn, tema, spelarantal, exakt lika många rollplatser.
   Dubbletter av en rolldefinition tillåts för flera platser. Använda poster
   kan inte raderas utan att först ta bort kopplingarna.
3. **Spelare**: test-/skarpa listor. Fiktiva namn och slumpade sexsiffriga PIN
   genereras i test. Riktiga namngivna konton i skarpt, möjlighet att sätta
   PIN (4–12 siffror), ändra konton och återanvända dem mellan listor.
   PIN lagras enbart hashad, nygenererade koder returneras för visning en gång.
   PIN-byte återkallar tidigare sessioner. Att lägga till ett befintligt
   konto i en ny lista ändrar inte dess kod. GM kan inte läggas in som spelare.
4. **Starta parti**: välj mall/lista och namn. Både klient och server kräver
   samma antal roller/spelare. Förberedelsen får en egen snapshot av
   definitionerna och slumpad tilldelning, utan att något visas för spelare.
   GM kan slumpa om eller byta två spelares roller via dropdowns.
   Godkänn rollfördelning och starta Live är det enda nya startflödet.
   Om ett annat parti är Live krävs uttryckligt Ersätt-godkännande.
   Fördelningen använder revisionsnummer mot dubbla/stale GM-kommandon.
   Ändrad spelarlista blockerar godkännande; förbered igen för ny lista.

Nollställning: avpublicerar berört parti och återgår till ett privat utkast
med samma initiala fördelning. Omslumpning kan sedan göras. Nästa godkännande
skapar en ny spelinstans; det tidigare partiets ALLA revisioner, meddelanden,
anteckningar och dygn bevaras. Det gamla partiets automatik pausas.

Live-status: separat singleton-tabell i SQLite, högst ett markerat parti.
Testläge behåller bakåt/framåt även när testpartiet är Live för telefoner.
Spelarens API-lista ger bara Live-partiet om kontot deltar; direktåtkomst
till andra partiers data/chatt/SSE nekas på servern. Global katalog-SSE
(/api/events) ger direkt byte även från vänteläge; återanslutning/synlig flik
hämtar igen. Testhistorik kan aldrig återställa Live-markeringen.

API och data:
- src/setup.ts: GM-only /api/setup, bibliotek, partimallar, spelarlistor,
  konton och förberedelser. src/setup-seed.ts seedar fasta definitioner.
- SQLite library_groups/wins/powers/roles, library_role_powers,
  party_templates/party_template_roles, player_rosters/roster_players,
  game_preparations. Relationer/FK och transaktioner skyddar konsistensen.
- Definitioner kopieras när fördelningsutkastet skapas, så senare biblioteks-
  eller mallredigering inte ändrar det som GM redan granskar.
- Nya partier börjar i Möte, dygn 1, utan gamla handlingar, dödsfall,
  meddelanden eller anteckningar. Riktiga roster-konton används, inga
  hårdkodade demospelare i det nya startflödet.
- Frontend SetupPortal.tsx, fyra separata sidor via huvudmenyn. Spelöversikten
  behåller kompakt spelarbete; inga mallredigeringskontroller där.

Verifierat:
- 25 tester passerade i full körning. Ett efterföljande separat test för
  skarpt startflöde med namngivna konton passerade också (totalt 26 tester).
- Täcker CRUD/referenser, exakt antal, PIN-hashning/ändring/återanvändning,
  privata utkast, unik tilldelning, slumpning, manuellt byte, stale revision,
  godkännande/Live/SSE, rollkopiors isolering, omstart, nollställning och
  kvarvarande historik. HTTP-test går igenom hela nya flödet och behörigheter.
- Backend typkontrollerar och frontend bygger. Verklig localhost-HTTP:
  GM får 33 roller, 17 powers, 4 wins, 4 grupper, 3 partimallar (8/8/25).
  Alla tre gamla testpartier finns kvar. Ingen spelarlista/förberedelse
  har skapats automatiskt i användarens databas, inget är Live ännu.
- Lokala servern är omstartad med --lan. Inga gamla partier har ändrats till
  nya mallar eller fått nya deltagare. Telefon visar vänteläge tills GM
  godkänt ett förberett parti. Browser/visuell QA via användarens återkoppling.

Nästa test: öppna de nya sidorna efter omladdning, välj en färdig partimall,
generera en testlista med rätt antal, förbered och granska, godkänn. Testa
telefon med ett av de genererade kontona/PIN-koderna, inte automatiskt Alex.
Nice-to-have-import av ett HELT speltillstånd återstår. JSON-export finns.
