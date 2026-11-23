# BauMon – tägliche E-Mail „Bühnen abmelden“ (Power Automate)

Die App schreibt bei jeder Änderung die Datei

    OneDrive › Stahlwork › BauMon › _daten › abmelden.json

Darin steht für jeden Tag (heute + 60 Tage), welche Mietbühnen bis dahin abgemeldet
werden können – fertig als Text und HTML:

```json
{ "tage": { "2026-11-24": { "anzahl": 2, "html": "<p>Diese Bühnen …</p><ul>…</ul>", "text": "- …" } } }
```

Ein Ablauf in Power Automate liest jeden Morgen den heutigen Tag aus und schickt die E-Mail.
Die App muss dafür nicht geöffnet sein.

## Ablauf einrichten (einmalig, ca. 10 Minuten)

Im Konto, dem die Datei gehört (Testphase: das eigene OneDrive), unter
<https://make.powerautomate.com> → **Erstellen** → **Geplanter Cloud-Flow**:

1. **Wiederholung**: täglich, 7:00 Uhr, Zeitzone *(UTC+01:00) Amsterdam, Berlin …*
2. Aktion **OneDrive for Business › Dateiinhalt mithilfe des Pfads abrufen**
   Pfad: `/Stahlwork/BauMon/_daten/abmelden.json`
3. Aktion **Daten-Vorgänge › Verfassen** (umbenennen in `Heute`), Ausdruck:

       json(base64ToString(body('Dateiinhalt_mithilfe_des_Pfads_abrufen')?['$content']))?['tage']?[formatDateTime(convertFromUtc(utcNow(), 'W. Europe Standard Time'), 'yyyy-MM-dd')]

4. **Bedingung**: `outputs('Heute')?['anzahl']` ist größer als `0`
5. Bei **Ja**: **Office 365 Outlook › E-Mail senden (V2)**
   - An: Montageleiter (später 1. und 2. Montageleiter)
   - Betreff: `Bühnen abmelden: @{outputs('Heute')?['anzahl']} fällig`
   - Text (Code-Ansicht): `@{outputs('Heute')?['html']}<p><a href="https://buehler-stahlbau.github.io/stahlwork/">Stahlwork öffnen</a></p>`

Speichern und mit **Testen** einmal ausprobieren.

Hinweis: Liefert Schritt 3 einen Fehler, gibt der OneDrive-Schritt den Inhalt schon als
Text zurück. Dann statt `base64ToString(…['$content'])` einfach
`body('Dateiinhalt_mithilfe_des_Pfads_abrufen')` verwenden.
