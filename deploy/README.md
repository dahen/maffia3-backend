# GM-styrda uppdateringar på mini

Detta är installationsunderlag, inte en redan utförd deploy. Befintligt parti,
data och Docker-volym ska bevaras. Ingen seed körs vid installation/uppdatering.

## Delarna

- `.github/workflows/release.yml` bygger en gemensam image för ARM64 och AMD64,
  kör backendtester och bygger frontend. Startas manuellt i backend-repots
  Actions med en ny version (`vX.Y.Z`) och frontendens exakta 40-teckens SHA.
  Backend är den commit som workflowet körs från. Kör normalt från main.
- Imagen publiceras i `ghcr.io/dahen/maffia3-backend`. En GitHub-release med
  `maffia-release.json` publiceras först när bygget har lyckats. Manifestet
  innehåller version, båda commits och image-DIGEST; rörliga image-taggar
  används inte för installation. Ingen deploy sker när en release publiceras.
- Webbappen har GM-sidan Uppdateringar och GM-only `/api/admin/updates`.
  Den visar lokal versionsinfo och proxyar bara status/start till hosten.
  Webbläsaren får inga uppdateringsnycklar, Docker-rättigheter eller sökvägar.
- `src/updates/host.ts` är en separat Node-process på mini med Docker-åtkomst.
  Den får endast uppdatera Compose-projekt `maffia3`, tjänst `app`, container
  `maffia3` med volym `maffia3_maffia3_data` på `/data`. Den kontrollerar
  befintlig container, DB-sökväg, image-labels och hälsa. Inga shell-kommandon,
  image-URL:er, containernamn eller Git-referenser accepteras från appen.

## Installation: engångsarbete på mini

1. Läs befintliga deployfiler. Behåll projekt/tjänst/container/volymnamn och
   portbindningen `192.168.1.249:3047`. Skriv inte över lokal Compose eller
   Dockerfile blint med exempel här. Kontrollera att arbetskopiorna är rena.
2. Hostprocessen kräver Node >=24.12 och backendens installerade beroenden
   (`npm ci --omit=dev` i backend-repot). Använd en separat stabil checkout
   för hostprocessen om appens källkod annars uppdateras manuellt. Hostprocessen
   uppdaterar INTE sig själv när appimagen byts.
3. Skapa en privat katalog under `~/Library/Application Support/MaffiaUpdater`
   med rättighet 0700. Skapa `token` med minst 32 kryptografiskt slumpade bytes
   (t.ex. hex) och rättighet 0600. Skriv aldrig nyckeln i chatt, Git eller loggar.
   Samma värde ska finnas i webbcontainerns `MAFFIA_UPDATER_TOKEN`, via den
   befintliga Compose-installationens privata `.env`/miljökonfiguration.
4. Kopiera och anpassa `host-config.example.json` till `config.json` i den
   privata katalogen. Verifiera absoluta sökvägar till Docker, Composefil,
   backupkatalog och token. Sökvägar med kommatecken stöds inte i Docker-mounts.
   Backup/state ligger på hosten, inte i appens datavolym eller byggkontext.
5. Om repot är privat: lägg en separat GitHub-nyckel med läsbehörighet till
   backend-releaser i en privat fil och ange `githubTokenFile` i hostkonfig.
   Logga också in värdens Docker mot GHCR med paketläsbehörighet om paketet
   är privat. Nycklarna ska bara vara på hosten. Vid privat frontend-repo
   behöver Actions-secret `MAFFIA_SOURCE_TOKEN` kunna läsa frontendens innehåll.
   Befintliga repos/paket behöver inte göras publika.
6. Prova hostprocessen i terminal med `MAFFIA_UPDATER_CONFIG` satt till den
   absoluta config-sökvägen och `node /ABSOLUT/BACKEND/src/updates/host.ts`.
   Koppla sedan in LaunchAgent enligt plist-exemplet, med verifierad Node/PATH.
   LaunchAgent startar vid användarinloggning, INTE före inloggning efter omboot.
   Verifiera även Docker Desktops uppstart. Detta är inte en LaunchDaemon.
7. Lägg till miljövariablerna i `compose-updater.example.yaml` i befintlig
   app-tjänst. `host.docker.internal:3048` ska nå hostprocessen från just
   appcontainern. Börja med loopback-bindning. Om Docker Desktop-versionen
   kräver annan bindning: använd minsta nåbara interface och begränsa via
   brandvägg till containertrafiken. Publicera inte port 3048 på NAS/proxy.
   Testa autentisering utan att skriva ut token; inga CORS-tillstånd behövs.
8. Första installationen måste göras manuellt: publicera en första release
   enligt nedan, hämta imagen och ändra Compose app.image till dess digest.
   Behåll datavolym/portar/healthcheck/miljö och ta backup före första bytet.
   Kör Compose med `up -d --no-build --pull never app`. Den gamla appen har
   ännu ingen uppdateringssida och kan därför inte installera sig själv.
9. Efter första installationen: kontrollera GM-sidan, befintliga partier,
   foton, chatt och incheckningar. Publicera därefter en andra testrelease för
   ett riktigt end-to-end-test av knappen. Verifiera backup/återställning på
   en separat testvolym innan funktionen används under riktiga partier.

## Publicera en release

Push av källkod räcker inte för att skapa en installerbar version. Öppna
backend-repot → Actions → Build Maffia release → Run workflow:

- version: en ny, ej tidigare använd stabil version, t.ex. `v0.2.0`;
- frontend_sha: aktuell färdig frontend-commit (40 tecken).

Workflowet bygger och testar och skapar sedan release + manifest. En release
som misslyckas halvvägs kan ligga kvar som draft; kontrollera felet och skapa
en ny version. Ersätt aldrig en redan publicerad release/tagg med ny kod.
GitHub kan behöva tillåta Actions contents-write/packages-write. Paketet kan
behållas privat om mini redan har rätt registry-inloggning. Workflowet gör
ingen SSH, ändrar inga repos på mini och startar ingen live-uppdatering.

## Uppdateringsförlopp

1. Appen kontrollerar status ungefär en gång per minut; aktiva jobb var tredje
   sekund. Ingen kontroll sker för spelare. GM kan också kontrollera status.
2. GM väljer Uppdatera och bekräftar avbrottet. Host validerar releasen på nytt
   mot GitHub. Ett request-ID ger idempotent omsändning; bara ett jobb körs åt
   gången. Status sparas atomiskt på disk utanför appcontainern.
3. Imagen hämtas medan gamla appen fortsätter köra. Avbruten hämtning påverkar
   inte partiet. Image-labels ska motsvara versionen och båda commits.
4. Appen stoppas. Hela datavolymen arkiveras till en unik tar-fil på hosten,
   inklusive eventuell WAL/SHM och foton i SQLite. Arkivet kontrolleras genom
   tar-listning och att databasfilen finns. Ingen vanlig kopiering av endast
   en körande SQLite-fil används.
5. En lokal image-override skapas i statekatalogen. Compose återskapar enbart
   `app` med befintlig konfiguration och samma datavolym; ingen lokal rebuild.
   Hälsokontrollen måste bli healthy inom 120 sekunder. Därefter visas Klart.
6. Ladda om webbsidan för att få den nya frontendkoden. Backendens version
   kommer från imagen. Uppdateringsfel visas på GM-sidan när appen är nåbar.

Kör INTE senare `docker compose up --build` mot den gamla lokala imagen av
misstag. Använd samma basefil plus sparad `image-override.json` för manuell
Compose-hantering av den senast installerade imagen. Basefilen behålls för
inställningar; overridefilen väljer den installerade releasen.

## Fel och återställning

- Före containerstopp: den gamla appen fortsätter köra.
- Backup/förberedelsefel före containerbyte: den gamla containern startas igen.
- Fel under/efter bytet: nya containern stoppas och jobbet blir
  `recovery-required`. Ingen automatisk återläsning eller start av gammal kod
  mot en potentiellt migrerad databas. Detta kan lämna sajten nere tills en
  operatör återställer på mini. GM kan då inte läsa status genom den stoppade
  webbappen; status finns i hostens `state/job.json`.
- Hostprocessen avbryts under ett jobb: samma återställningsspärr gäller vid
  nästa start. Den försöker inte gissa om ett halvfärdigt jobb ska fortsätta.

`state/job.json` innehåller föregående lokala image-ID (`previousImage`),
backupens exakta sökväg (`backup`), release och fas. Ingen gammal image eller
backup rensas av tjänsten. Dokumentet är privat och får inte klistras in med
eventuella framtida personuppgifter. Själva backupen innehåller alla konton,
sessionsdata, foton och chattar och ska skyddas som originaldatabasen.

Återställningsrutin för operatör (måste övas på testvolym):

1. Stoppa hostens LaunchAgent så att inget jobb kan starta samtidigt. Kontrollera
   exakt containeridentitet och stoppa appcontainern. Spara även den misslyckade
   versionens datavolym i ett nytt arkiv; återläs inte över den.
2. Skapa en NY namngiven Docker-volym för återställningen. Återläs den sparade
   backupen dit med tar i en tillfällig container, monterad utan nätverk. Läs
   aldrig in arkivet i en osäker/beräknad värdsökväg och radera ingen gammal volym.
3. Kör SQLite `PRAGMA quick_check` i den återställda volymen och kontrollera
   resultatet utan att skriva ut spelardata. Använd föregående image-ID och en
   separat Compose-override för att starta appen med just den återställda
   volymen. Undvik att låta senaste kod migrera den före kontrollen.
4. Verifiera healthy och parti/foton/chatt i appen. Arkivera hostens job.json
   (flytta, inte radera backup) när operatören bedömt läget som återställt.
   Starta sedan hosttjänsten. Byt tillbaka till rätt originalvolymnamn endast
   genom ett separat kontrollerat underhåll; hostens normala uppdateringsflöde
   kräver originalnamnet och ska annars avvisa fortsatt uppdatering.

Ingen automatisk backuprotation ingår. Följ upp diskutrymme och spara även
backup utanför mini. Docker Desktop/LaunchAgent efter omboot, nätåtkomst,
GHCR-inloggning och verklig återställning behöver verifieras på värden.

## Kontrollerat här / kvar att verifiera

Backendtester täcker behörigheter, CSRF, fast releasekontrakt, dubbla jobb,
image-/volymkontroll, backupordning, fel före/efter byte, beständig status och
avbruten hostprocess. Docker-kommandona testas mot en simulerad runner.
Frontend typkontrolleras och produktionsbyggs. Ingen riktig Docker-daemon
är igång i utvecklingsmiljön; ingen image har byggts/publicerats och ingen
installation eller omstart av den publika sajten har utförts här.

Officiell referens: https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
och https://docs.docker.com/reference/cli/docker/compose/up/
