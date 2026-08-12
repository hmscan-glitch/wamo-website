# Supabase-Setup

`community.sql` richtet das Schema in einem neuen, leeren Supabase-Projekt ein.
Bei einem bestehenden Projekt werden stattdessen ausschließlich die Dateien in
`migrations/` in aufsteigender Reihenfolge angewendet.

Die Tabellen mit privaten Nutzerdaten sind durch RLS geschützt. Direkte
Schreibrechte auf Community-Beiträge und Meldungen sind absichtlich entzogen;
Schreibvorgänge laufen über eng freigegebene `SECURITY DEFINER`-RPCs mit leerem
`search_path`, Identitätsprüfung, Besitzprüfung und Rate-Limits. Die interne
Rate-Limit-Tabelle liegt im nicht exponierten Schema `private` und hat bewusst
keine Client-Policy.

Vor einer öffentlichen Freischaltung der Registrierung müssen außerdem
folgende Punkte erledigt sein:

- eigener SMTP-Absender in Supabase Auth
- vollständige Betreiber- und Kontaktangaben in `datenschutz.html`
- CAPTCHA-Integration für Registrierung, Anmeldung und Passwort-Reset
- abschließender Test von Bestätigungs- und Passwort-Reset-E-Mails

Solange die technische Testphase geschlossen ist, muss in Supabase Auth
`Allow new users to sign up` deaktiviert bleiben. Die Frontend-Konstante blendet
die Registrierung nur in der Oberfläche aus und ist keine serverseitige
Zugriffskontrolle.

Für GitHub Pages müssen in Supabase Auth außerdem diese URLs konfiguriert sein:

- Site URL: `https://hmscan-glitch.github.io/wamo-website/deadlock-wiki/`
- Redirect-Allowlist: `https://hmscan-glitch.github.io/wamo-website/deadlock-wiki/**`

E-Mail-Bestätigung bleibt aktiviert. Für die öffentliche Freischaltung werden
erst nach Abschluss der obigen Punkte sowohl `Allow new users to sign up` in
Supabase Auth aktiviert als auch `REGISTRATION_ENABLED` in
`assets/wiki-account.js`, `assets/community.js` und `profil.html` auf `true`
gesetzt. Community-Schreibaktionen werden erst nach erfolgreicher Anwendung
aller Migrationen zusätzlich über `COMMUNITY_WRITES_ENABLED` in
`assets/community.js` freigeschaltet.
