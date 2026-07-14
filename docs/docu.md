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

> *To be documented.*  
> *Noch zu dokumentieren.*

---

## Operation / Betrieb

> *To be documented.*  
> *Noch zu dokumentieren.*

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

> *To be documented.*  
> *Noch zu dokumentieren.*

---

## States Reference / State-Referenz

> *To be documented.*  
> *Noch zu dokumentieren.*
