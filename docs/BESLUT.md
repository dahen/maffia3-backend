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

## Mobiltest på wifi

- Användaren vill nu testa mobil spelarvy på egen telefon på samma wifi.
- Lokal LAN-körning beställd; ingen extern publicering.
- Återkoppling från telefon: olästa meddelanden ska synas tydligt både från
  Min roll och när spelaren har en annan chatt öppen.

- Olästmarkeringarna ska behålla tydligheten men följa temats färgskala.
  Användaren ogillar kombinationen rött, gult och grönt i chatten.
- Mobilchatten ska vara lätt att följa utan att behöva skrolla ner genom
  historiken för att se senaste meddelandet.

## Ett Live-parti och återanvändbara rolluppsättningar

- Spelarens telefon ska sakna partiväljare och automatiskt visa Live-partiet.
- Endast ett pågående parti får vara markerat Live.
- MUST HAVE: GM väljer/laddar olika rolluppsättningar som passar faktiskt antal spelare.
- NICE TO HAVE: flera samtidiga testpartier som GM kan växla mellan.
- Live-markeringen styr vilket parti spelarna ser. Testläge behåller sin
  bakåt-/framåtfunktion även när testpartiet visas för telefonerna.


## Förtydligande: fyra GM-sidor (ersätter tidigare tolkning av mallflödet)

Ingen funktion för att spara roller/mallar från Spelöversikten. MUST HAVE:

1. **Rollbibliotek:** översikt över databasens roller, powers, wins och övriga
   definitioner, CRUD på allt samt koppling av roller till vinstvillkor,
   förmågor och grupper.
2. **Partimallar:** ange spelarantal, välj exakt lika många roller och spara.
3. **Spelare:** testläge genererar X fiktiva namn och slumpade PIN-koder.
   Skarpt läge använder namngivna riktiga konton, med möjlighet att sätta PIN.
4. **Starta parti:** välj mall och spelarlista, kontrollera samma antal roller
   och spelare. Slumpa fördelningen, låt GM granska och flytta roller manuellt.
   Partiet blir Live först när GM godkänner rollfördelningen. Stöd för att
   nollställa/börja om och för omslumpning.

NICE TO HAVE: spara/läsa in hela speltillstånd från Spelöversikten för tester.
Det är inte ett sätt att skapa rolldefinitioner eller partimallar. Befintlig
JSON-export finns; återinläsning är ännu inte implementerad.
- Spelare ska enkelt kunna skicka chatt från mobil: Enter skickar som i GM,
  Shift+Enter ger ny rad och en lättåtkomlig Skicka-knapp finns vid skrivfältet.


## Inloggning och verifierad mobilchatt

- Spelarnas namnfält ska vara en dropdown med spelarnas namn. GM får separat
  inloggningsadress, implementerad som /gm. Listan avser det Live-markerade
  partiet och innehåller även döda spelare.
- Användaren bekräftar att Android kan skicka chatt från tangentbordet.
- Ny rad med Shift+Enter fungerar på Windows men inte på provad Android.
  Begränsningen accepteras; lägg inte till en GUI-knapp för ny rad.

## Synlig nedräkning

- Broadcast som personligt GM-chattmeddelande är testat och godkänt.
- Nedräkningen ska visas högst upp hela tiden i spelarvyn, t.ex. röd sista minuten.
- Ta bort nedräkningens automatiska chattutskick efter att den nya visningen
  fungerar och användaren har provat den. Behåll utskicken tills dess.


## Foto och fristående incheckning

- Återskapa nyttan från V1:s Camera: deltagarna tar egna foton och checkar in.
- Incheckning måste fungera direkt vid ankomst, utan valt/förberett/startat
  parti. Ankomstlistan är fristående från mallar och rollfördelning.
- GM kan checka in manuellt, även utan foto. Alla aktiva som ska spela måste
  vara incheckade innan GM får starta spelet.
- Föranmälda som inte dyker upp ska enkelt kunna avaktiveras av GM. Namn och
  foto sparas, återaktivering möjlig. Mallval och rollantal använder de aktiva.
- Foto visas vid vald måltavla för att säkerställa identitet.
- Spelarna får en flik med alla levande deltagare och foton, utan rollinfo.
- GM får miniatyrer vid varje spelaridentitet i Spelöversikten.

## Bekräftad nedräkning och snabb åtkomst

- Spelarvyns nedräkning är testad och godkänd.
- Räknaren ska vara grön när alla spelarens nattval är inskickade. Annars
  orange, och röd sista minuten. Status framgår också i text.
- Texten efter tidsgränsen ska vara GM avslutar snart natten.
- Start/stopp/tid kvar ska nås direkt i GM-vyn, utan Broadcast-drawern.
- Automatiska chattpåminnelser tas nu bort enligt tidigare stegplan.
  Manuella broadcasts fungerar och behålls. Endast GM byter fas.


## Kamerastationen är primärt en gemensam iPad (V1-flödet)

- En delad iPad ska kunna stå öppen på Camera. GM öppnar/loggar in en gång.
- Deltagaren trycker på sitt eget namn/fotokort, tar foto och godkänner det.
  Ingen deltagare behöver logga in med egen PIN eller använda sin mobil före spelstart.
- Kameratavlan visar tydligt vilka som är incheckade och vilka som återstår.
- Detta är huvudflödet för incheckning. Personlig foto-/incheckningssida kan
  finnas som alternativ, men får inte vara ett krav för ankomsten.
- Kamerastationen är nu användartestad och fungerar. Ta bort extra Ta om foto
  och separat Välj bild/bilduppladdning; behåll ett enkelt fotografera/godkänn-flöde.
- Ingen Checka in utan foto-knapp på camera-sidan. Manuell GM-incheckning
  ligger kvar under Spelare.
