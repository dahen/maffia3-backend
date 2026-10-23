# Arbetsplan och idébank

Läs BESLUT.md för användarbekräftade krav. Detta dokument innehåller även
förslag som inte ska behandlas som nya krav från användaren.

## Nu: spelbar GM-prototyp

- Tät tabell: spelare/roll, vinstgrupp, powers, val, inkommande handlingar,
  GM-svar, anteckningar, klar/väntar, blockering och inkallning.
- Kort fasrad: Möte → Natt → Gryning → Morgon → Nytt dygn.
- Samma tabell genom faserna; inga automatiska hopp mellan stora arbetsytor.
- Simulera en spelares val via vanliga inlämningsregler; testknapp för saknade
  handlingar. Blockerade spelare ska också kunna simuleras.
- Testpartier med 8 och 25 fiktiva deltagare, djurroller och grupphandlingar.
- Läsa tidigare dygn utan att byta det aktiva dygnet.
- Bakåt/framåt i testparti, välj sparat steg och behåll alternativa grenar.
- JSON-export av hela partiets revisionshistorik som komplement till SQLite.
- Personlig GM-chatt och gruppchatt med synlig olästindikering.
- Temaväxling Djungel/Klassiskt utan ändring av spellogiken.
- Exempel med 4 grupper och 2–3 förmågor per spelare. Varje förmåga har en
  riktig tabellrad så att val och GM-besked ligger på samma höjd.
- Inkommande direkt efter Spelare / roll, gemensam cell för hela rollen.
- player-kill / player-other och GM-bekräftade dödsorsaker med referens till
  ursprunglig handling och utförare. Dagens utfall registreras separat i Möte.
- Enter sparar och fokuserar nästa tillgängliga GM-besked, också när en färdig
  roll försvinner från filtret Väntar. Sparfel ska bevara utkast och fokus.
- Gryning: förväntade men ännu osparade GM-besked har ljus bärnstensfärg,
  markerad kant och texten "Saknas – skriv besked…" i respektive fält.
  Färgen försvinner först när beskedet sparats. Inga sådana markeringar för
  döda roller, historiska dygn eller förmågor där besked inte behövs.
- Fasstatus visar allt inskickat/allt sparat med grön knapp till nästa fas,
  annars antal återstående val/besked och möjlighet att filtrera på Väntar.
  Servern kräver särskild bekräftelse av aktuell lista för att gå vidare med
  utestående arbete. Listan gäller hela partiet, oavsett tabellfilter.
- Anteckningstypen Morgon visas som läsunderlag på GM:s morgonvy, på samma
  kort som dödsfall om spelaren är död, annars under Övriga morgonanteckningar.
  Bestående och vanliga dygnsanteckningar tas inte med i läsunderlaget.
- Två sorters rollanteckningar: bestående (föremål, antal, längre tillstånd)
  och dygnsvisa (börjar tomma nästa dygn). Korta utdrag visas i tabellen,
  med direktredigering i egen kolumn och även redigering/tömning i rolldetaljerna.
  Kolumnen har en höjdjusterbar textarea och växel Bestående/Dygn N; inga
  osparade utkast kastas vid växling. Båda är GM-hemliga och historikbevarade.

## Härnäst: färdigställ spelupplevelsen

- Mobil spelarvy implementerad: roll, vinstvillkor, powers, kvittenser och chatt.
  Nästa verifiering: användarens telefon på samma wifi.
- GM:s "se som spelare" ska använda spelarens serverfiltrerade datavy.
- Tangentbord: snabbt spara GM-svar och gå vidare till nästa rad.
- Massmeddelande till alla levande eller endast ej klara.
- Nedräkning kopplad till serverns tid, påminnelse utan automatiskt fasbyte.
- Läsning och "hanterat" separata för GM-chatt.
- Tydlig hantering av döda spelare, grupputförare och villkorade powers.
- Simulering av spelarchatt och flera samtidiga spelare.
- Verifiera 25 spelare över 10 dygn samt mobil vila/återanslutning.

Flera av punkterna ovan har nu implementerats i första prototypen; se SESSION.md
för faktisk status. Separat loggsida, GM-morgonvy, broadcasts, servernedräkning
och simulering av spelarchatt ingår redan i den pågående leveransen.

## Morgonunderlag och logg

- Morgonvyn är GM:s mobilanpassade berättarstöd, inte spelarens privata svar.
- Registrera dödsfall med orsak natt/hängning och en valfri formulerad ledtråd.
- Visa namn, roll, grupptillhörighet, rollbeskrivning, vinstvillkor och powers
  som stöd. GM väljer själv vilken del som berättas för spelarna.
- Separera nattens dödsfall och hängningen före natten.
- Loggen visar konkret vem som valde vad, GM-besked, statusändringar,
  aktivering av powers, dödsfall/ledtrådar, chatt och broadcasts per dygn.
- Visa aktivt förlopp som standard; alternativa testgrenar väljs uttryckligen.
- Sökning, dygnsfilter, händelsetyp och JSON-export.
- Framtida idé: en sammanhängande slutberättelse, utskriftsvy och mer polerade
  berättarkort. Inga automatiskt fabricerade spelhändelser.

## Senare: förberedelseportal

- Bibliotek för powers, vinstvillkor och roller, separat från speldatan.
- Scenariomallar och alternativa rollkombinationer per spelarantal.
- Överblick: antal roller, grupptillhörighet, förmågor och balansanteckningar.
- Deltagarlista när folk anländer; välj matchande mall och slumpa tilldelning.
- Förhandsgranska innan roller publiceras till spelarna.
- Skapa spelinstanser med kopior/versionerade definitioner: mallredigering
  får inte i efterhand ändra ett startat parti.
- Importera utvalda V2-scenarier utan historiska personnamn/anteckningar/status.
- Porträtt/kamera/namnlista från V1 vid behov.

## Teknisk riktning (agentens val, kan omprövas)

- React/Vite/TypeScript/Tailwind, Express/TypeScript, Node:s inbyggda SQLite.
- SQLite WAL, parametriserade frågor, transaktioner och versionssatt schema.
- Första implementationen använder beständiga oföränderliga revisioner med
  hela speltilståndet i JSON. Varje revision pekar på sin förälder och innehåller
  alla hittills skapade dygn. En separat pekare väljer aktiv revision.
- Inga DELETE av revisionshistorik. Händelser efter bakåtsteg bildar ny gren.
- Detta är en enkel första modell för små partier. Innan större chattmängder
  eller långtidsdrift: mät filstorlek; överväg separata oföränderliga meddelanden
  och strukturellt delade snapshots för att minska duplicering.
- Föreslaget framtida relationsschema kan normalisera rundor/actions utan att
  ändra produktbeteendet eller tappa gamla revisioner. Gör det behovsstyrt.
- GM-redigering av roller under spel måste ha tydlig policy; inga oavsiktliga
  sidoeffekter från mallar. Nuvarande prototyp versionssätter spelkopian.
- SSE skickar endast notifiering om förändring, klienten hämtar aktuell vy.
  Efter återanslutning hämtas full vy så missade notifieringar inte tappar data.
- Meddelande-ID från klienten gör omsändning idempotent.
- Sessionscookie och serverfiltrering: inga GM-noteringar, blockeringar eller
  opublicerade GM-svar får läcka till spelarens API-svar.
- Normala partier har läsbar historik; återställning av aktivt tillstånd är en
  uttrycklig testfunktion, inte en vanlig knapp i skarpt spel.

## Viktiga verifieringsfall

- Två gruppmedlemmar ändrar samma val; exakt en utförare visas.
- Blockering ändrar varken spelarens svar eller inlämningsmöjlighet.
- Natt → Gryning döljer besked tills Morgon, inkallning döljer besked.
- Föregående dygn förblir orört när ny runda startar.
- Bakåt flera steg, framåt flera steg, avvikande gren, återbesök gammal gren.
- Omstart av server bevarar aktiv revision och alla grenar.
- Ny liveuppdatering skriver inte över osparat GM-utkast.
- Skickat meddelande + tappad kvittens + omsändning ger ett meddelande.
- Otillåten rumsåtkomst och åtkomst till annat parti nekas.
- Kontrast, tangentbord, normal datorskärm utan sidledsskroll.
