# Adapter Documentation / Adapter-Dokumentation

> **Language note:** This document is maintained in English (primary) and German (parallel).  
> **Sprachhinweis:** Dieses Dokument wird auf Englisch (primär) und Deutsch (parallel) gepflegt.

---

## Table of Contents / Inhaltsverzeichnis

- [Configuration](#configuration--konfiguration)
- [Operation](#operation--betrieb)
- [User Management](#user-management--benutzerverwaltung)
- [Monitoring](#monitoring--überwachung)
- [States Reference](#states-reference--state-referenz)

---

## Configuration / Konfiguration

All settings are found in the adapter's configuration page in ioBroker admin.

Alle Einstellungen befinden sich auf der Konfigurationsseite des Adapters in der ioBroker-Admin-UI.

### Network Setup / Netzwerk-Setup

| Field | Description | Beschreibung |
|---|---|---|
| `bind` | Network interface to listen on | Netzwerkschnittstelle |
| `port` | UDP listen port (adapter → controller) | UDP-Empfangsport |
| `r_port` | Remote port on controller side | Remote-Port am Controller |
| `timeout` | Request timeout in ms (min 1000) | Anfrage-Timeout in ms |
| `heartbeat` | Heartbeat interval in ms | Heartbeat-Intervall in ms |
| `settime` | Auto clock-sync interval in ms (min 1200) | Uhrzeit-Sync-Intervall in ms |
| `debugLL` | Enable low-level UDP debug logging | Low-Level-Debug-Log aktivieren |

### Controllers

Add one entry per physical access controller. Each controller needs:
- **Serial number** — printed on the device
- **Network mode** — Broadcast (auto-discover) or Dedicated (fixed IP)
- For Dedicated mode: device IP, adapter-exposed host address + port

Für jeden physischen Zutrittskontroller einen Eintrag hinzufügen. Benötigt:
- **Seriennummer** — auf dem Gerät aufgedruckt
- **Netzwerkmodus** — Broadcast (automatisch) oder Dedicated (feste IP)
- Bei Dedicated: Geräte-IP, exponierte Host-Adresse + Port

---

## Operation / Betrieb

### Starting the adapter / Adapter starten

After configuration, start the adapter via the ioBroker admin instances page. The adapter connects to all configured controllers on startup.

Nach der Konfiguration den Adapter über die ioBroker-Admin-Instanzenseite starten. Beim Start verbindet sich der Adapter mit allen konfigurierten Controllern.

### Card swipe events / Kartenereignisse

When a card is presented to a reader, the adapter receives the event and:
1. Updates `cards.<serial>.lastEvent` state with event details
2. Increments `cards.<serial>.eventCount`
3. If User Management is active: matches card to UserDB, may create a review queue entry for unknown cards

### Door control / Türsteuerung

Set `cards.<serial>.door<N>.remoteOpen` to `true` (ack=false) to trigger a remote door open. The adapter sends the command to the controller and resets the state.

`cards.<serial>.door<N>.remoteOpen` auf `true` (ack=false) setzen, um eine Fernöffnung auszulösen.

### Time synchronization / Zeitsynchronisation

The adapter automatically syncs the controller clock at the interval configured in `settime`. Can also be triggered manually via the `setip` messagebox command.

---

## User Management / Benutzerverwaltung

The adapter maintains a local user database (UserDB) that maps access card credentials to named users across all configured controllers.

Der Adapter führt eine lokale Benutzerdatenbank (UserDB), die Zutrittskarten-Credentials über alle konfigurierten Controller hinweg benannten Benutzern zuordnet.

### User Ops Panel / Benutzer-Operationen

The User Ops panel is available in the ioBroker admin UI under the adapter's settings tab.

Das Benutzer-Ops-Panel ist in der ioBroker-Admin-UI unter dem Einstellungs-Tab des Adapters erreichbar.

**Basic mode** — visible to all users:
- Review Queue (list, approve, apply decisions)
- Sync Apply (overwrite mode, controller-scoped)

**Power mode** — enable via toggle in the panel header:
- Import Preview / Apply (dataset-based bulk import)
- Sync Preview (delta/selected-user modes)
- Validate / Reconcile Preview
- Restore-Resync Preview / Apply
- Job Monitor tab (background job tracking)
- Clear Done button (removes applied/rejected/failed review entries)

**Power-Modus** — aktivierbar über den Schalter im Panel-Header:
- Import-Vorschau / Anwenden (dataset-basierter Massenimport)
- Sync-Vorschau (Delta/ausgewählte-Benutzer Modi)
- Validieren / Abgleich-Vorschau
- Restore-Resync Vorschau / Anwenden
- Job-Monitor-Tab (Hintergrundaufträge)
- "Clear Done"-Schaltfläche

### Import Flow / Import-Ablauf

1. **Import Preview** — analyzes dataset, creates review queue entries (no changes written)
2. **Review Queue** — approve/reject/merge each entry; candidates shown as clickable chips
3. **Import Apply** — writes approved entries to UserDB and controllers

1. **Import-Vorschau** — analysiert Dataset, erstellt Review-Einträge (keine Änderungen)
2. **Review-Queue** — Einträge genehmigen/ablehnen/zusammenführen; Kandidaten als klickbare Chips
3. **Import anwenden** — schreibt genehmigte Einträge in UserDB und Controller

### Sync Flow / Sync-Ablauf

Synchronizes UserDB state to all (or selected) controllers.

Synchronisiert den UserDB-Stand auf alle (oder ausgewählte) Controller.

- **Overwrite** — writes all UserDB users to controller; removes unknown cards
- **Delta** — only writes changed/new users
- **Selected users** — only syncs specific userIds (Power mode)

### Review Queue Filters / Review-Queue-Filter

| Filter | Beschreibung |
|---|---|
| Status | pending / approved / rejected / applied / failed |
| Type | merge / create / conflict / changed / new |
| Text | Review-ID oder User-ID Suche |
| Candidates only | Nur Einträge mit Merge-Kandidaten anzeigen |

### Dashboard Summary Cards / Dashboard-Übersichtskarten

Visible in the panel header (some power-only):

| Card | Shows |
|---|---|
| Status | idle / running / ok / error |
| Pending Reviews | count + A/R/P/F breakdown |
| Running Jobs | active background job count |
| Last Sync Result | W:writes / D:deletes / S:skipped |
| Last Import Preview | records / +create / ~update / conflicts *(Power)* |
| Last Restore Preview | planned actions / can apply *(Power)* |
| Last Validate Report | dups / unknown refs / issues count *(Power)* |

---

## Monitoring / Überwachung

### Connection state / Verbindungsstatus

`info.connection` — `true` if at least one controller is reachable, `false` otherwise.

`info.connection` — `true` wenn mindestens ein Controller erreichbar ist.

### ioBroker log

- **Info**: controller connected/disconnected, sync applied, job completed
- **Debug**: individual card events, state changes
- **Silly** (Low Level Debug enabled): raw UDP frames

### Background jobs / Hintergrundaufträge

Long-running operations (sync, import apply, validate, restore-resync) run as background jobs. Monitor via:
- **Job Monitor tab** in the User Ops panel (admin UI)
- `cards.jobs` state — JSON array of all jobs
- `cards.lastJob` state — most recent job object

Lange Operationen laufen als Hintergrundaufträge. Überwachung über:
- **Job-Monitor-Tab** im User-Ops-Panel
- State `cards.jobs` — JSON-Array aller Jobs
- State `cards.lastJob` — aktuellster Job

---

## States Reference / State-Referenz

The adapter organizes states into three main hierarchies: adapter info, controller devices, and card management.

Der Adapter organisiert Zustände in drei Haupthierarchien: Adapter-Info, Controller-Geräte und Kartenverwaltung.

### Adapter Information / Adapter-Information

| State | Type | Description | Beschreibung |
|---|---|---|---|
| `info.connection` | boolean | Connection status to any controller | Verbindungsstatus zu mindestens einem Controller |

### Controllers / Controller

**Path:** `wiegand-tcpip.<instance>.controllers.<serial>.*`

For each configured controller, states are created automatically. Replace `<serial>` with the device serial number.

Für jeden konfigurierten Controller werden Zustände automatisch erstellt. `<serial>` ist die Geräte-Seriennummer.

| State | Type | Description | Beschreibung |
|---|---|---|---|
| `eventNr` | number | Last event sequence number | Letzte Event-Nummer |
| `reachable` | boolean | Device reachable (true = online) | Gerät erreichbar (true = online) |

**Door Access States** (one per configured door):

| State | Type | Description | Beschreibung |
|---|---|---|---|
| `doors.<doorNr>.unlocked` | boolean | Door unlocked (1=yes, 0=no) | Tür entsperrt (1=ja, 0=nein) |
| `doors.<doorNr>.unauthorized` | boolean | Unauthorized access attempt | Nicht autorisierter Zutrittversuch |
| `doors.<doorNr>.directionCode` | number | Direction: 0=In, 1=Out, 2=Reverse | Richtung: 0=Ein, 1=Aus, 2=Revers |
| `doors.<doorNr>.directionText` | string | Human-readable direction | Lesbare Richtung |
| `doors.<doorNr>.requestCode` | number | Request code (door button, etc.) | Anfragecode |
| `doors.<doorNr>.requestText` | string | Human-readable request | Lesbare Anfrage |

**Last Event States** (most recent access):

| State | Type | Description | Beschreibung |
|---|---|---|---|
| `doors.<doorNr>.lastEventTime` | string | ISO8601 timestamp | ISO8601-Zeitstempel |
| `doors.<doorNr>.lastCard` | string | Card number (hex) | Kartennummer (hex) |
| `doors.<doorNr>.lastPin` | string | PIN (if used) | PIN (falls verwendet) |
| `doors.<doorNr>.lastAction` | string | Grant/Deny | Gewährt/Verweigert |

### Card & User Management / Kartenverwaltung & Benutzerverwaltung

**Path:** `wiegand-tcpip.<instance>.cards.*`

| State | Type | Description | Beschreibung |
|---|---|---|---|
| `cards.db` | string (JSON) | User/credential database snapshot | Benutzer-/Anmeldedatenbank-Snapshot |
| `cards.userCount` | number | Total managed users | Gesamtzahl verwalteter Benutzer |
| `cards.credentialCount` | number | Total managed credentials (cards + PINs) | Gesamtzahl verwalteter Anmeldedaten |
| `cards.lastUpdate` | string | Last database modification time | Letzte Änderung der Datenbank |
| `cards.reviewQueue` | string (JSON) | Pending import reviews | Ausstehende Importüberprüfungen |
| `cards.reviewPending` | number | Count of items in review | Anzahl Überprüfungselemente |
| `cards.jobs` | string (JSON) | All background jobs (active + completed) | Alle Hintergrund-Jobs |
| `cards.lastJob` | string (JSON) | Most recent job summary | Letztes Job-Zusammenfassung |
| `cards.lastSyncPreview` | string (JSON) | Sync preview result (no changes yet) | Sync-Vorschau (keine Änderungen) |
| `cards.lastSyncApply` | string (JSON) | Last sync apply result (actual writes) | Letztes Sync-Ergebnis (tatsächliche Änderungen) |
| `cards.lastValidation` | string (JSON) | Validation/reconcile report | Validierungs-/Abgleichbericht |

**JSON Format Examples:**

- **cards.db**: `{ users: [...], credentials: [...], syncLog: [...] }`
- **cards.jobs**: Array of job objects with { id, type, status, result, startTime, endTime }
- **cards.reviewQueue**: Array of { id, type, action, cardNr, pinValue, candidates, etc. }

Beispiele für JSON-Formate:

- **cards.db**: `{ users: [...], credentials: [...], syncLog: [...] }`
- **cards.jobs**: Array von Job-Objekten mit { id, type, status, result, startTime, endTime }
- **cards.reviewQueue**: Array von { id, type, action, cardNr, pinValue, candidates, ... }
