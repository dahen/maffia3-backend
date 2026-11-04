# Prompt till chatten på mini

Vi har nu implementerat GM-styrda uppdateringar med färdigbyggda Docker-images.
Gör installationsarbetet på mini utifrån backend-repots `deploy/README.md`.
Den innehåller kontrakt, exempel, säkerhetsgränser och återställningsrutin.

Läs först instruktionerna i båda repositories. Kontrollera rena arbetskopior
och hämta senaste main i backend och frontend utan att kasta lokala ändringar.
Behåll all befintlig speldata. Ingen seed, reset eller radering av volymer.

1. Verifiera att du faktiskt har åtkomst till värdens Docker, inte bara en
   separat agentsandlåda. Inventera verkliga container-/volymnamn och mounts
   innan mutation. Om åtkomst saknas: förbered filerna och redovisa det exakta
   hindret; försök inte kringgå åtkomstgränser.
2. Sätt upp hostprocessen enligt `deploy/host-config.example.json` och
   LaunchAgent-exemplet. Verifiera Node >=24.12, Docker-sökväg, rätt PATH,
   Docker Desktop-context/credential helper och privata state-/backupkataloger.
   Skapa uppdateringsnyckeln lokalt och för över den till appens privata
   miljökonfiguration utan att skriva ut den i svaret, terminalhistorik eller Git.
3. Anpassa befintlig Compose med bara updater-URL/token. Testa hoståtkomst från
   appcontainern. Håll port 3048 utanför NAS/reverse proxy. Börja med loopback;
   om annan bindning behövs, förbered en konkret begränsad nätverkslösning och
   redovisa den för Henrik innan du öppnar ny nätåtkomst.
4. Kontrollera att GitHub Actions kan läsa frontend-repot och publicera GHCR.
   Om token/behörighet saknas ska Henrik ställa in den via respektive tjänsts
   normala gränssnitt; be inte om hemligheter i chatten. Gör inga repos/paket
   publika som genväg. Förbered första releasen med en ny version och exakt
   frontend-SHA. Publicera och byt först när backup- och åtkomstkontrollerna är klara.
5. Öva backup och återställning på separat testvolym. Installera därefter den
   första releasen manuellt enligt README, med samma befintliga datavolym,
   portar och inställningar. Första installationen kan inte ske via den gamla
   appens GUI. Ta konsekvent backup före byte och behåll föregående image.
6. Verifiera appens hälsa, befintligt parti, foton och chatt. Planera därefter
   ett verkligt knapptest till en andra release mellan partier. Inga automatiska
   uppdateringar är tillåtna. Dokumentera faktisk Docker Desktop-uppstart efter
   omboot; LaunchAgent i exemplet kräver användarinloggning.

Rapportera filändringar och deras sökvägar, installerad version och image-digest,
vilka kontroller som verkligen körts och vad som återstår. Skilj förberett från
installerat/publicerat/testat. Maskera hemligheter och återge ingen speldata.
