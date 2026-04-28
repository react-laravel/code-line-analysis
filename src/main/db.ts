import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { EXCLUDED_ASSET_EXTENSIONS } from './scanner/fileFilters';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'codeline.sqlite');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  cleanupExcludedRows(db);
  return db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      baseline_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rules (
      folder_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      pattern TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_rules_folder ON rules(folder_id);

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      rel_path TEXT NOT NULL,
      lang TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      hash TEXT NOT NULL,
      total INTEGER NOT NULL,
      code INTEGER NOT NULL,
      comment INTEGER NOT NULL,
      blank INTEGER NOT NULL,
      block_comment INTEGER NOT NULL,
      baseline_total INTEGER NOT NULL DEFAULT 0,
      scanned_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      UNIQUE(folder_id, rel_path),
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_files_lang ON files(folder_id, lang);

    CREATE TABLE IF NOT EXISTS tags (
      file_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id);
    CREATE INDEX IF NOT EXISTS idx_tags_kind ON tags(kind);

    CREATE TABLE IF NOT EXISTS functions (
      file_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      length INTEGER NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file_id);
    CREATE INDEX IF NOT EXISTS idx_functions_length ON functions(length DESC);

    CREATE TABLE IF NOT EXISTS duplicates (
      hash TEXT NOT NULL,
      file_id INTEGER NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_duplicates_hash ON duplicates(hash);
    CREATE INDEX IF NOT EXISTS idx_duplicates_file ON duplicates(file_id);
  `);
}

function cleanupExcludedRows(d: Database.Database): void {
  const placeholders = EXCLUDED_ASSET_EXTENSIONS.map(() => '?').join(', ');
  d.prepare(`
    UPDATE files
    SET deleted = 1
    WHERE deleted = 0 AND (lang = 'Binary' OR ext IN (${placeholders}))
  `).run(...EXCLUDED_ASSET_EXTENSIONS);
}

export function closeDb(): void {
  if (db) { db.close(); db = null; }
}
