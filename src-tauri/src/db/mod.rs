use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::Path;

pub const DEFAULT_BLACKLIST: &[&str] = &[
    "node_modules", "vendor", "dist", "build", ".git",
    "*.min.js", "*.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "Cargo.lock", "Gemfile.lock", "composer.lock", "go.sum",
];

pub const DEFAULT_DUPLICATE_LINES: i64 = 8;
pub const GLOBAL_RULES_KEY: &str = "globalRules";

pub fn open_db(app_data_dir: &Path) -> AppResult<Connection> {
    std::fs::create_dir_all(app_data_dir)?;
    let path = app_data_dir.join("codeline.sqlite");
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    cleanup_excluded(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          root_path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
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
        "#,
    )?;
    Ok(())
}

fn cleanup_excluded(conn: &Connection) -> AppResult<()> {
    use crate::scan::filters::EXCLUDED_ASSET_EXTENSIONS;
    let placeholders = EXCLUDED_ASSET_EXTENSIONS
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "UPDATE files SET deleted = 1 WHERE deleted = 0 AND (lang = 'Binary' OR ext IN ({placeholders}))"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = EXCLUDED_ASSET_EXTENSIONS
        .iter()
        .map(|e| e as &dyn rusqlite::ToSql)
        .collect();
    stmt.execute(params.as_slice())?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?")?;
    let mut rows = stmt.query([key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO app_settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

pub fn folder_root(conn: &Connection, folder_id: i64) -> AppResult<String> {
    conn.query_row(
        "SELECT root_path FROM folders WHERE id = ?",
        [folder_id],
        |r| r.get(0),
    )
    .map_err(|_| AppError::msg(format!("Folder {folder_id} not found")))
}

pub fn duplicate_min_lines_key(folder_id: i64) -> String {
    format!("duplicateMinLines:{folder_id}")
}

pub fn duplicate_rules_key(folder_id: i64) -> String {
    format!("duplicateRules:{folder_id}")
}
