# Pre-Change File Backup Policy

This directory is reserved for copies of files before any future cleanup or architectural consolidation work.

## Rule

1. Before modifying any existing source file during a cleanup decision, copy the original file here first.
2. Use a timestamped subfolder for each batch.
3. Preserve the original relative path inside the batch folder when possible.

## Example

1. artifacts/phase3/file-backups/2026-03-26T2200-pre-settings-cleanup/frontend/src/components/Settings.tsx
2. artifacts/phase3/file-backups/2026-03-26T2200-pre-settings-cleanup/frontend/src/modules/settings/pages/Settings.tsx

## Purpose

1. Retain legacy features and implementation details that may be needed later.
2. Support rollback, reconstruction, and external review.