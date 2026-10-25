# Läs först vid fortsatt arbete

Detta är backend-repot för version 3. Frontend ligger i ../maffia3-frontend.
Läs docs/SESSION.md, docs/BESLUT.md och docs/PLAN.md innan du fortsätter.
Användaren vill nu börja med en kompakt GM-vy och simulering av spelarbeteenden.
Återskapa inte V2:s stora paneler och ändra inte fastställda spelregler.
Uppdatera dokumenten när beslut, implementation eller verifiering förändras.
Gör löpande commits av fungerande delsteg med tydliga meddelanden. Användaren
har uttryckligen bett om ordentlig Git-historik och push till GitHub.

Versionshistorik och grenar i ett testparti får inte raderas vid rundbyte eller
vid nya handlingar efter ett bakåtsteg. Blockering är hemlig och får aldrig
hindra spelarens inlämning. Hemlig information ska filtreras på servern.

Gamla referensprojekt i ../../1 nodesis + cangro maffia och
../../2 hermes maffia ska lämnas orörda. Ingen publicering/deploy är beställd.

Telefoner visar endast det enda Live-markerade partiet, utan partiväljare.
Val av återanvändbara rolluppsättningar per spelarantal är nu must have;
flera samtidiga GM-testpartier är nice to have. Live-markering och testläge
är separata, så mobiltest behöver inte förlora historiknavigering.

Mallflödet är nu preciserat: fyra separata GM-sidor för bibliotek-CRUD,
partimallar, test-/skarpa spelarlistor och start/godkännande av rollfördelning.
Ingen spara-roller-/spara-mall-knapp från Spelöversikten. Endast godkänd
rollfördelning blir Live. Nollställning bevarar föregående partis historik.
Spara/läsa in HELA speltillstånd är endast nice-to-have; import återstår.
