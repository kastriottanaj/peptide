# Checkout Workflow — Design

**Datum:** 2026-07-26
**Status:** Entwurf, wartet auf Freigabe
**Vorlage:** `peptide` project (`~/Desktop/peptide`, Next.js + Django, live auf
peptidebestellung.de)

## Ziel

Den erprobten Checkout-Ablauf von peptidebestellung.de auf diesen Stack übertragen:
Astro-Storefront + Medusa v2 statt Next.js + Django. Der *Geschäftsablauf* wird
kopiert, nicht der Code — Medusa bringt Warenkorb, Bestellung, Zahlung, Lager und
Admin bereits mit.

## Der Ablauf in der Vorlage

Einseitiger Checkout (kein Wizard), Reihenfolge von oben nach unten:

1. **Kontakt & Rechnungsadresse** — Vorname, Nachname, E-Mail, Telefon, Firma,
   USt-IdNr., Straße, PLZ, Ort, Land. Pflichtfelder werden clientseitig markiert und
   serverseitig erneut geprüft.
2. **Rabattcode** (optional) — eigener Endpunkt validiert den Code gegen den
   Zwischensummenwert, bevor bestellt wird, und liefert die neue Summe zurück.
3. **Zahlungsart** — Banküberweisung oder Krypto (NOWPayments).
   **In der Vorlage ist Krypto per `cryptoEnabled = false` abgeschaltet**, und die
   API antwortet für Krypto mit 503. Live läuft ausschließlich Banküberweisung.
4. **Pflicht-Bestätigung** — eine Checkbox `termsPrivacyConfirmation`, die AGB,
   Datenschutz und Widerruf verlinkt. Ohne sie kein Absenden.
5. **Bestellung anlegen** — ein POST, serverseitig in **einer Transaktion**:
   Zwischensumme → Rabattcode sperren und prüfen → Kunde anlegen/aktualisieren →
   Adresse → Bestellung mit Lagerreservierung → Zahlungssatz → Bestätigungs-Mails
   in die Warteschlange. Erst nach erfolgreichem Commit werden die Mails versendet.
6. **Bestätigungsseite** — Bestellnummer, IBAN, BIC, Empfänger, Betrag und
   **Verwendungszweck**. Der Kunde überweist selbst; die Zahlung wird später im
   Admin manuell als bezahlt markiert.

### Geschäftsregeln, die mitkommen

| Regel | Wert in der Vorlage |
|---|---|
| Bestellnummer | `PB-<YYYYMMDD>-<8 Hex>` |
| Verwendungszweck | `PB-<6 Zeichen>` aus `ABCDEFGHJKMNPQRSTUVWXYZ23456789` |
| Mengenrabatt | 3 Stk 3 %, 4→5 %, 5→7 %, 6→8 %, 7→10 %, 8→12 %, 9→13 %, ab 10 Stk 15 % |
| Versand | 10 € DE, 20 € außerhalb DE, **kostenlos ab 100 €** Warenwert nach Rabatt |
| Lager | Reservierung beim Anlegen der Bestellung; bei Unterdeckung 409 mit Klartext |
| Attribution | `visitorId`, `sessionId`, UTM/Referrer werden **beim Absenden** erfasst und an der Bestellung gespeichert |

Das Alphabet für den Verwendungszweck lässt `I`, `L`, `O`, `0` und `1` bewusst weg —
der Code wird von Hand ins Online-Banking getippt.

## Übertragung auf Astro + Medusa

| Vorlage (Django) | Hier (Medusa v2) |
|---|---|
| Eigenes `Order`-Modell, 968 Zeilen | Medusa-Bestellung, unverändert |
| `OrderStatus` / `OrderPaymentStatus` / `ShippingStatus` | Medusas `status`, `payment_status`, `fulfillment_status` |
| `create_order()` mit Lagerreservierung | `medusa.store.cart.complete()` |
| `PaymentMethod.BANK_TRANSFER` | Manueller Payment-Provider (`pp_system_default`) |
| `DiscountTier` (Mengenrabatt) | Promotions-Modul, Regel auf Gesamtmenge |
| `DiscountCode` inkl. Influencer-Feldern | Promotion + `metadata` für Kampagne/Influencer |
| `shipping_total_for_order()` | Shipping-Options mit Preisregeln pro Land + Schwellwert |
| `generate_bank_reference()` | Subscriber auf `order.placed`, schreibt `metadata.bank_reference` |
| Bestätigungs-Mails aus Django | Subscriber auf `order.placed` + Notification-Modul |
| Eigenes `/ops`-Admin | Medusa-Admin unter `/app` |

**Krypto ist kein Bestandteil dieser Umsetzung** — in der Vorlage abgeschaltet, und
die Wahl des Zahlungsanbieters steht laut `TECH_STACK.md` noch aus.

## Umfang

- `src/lib/cart.ts` — Warenkorb anlegen/laden (Cookie), Position hinzufügen/ändern/entfernen
- `AddToCart` als Insel auf der Produktseite; ersetzt den deaktivierten Button
- `/warenkorb` — Positionen, Mengen, Zwischensumme, Mengenrabatt-Hinweis
- `/kasse` — einseitiges Formular in der Reihenfolge oben, inkl. Pflicht-Checkbox
- `/bestellung/[id]` — Bestätigung mit Bankdaten und Verwendungszweck
- Warenkorb-Zähler im Header
- Backend: Versandoptionen, Mengenrabatt-Promotion, `order.placed`-Subscriber für
  Verwendungszweck und Bestätigungsmail

## Nicht-Ziele

- Krypto-Zahlung
- Kundenkonten/Login (Gast-Checkout genügt, wie in der Vorlage)
- B2B-Verifizierung, Backorders, Verzugs-Kompensation, Sendungs-Import
- Eigenes Admin-Backend

## Offene Punkte (Nutzerentscheidung)

1. **Bankverbindung** — IBAN, BIC, Kontoinhaber fehlen. Ohne sie kann die
   Bestätigungsseite keine echten Daten zeigen.
2. **Präfix** — `PB-` stand für *Peptidebestellung*. Hier vermutlich `PE-`.
3. **Mengenrabatt** — Staffel unverändert übernehmen oder anpassen?
4. **Versandkosten** — 10 €/20 €/frei ab 100 € unverändert übernehmen?

## Verifikation

- `npm run typecheck` und `npm run build` im Storefront, `npm run lint`/`build`/`test`
  im Backend.
- Manuell gegen laufendes Medusa: Artikel in den Warenkorb, Menge ändern, entfernen;
  Zähler im Header stimmt; Mengenrabatt greift ab 3 Stück; Versand wird ab 100 €
  Warenwert frei; Checkout ohne Pflicht-Checkbox nicht absendbar; Bestellung
  erscheint im Medusa-Admin mit Verwendungszweck in den Metadaten.
- Lagerprüfung: Bestellung über den verfügbaren Bestand hinaus wird mit
  verständlicher deutscher Meldung abgelehnt.
