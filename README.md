# Maffia 3 – lokal GM-prototyp

Node.js ≥24.12, TypeScript, Express och Node:s inbyggda SQLite. Frontend:
React, Vite och Tailwind i systerrepot `../maffia3-frontend`.

## Starta

Kör i denna backendmapp:

```powershell
npm install
npm run seed
npm start
```

Öppna http://127.0.0.1:3047 om frontend är byggd (se nedan).
Demo: **GM / 2468**. Databasen finns i `data/maffia3.sqlite`.
Seed skapar bara demodata i en tom installation och raderar aldrig gamla partier.

Bygg frontend en gång före backendstart:

```powershell
cd '../maffia3-frontend'
npm install
npm run build
```

För frontendutveckling: kör `npm run dev` i frontendmappen, behåll backend på
3047 och öppna http://localhost:3046. För backendutveckling: `npm run dev`.

## Prova prototypen

1. Välj **Djungeln · Övningsparti** (8 spelare) eller 25-spelarpartiet.
   **Djungeln · 4 grupper, flera förmågor** har 8 spelare med 2–3 förmågor var,
   fyra vinstgrupper och tre separata gruppchattar. `npm run seed` lägger till
   det partiet även i en befintlig demodatabas, utan att ändra äldre partier.
2. Natt: simulera val i tabellen, eller **Fyll saknade val**.
3. Blockera en spelare med **B**. Inlämning ska fortfarande fungera.
4. Gryning: skriv besked i tabellen; Enter eller lämna fältet för att spara.
   Enter flyttar även fokus till nästa beskedsruta efter lyckad sparning.
5. Klicka spelarnamnet för anteckningar, dödsfall, dödsorsak och morgonledtråd.
6. **Morgon** i huvudmenyn öppnar GM:s läsunderlag med dödsfall och rollinfo.
7. Byt till morgonfasen manuellt och välj **Nytt dygn**. Tidigare dygn bevaras.
8. **Historik**: läs ett tidigare dygn, stega bakåt/framåt eller välj ett
   revisionssteg. Nya handlingar efter ett bakåtsteg bildar en ny gren.
9. **Logg**: sök i hela partiet och visa alternativa grenar vid behov.
10. **Chattar**: personlig GM-chatt och gruppchatt. I testparti kan du välja
    en simulerad spelare som avsändare. Använd två fönster för liveuppdatering.
11. **Broadcast**: manuella utskick till alla levande/ej klara eller starta
    nedräkning. Påminnelser vid 3 min, 1 min och 0, aldrig automatiskt fasbyte.
12. **Inkommande**: vid en player-kill visas **Bekräfta död**. GM bekräftar och
    utförare/förmåga/ursprungligt historiksteg sparas till logg och morgonvy.
    player-other används för andra spelarval, exempelvis skydd eller spaning.
13. **Möte → Registrera dagens utfall**: välj döda och orsak (Utröstning som
    standard) eller **Ingen dog under dagen**. Även detta följer med till morgon.
14. Skriv direkt i kolumnen **Anteckningar**, växla mellan **Bestående** och
    **Dygn N**, och dra i textrutans nederkant för att ändra höjden. Lämna
    rutan eller tryck Ctrl+Enter för att spara. Kort sammanfattning visas även
    under rollnamnet. Bestående text följer med nästa dygn; dygnstext börjar
    tom men finns kvar i historiken och vid bakåtsteg. Samma fält finns även
    i rollkortet via spelarnamnet.
    Tredje typen **Morgon** visas i GM:s morgonvy även för levande spelare,
    och är kopplad till aktuellt dygn.
15. Fasstatus under fasraden visar när allt är inskickat/sparat och ger en grön
    knapp till nästa fas. Vid saknade val/besked kan du visa återstående eller
    uttryckligen bekräfta ett undantag vid fasbyte. Undantaget loggas.

## Historik

Speltillstånd sparas som oföränderliga revisioner med föräldralänkar i SQLite.
Varje tillstånd innehåller alla sina dygn, handlingar, besked och meddelanden.
Ett rundbyte skapar ett nytt dygn och en revision; det raderar inga historiska
värden. Vid testnavigering ändras bara pekaren till aktiv revision.

JSON-exporten innehåller samtliga revisioner och grenar. Den är ett komplement
till databasens vanliga beständighet, inte ett krav för att behålla gamla dygn.
Läspositioner för chatt ligger separat. Testnavigering pausar automatiska
utskick; en ny uttrycklig nedräkningsstart återaktiverar dem.

Första modellen prioriterar enkel verifierbar historik för 25 spelare/10 dygn.
Varje revision duplicerar ett helt tillstånd. Vid stor chattvolym bör modellen
optimeras med separat meddelandelagring/mer delade snapshots; gränser och
framtidsplan finns i `docs/PLAN.md`.

## Verifiera

```powershell
npm run check
npm test
```

Tester omfattar hemlig blockering, powertyper, grupphandlingar, 25 spelare över
10 dygn, omstart, grenar, chatt/oläst/idempotens, behörigheter, timer/broadcast,
morgonunderlag och HTTP/SSE.

## Konfiguration

- `MAFFIA_DB_PATH`: annan SQLite-fil.
- `PORT`: standard 3047.
- `HOST`: standard 127.0.0.1. För LAN behöver servern bindas till lämplig adress.
- `COOKIE_SECURE=true`: för drift bakom HTTPS.

Detta är lokala testkonton och en spelprototyp. Portalen för mallar/tilldelning
återstår. Mobil spelarvy med nattval, besked och chatt är implementerad. Ingen extern drift eller publicering
är konfigurerad. Nästa session börjar i `docs/SESSION.md`.


## Telefon på samma wifi

Bygg frontend och kör `npm run start:lan` i backendmappen. Vanlig `npm start`
lyssnar fortsatt bara på datorn själv. LAN-start lyssnar på alla lokala IPv4-
anslutningar och skriver ut adresser; välj adressen för datorns wifi-adapter
(`ipconfig`), inte VMware/WSL. Telefonen öppnar `http://<wifi-IPv4>:3047`.
Ingen separat frontendserver eller CORS-konfiguration behövs.

Logga in som **Alex / 1101** och välj samma parti som GM. I fyrgruppspartiet
har Alex två förmågor och både personlig GM-chatt och gruppchatt. **Charlie /
1103** ger ett annat perspektiv. Spelarnas API filtrerar hemliga GM-data.
Besked publiceras först i Morgon; inkallade spelare hänvisas till GM.
Gruppchatt är läsbar men stängd för nya spelar-inlägg under Morgon, enligt V1.

Windows-brandväggen behöver tillåta Node, TCP 3047, från LocalSubnet på
privat wifi. Begränsa gärna regeln även till wifi-adaptern och dess IP.
Regeln kräver administratörsrättigheter. Byter datorn IP kan en IP-begränsad
regel behöva uppdateras. Datorn och serverprocessen måste vara igång.
Gästnät med klientisolering kan hindra kontakt mellan telefon och dator.
