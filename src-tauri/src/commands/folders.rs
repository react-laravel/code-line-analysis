use crate::commands::scan::enqueue_folder_scan;
use crate::db::{self, DEFAULT_BLACKLIST};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::types::{FolderRow, FolderRules, ScanOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

fn is_available(path: &str) -> bool {
    Path::new(path).is_dir()
}

fn row_to_folder(id: i64, root_path: String, name: String, created_at: i64) -> FolderRow {
    FolderRow {
        is_available: is_available(&root_path),
        id,
        root_path,
        name,
        created_at,
    }
}

pub fn normalize_rules(rules: FolderRules) -> FolderRules {
    fn dedupe(items: Vec<String>) -> Vec<String> {
        let mut out = Vec::new();
        for item in items
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            if !out.contains(&item) {
                out.push(item);
            }
        }
        out
    }
    FolderRules {
        whitelist: dedupe(rules.whitelist),
        blacklist: dedupe(rules.blacklist),
    }
}

pub fn get_folder_rules(conn: &rusqlite::Connection, id: i64) -> AppResult<FolderRules> {
    let mut whitelist = Vec::new();
    let mut blacklist = Vec::new();
    let mut stmt = conn.prepare("SELECT type, pattern FROM rules WHERE folder_id = ?")?;
    let rows = stmt.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for (ty, pat) in rows.flatten() {
        if ty == "whitelist" {
            whitelist.push(pat);
        } else if ty == "blacklist" {
            blacklist.push(pat);
        }
    }
    Ok(FolderRules {
        whitelist,
        blacklist,
    })
}

pub fn get_global_rules(conn: &rusqlite::Connection) -> AppResult<FolderRules> {
    if let Some(raw) = db::get_setting(conn, db::GLOBAL_RULES_KEY)? {
        if let Ok(rules) = serde_json::from_str::<FolderRules>(&raw) {
            return Ok(normalize_rules(rules));
        }
    }
    Ok(FolderRules {
        whitelist: vec![],
        blacklist: DEFAULT_BLACKLIST.iter().map(|s| (*s).to_string()).collect(),
    })
}

pub fn resolve_rules(global: FolderRules, folder: FolderRules) -> FolderRules {
    let whitelist = if folder.whitelist.is_empty() {
        global.whitelist
    } else {
        folder.whitelist
    };
    let mut blacklist = global.blacklist;
    for p in folder.blacklist {
        if !blacklist.contains(&p) {
            blacklist.push(p);
        }
    }
    FolderRules {
        whitelist,
        blacklist,
    }
}

fn add_folder_row(conn: &rusqlite::Connection, root_path: &str) -> AppResult<FolderRow> {
    let path = PathBuf::from(root_path);
    if !path.is_dir() {
        return Err(AppError::msg("Not a directory"));
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(root_path)
        .to_string();
    let created = now_ms();
    conn.execute(
        "INSERT INTO folders (root_path, name, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(root_path) DO UPDATE SET name = excluded.name",
        rusqlite::params![root_path, name, created],
    )?;
    let (id, root_path, name, created_at): (i64, String, String, i64) = conn.query_row(
        "SELECT id, root_path, name, created_at FROM folders WHERE root_path = ?",
        [root_path],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    Ok(row_to_folder(id, root_path, name, created_at))
}

fn start_watch(app: &AppHandle, state: &AppState, folder: &FolderRow) {
    state
        .watchers
        .start(app.clone(), folder.id, PathBuf::from(&folder.root_path));
}

#[tauri::command]
pub fn folders_add(app: AppHandle, state: State<'_, AppState>, root_path: String) -> AppResult<FolderRow> {
    let row = {
        let conn = state.db.lock();
        add_folder_row(&conn, &root_path)?
    };
    start_watch(&app, &state, &row);
    Ok(row)
}

#[tauri::command]
pub fn folders_add_git_repositories(
    app: AppHandle,
    state: State<'_, AppState>,
    root_path: String,
) -> AppResult<Vec<FolderRow>> {
    let root = PathBuf::from(&root_path);
    if !root.is_dir() {
        return Err(AppError::msg("Not a directory"));
    }
    let mut repos = Vec::new();
    for entry in std::fs::read_dir(&root)? {
        let entry = entry?;
        let child = entry.path();
        if child.join(".git").exists() {
            repos.push(child.to_string_lossy().to_string());
        }
    }
    repos.sort();
    let mut out = Vec::new();
    {
        let conn = state.db.lock();
        for r in repos {
            out.push(add_folder_row(&conn, &r)?);
        }
    }
    for row in &out {
        start_watch(&app, &state, row);
    }
    Ok(out)
}

#[tauri::command]
pub fn folders_list(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<FolderRow>> {
    let rows = {
        let conn = state.db.lock();
        let mut stmt =
            conn.prepare("SELECT id, root_path, name, created_at FROM folders ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |r| {
            Ok(row_to_folder(r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?;
        rows.flatten().collect::<Vec<_>>()
    };
    let watch_pairs: Vec<(i64, String)> = rows
        .iter()
        .map(|r| (r.id, r.root_path.clone()))
        .collect();
    state.watchers.refresh_all(&app, &watch_pairs);
    Ok(rows)
}

#[tauri::command]
pub fn folders_relocate(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    root_path: String,
) -> AppResult<FolderRow> {
    let path = PathBuf::from(&root_path);
    if !path.is_dir() {
        return Err(AppError::msg("Not a directory"));
    }
    let row = {
        let conn = state.db.lock();
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM folders WHERE root_path = ? AND id != ?",
                rusqlite::params![root_path, id],
                |r| r.get(0),
            )
            .ok();
        if existing.is_some() {
            return Err(AppError::msg("Selected directory is already a workspace"));
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&root_path)
            .to_string();
        let n = conn.execute(
            "UPDATE folders SET root_path = ?, name = ? WHERE id = ?",
            rusqlite::params![root_path, name, id],
        )?;
        if n == 0 {
            return Err(AppError::msg("Folder not found"));
        }
        let (id, root_path, name, created_at): (i64, String, String, i64) = conn.query_row(
            "SELECT id, root_path, name, created_at FROM folders WHERE id = ?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        row_to_folder(id, root_path, name, created_at)
    };
    start_watch(&app, &state, &row);
    Ok(row)
}

#[tauri::command]
pub fn folders_remove(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.watchers.stop(id);
    let conn = state.db.lock();
    conn.execute("DELETE FROM folders WHERE id = ?", [id])?;
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?",
        [db::duplicate_min_lines_key(id)],
    )?;
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?",
        [db::duplicate_rules_key(id)],
    )?;
    Ok(())
}

#[tauri::command]
pub fn folders_get_rules(state: State<'_, AppState>, id: i64) -> AppResult<FolderRules> {
    let conn = state.db.lock();
    get_folder_rules(&conn, id)
}

#[tauri::command]
pub fn folders_set_rules(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    rules: FolderRules,
) -> AppResult<FolderRules> {
    let normalized = normalize_rules(rules);
    {
        let conn = state.db.lock();
        conn.execute("DELETE FROM rules WHERE folder_id = ?", [id])?;
        for p in &normalized.whitelist {
            conn.execute(
                "INSERT INTO rules(folder_id, type, pattern) VALUES(?, 'whitelist', ?)",
                rusqlite::params![id, p],
            )?;
        }
        for p in &normalized.blacklist {
            conn.execute(
                "INSERT INTO rules(folder_id, type, pattern) VALUES(?, 'blacklist', ?)",
                rusqlite::params![id, p],
            )?;
        }
    }
    enqueue_folder_scan(
        app,
        id,
        ScanOptions {
            detect_duplicates: Some(true),
            ..Default::default()
        },
    );
    Ok(normalized)
}

#[tauri::command]
pub fn folders_get_duplicate_min_lines(state: State<'_, AppState>, id: i64) -> AppResult<i64> {
    let conn = state.db.lock();
    if let Some(v) = db::get_setting(&conn, &db::duplicate_min_lines_key(id))? {
        if let Ok(n) = v.parse::<i64>() {
            if n >= 3 {
                return Ok(n);
            }
        }
    }
    Ok(db::DEFAULT_DUPLICATE_LINES)
}

#[tauri::command]
pub fn folders_set_duplicate_min_lines(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    count: i64,
) -> AppResult<()> {
    {
        let conn = state.db.lock();
        db::set_setting(
            &conn,
            &db::duplicate_min_lines_key(id),
            &count.max(3).to_string(),
        )?;
    }
    enqueue_folder_scan(
        app,
        id,
        ScanOptions {
            detect_duplicates: Some(true),
            ..Default::default()
        },
    );
    Ok(())
}

#[tauri::command]
pub fn folders_get_duplicate_rules(state: State<'_, AppState>, id: i64) -> AppResult<FolderRules> {
    let conn = state.db.lock();
    if let Some(raw) = db::get_setting(&conn, &db::duplicate_rules_key(id))? {
        if let Ok(rules) = serde_json::from_str::<FolderRules>(&raw) {
            return Ok(normalize_rules(rules));
        }
    }
    Ok(FolderRules::default())
}

#[tauri::command]
pub fn folders_set_duplicate_rules(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    rules: FolderRules,
) -> AppResult<FolderRules> {
    let normalized = normalize_rules(rules);
    {
        let conn = state.db.lock();
        db::set_setting(
            &conn,
            &db::duplicate_rules_key(id),
            &serde_json::to_string(&normalized)?,
        )?;
    }
    enqueue_folder_scan(
        app,
        id,
        ScanOptions {
            detect_duplicates: Some(true),
            ..Default::default()
        },
    );
    Ok(normalized)
}
