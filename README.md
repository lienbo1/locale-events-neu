# Lokale Veranstaltungen – neue saubere Version

Diese Version arbeitet ohne Ticketmaster und sammelt lokale Veranstaltungshinweise
aus Nachrichten-/RSS-Suchergebnissen.

## Enthalten
- PLZ-Suche
- Radius: 5 / 10 / 25 / 50 / 75 / 100 km
- Kategorien
- Heute
- Dieses Wochenende
- Nächste 7 Tage
- Alle
- 10 Treffer pro Seite
- Dublettenfilter
- eigenes App-Symbol
- PWA / Startbildschirm
- erkannte vergangene Termine werden ausgeblendet

## Deployment auf Render
1. Neues GitHub-Repository anlegen.
2. Alle Dateien dieses Projekts hochladen.
3. Render > New > Web Service.
4. GitHub-Repository verbinden.
5. Build Command: npm install
6. Start Command: npm start
7. Instance Type: Free

Danach die Render-Adresse in Chrome auf dem Handy öffnen und
„App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.

Hinweis:
Hinweise ohne eindeutig erkennbares Veranstaltungsdatum können weiterhin erscheinen.
Maßgeblich ist immer die verlinkte Originalquelle.
