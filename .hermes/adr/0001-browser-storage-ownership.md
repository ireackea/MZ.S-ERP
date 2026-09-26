# ADR-0001: Browser Storage Ownership

- Status: Accepted for implementation
- Date: 2026-09-25
- Scope: FeedFactory ERP frontend
- Decision owners: Backend and frontend maintainers

## Context

The application historically used localStorage for business records, credentials, audit-like logs, and presentation state. IndexedDB is used by the offline mutation queue. PostgreSQL and the authenticated server session are the only authoritative stores for business data and security state.

## Decision

Every browser storage key is registered in `frontend/src/services/storageOwnership.ts` and assigned exactly one ownership class:

| Ownership | Meaning | Examples |
|---|---|---|
| `BUSINESS_SERVER` | Business or configuration data that must be read from/written to the server | items, transactions, partners, orders, users, stocktaking, formulas, stock checks |
| `PRESENTATION_PREFERENCE` | Non-sensitive UI state that may remain on the device | theme, language, column order, print presets, PWA prompt state, grid preferences |
| `OFFLINE_QUEUE` | Technical IndexedDB state only; never considered committed | `FeedFactoryMutationDB/mutationQueue` |
| `LEGACY_UNSUPPORTED` | Temporary migration input or retired implementation surface | legacy opening balances, legacy unloading rules, maintenance mode |
| `SECRET_FORBIDDEN` | Credentials, tokens, session state, lockout/2FA state, device security metadata, and audit evidence | auth credentials, JWT material, auth challenges, audit logs |

## Required boundaries

1. `stocktaking`, `partners`, and `orders` are server-backed domains. Their old localStorage keys are not an acceptable source of truth.
2. Theme, language, grid, print, and similar presentation preferences may remain local.
3. Passwords, JWTs, credential hashes, reset codes, OTP challenges, session identifiers, and audit evidence must never be written to browser storage.
4. IndexedDB mutation entries are technical queue state. They must be owner-bound, idempotent, and replayable; they are not business records until the server accepts them.
5. Legacy data is read through a versioned migration adapter, exported before migration, imported idempotently, and removed from active imports after verification.

## Guard contract

`assertStorageKeyAllowed` is called by shared storage helpers and must be called by direct storage consumers. An unregistered key fails closed with `STORAGE_KEY_NOT_REGISTERED`. Adding a business key requires an explicit inventory entry with ownership, area, and consumers.

The guard is not a substitute for server authorization. It is a local boundary that prevents accidental reintroduction of browser persistence.

## Consequences

- Existing local business snapshots require a migration plan before removal.
- Presentation preferences continue to work offline and per browser.
- Security and audit data can no longer be accepted from client storage as authoritative.
- The inventory and guard tests are required CI gates for storage-related changes.
