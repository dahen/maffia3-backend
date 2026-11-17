# Deploymönster för appar på mini

Använd detta som utgångspunkt för framtida Docker-appar på mini. Maffia 3 är referensimplementationen.

1. Publicera en avsiktlig GitHub-release. GitHub Actions kör tester, bygger Docker-imagen och publicerar den i GHCR. Release-manifestet anger version, källkodens commits och image-digest. För appar med flera repon ingår alla delar som ska installeras tillsammans.
2. Visa installerad och tillgänglig version i appens administratörsvy. Administratören väljer när uppdateringen ska starta och följer jobbstatus från samma sida.
3. Kör en liten tjänst på mini som LaunchAgent. Appens backend anropar den via ett privat, autentiserat gränssnitt. Tjänsten har en fast uppgift per installation och validerar releasen. Docker-behörigheten ligger hos värdtjänsten.
4. Hämta imagen innan den gamla containern stoppas. Ta en konsekvent backup anpassad till appens datalagring, ersätt den avsedda containern och verifiera hälsan. Spara jobbstatus, backup och föregående image på värden så att de finns kvar vid omstart och kan användas för återställning.

Anpassa appidentitet, behörigheter, hälsokontroll och återställningsrutin för varje app. En LaunchAgent hör till användarens inloggade session.

Maffia 3 uppdaterades via GM-knappen från v0.1.0 till v0.1.1 på mini den 17 november 2026. GM-vyn visade installerad v0.1.1 och slutfört jobb efter omladdning. Se [installationen på mini](README.md) för den konkreta konfigurationen.
