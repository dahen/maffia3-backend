# Bekräftade krav och beslut

Uppdaterad: 2026-10-22. Dessa krav kommer direkt från användaren.

## Produkt och prioritering

- V3 ska återskapa V1:s spelnytta i Node.js, modern frontend och SQLite.
- V1: ../../1 nodesis + cangro maffia. V2: ../../2 hermes maffia.
- V3: två befintliga separata repositories, backend och frontend.
- V2 har användbar utveckling men dess stora paneler förstör överblicken.
- **Omedelbar prioritet: själva GM-vyn och möjlighet att simulera spelarnas val.**
- Setup-portalen är ett senare steg, inte ett villkor för första speltestet.

## Spelregler och information

- Blockerade spelare får lämna handlingar precis som vanligt.
- Spelarna ska inte veta att de är blockerade. V1:s beteende är rätt; V2:s
  spärr mot inlämning ska inte kopieras.
- Normalt upp till cirka 25 deltagare och 7–10 speldygn.
- Nytt dygn får inte radera gammalt. Spelets tillstånd ska omfatta alla dygn.
- Ett helt parti ska kunna återskapas/återberättas från sparad historik.
- I testpartier ska det gå att stega bakåt och framåt.

## Gränssnitt

- GM sitter främst vid dator och ska få plats med allt viktigt på normal skärm.
- Ingen sidledsskroll och så lite höjdskroll som möjligt.
- GM använder ibland mobil, men den upplevelsen behöver inte vara perfekt.
- Spelarna använder **bara mobil**.
- Kod och upplägg ska kunna återanvändas i framtida partier.
- Det ska vara enkelt att växla tema. Första aktuella tema: djungel och djur.
- Färgschema som passar temat med godtagbar kontrast.

## Framtida förberedelseportal

1. GM skapar och redigerar roller, powers och andra definitioner.
2. GM laborerar med rollkombinationer för olika antal spelare.
3. Kombinationer sparas som förberedda mallar.
4. När deltagarna kommer väljer GM mall efter faktiskt spelarantal.
5. Slumpa tilldelningen av roller till närvarande personer och starta partiet.

## Kontinuitet

Användaren har uttryckligen bett att idéer och beslut sparas strukturerat så
att arbetet kan fortsätta om sessionen går förlorad. Dokumenten ska hållas
versionshanterade och aktuella. Färdigt/planerat/testat ska skiljas tydligt.
Användaren har bett om löpande commits med rimliga meddelanden och uttryckligen
beställt push av båda V3-repositories till GitHub. Lokala partier/loggar och
installerade paket ska inte versionshanteras.

## Kompletteringar under första bygget

- Chatten ska uppdateras automatiskt för både GM och spelare, utan omladdning.
- Alla spelare ska ha en individuell GM-chatt. GM ska kunna agera snabbt på
  nya meddelanden och även följa spelarnas gruppchattar.
- Manuella broadcasts och automatiska påminnelser när natten tar slut.
- **Alla fasbyten måste utföras av GM.** Timer/automatik får aldrig byta fas.
- Bygg från början en separat överskådlig loggsida för hela partiet, användbar
  vid test, morgonförberedelser och återberättande efter avslutat parti.
- En separat mobilanpassad morgonvy för GM. Den ska främst hjälpa GM att
  berätta vem som dog under natten, ge ledtrådar till den dödas roll och till
  den som hängdes före nattfasen.
- Morgonvyn visas **inte** för spelarna. Den får innehålla fullständig rollinfo
  så GM själv kan välja vad som ska sägas. Tidigare tolkning att morgonvyn
  skulle visa privata GM-besked per spelare är ersatt av detta beslut.
- Hängningen sker precis före nattfasen. I den aktuella modellen kopplas både
  hängning före natten och nattens dödsfall till samma dygns morgonunderlag.

## Första layoutåterkoppling

- Flytta kolumnen för riktade handlingar direkt till höger om Spelare / roll.
- Kolumnen ska heta **Inkommande**.
- Visa exempel där varje spelare har flera förmågor och det finns fler än två
  grupper, så GM kan bedöma överblicken i ett mer representativt parti.

## Dödsorsaker och effektiv gryning

- Dela spelarvalstypen i **player-kill** och **player-other**. Text, None och
  Ja/Nej finns kvar. En spelarvals-förmåga är inte automatiskt dödande.
- Vid inkommande player-kill ska GM enkelt kunna bekräfta dödsfallet av just
  den orsaken. Koppla dödsfallet till förmåga och utförare i logg och morgonvy.
- I Möte ska GM kunna registrera en eller flera som dött under dagen och hur.
  Förvald orsak: **Utröstning**. Alternativ: uttryckligen markera **Ingen dog**.
- Inga handlingar får automatiskt döda spelare; det är ett GM-beslut.
- I gryningen ska **Enter spara GM-besked och flytta fokus vidare till nästa
  beskedsruta**. Flytta inte fokus om sparningen misslyckas.
- Tabellen läses i ordning över förmågor/roller, så att även flera förmågor på
  samma roll kan hanteras utan musklick (implementationens val).
- I gryningen ska tomma rutor där GM förväntas ge besked synas tydligt i själva
  beskedskolumnen. Klar/Väntar till vänster är fortsatt bra, särskilt på natten.
- Visa tydligt när det är klart att byta fas: alla nattval inskickade eller
  alla förväntade GM-besked sparade. Om något återstår ska ett oavsiktligt
  fasbyte hindras. Implementerat med serverkontrollerad bekräftelse som listar
  saknade val/besked; GM får uttryckligen gå vidare ändå och det loggas.

## Anteckningar per roll

- GM ska kunna notera exempelvis tillstånd (smutsig) eller föremål och antal.
- De flesta anteckningar är bestående över flera dygn.
- Det ska också finnas anteckningar som enkelt töms när nästa dygn börjar,
  men visas igen vid bakåtsteg i testhistoriken.
- Implementerat som två hemliga fält: **Bestående anteckningar** på rollen
  och **Anteckningar för dygn N** i respektive dygn. Dygnsfältet börjar tomt
  nästa dygn; tidigare värden bevaras. GM kan även tömma det aktuella fältet.
- GM ska kunna skriva direkt i en egen anteckningskolumn i tabellen, som i
  V1, med storleksändringsbar textarea. Att öppna rollkortet ska inte krävas.
- Behåll den lilla sammanfattningen av anteckningarna under rollnamnet.
- Kolumnen växlar mellan Bestående och Dygn N, så båda fälten kan redigeras
  utan att ta höjd för två textrutor samtidigt. Höjden kan dras ut; bredden
  håller sig inom kolumnen för att undvika sidledsskroll.
- Lägg till en tredje typ **Morgon** per roll. Texten visas i GM:s morgonvy,
  även för levande spelare. Den är dygnskopplad, börjar tom nästa dygn och
  finns kvar vid läsning av tidigare dygn och vid bakåt/framåt.
