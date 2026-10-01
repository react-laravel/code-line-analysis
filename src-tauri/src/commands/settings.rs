use crate::commands::folders::{get_global_rules, normalize_rules};
use crate::commands::scan::enqueue_folder_scan;
use crate::db;
use crate::error::AppResult;
use crate::state::AppState;
use crate::types::{FolderRules, ScanOptions};
use tauri::{AppHandle, State};

pub fn get_detect_duplicates(conn: &rusqlite::Connection) -> AppResult<bool> {
    Ok(db::get_setting(conn, db::DETECT_DUPLICATES_KEY)?
        .and_then(|value| value.parse::<bool>().ok())
        .unwrap_or(true))
}

#[tauri::command]
pub fn settings_get_detect_duplicates(state: State<'_, AppState>) -> AppResult<bool> {
    get_detect_duplicates(&state.db.lock())
}

#[tauri::command]
pub fn settings_set_detect_duplicates(state: State<'_, AppState>, enabled: bool) -> AppResult<()> {
    db::set_setting(
        &state.db.lock(),
        db::DETECT_DUPLICATES_KEY,
        &enabled.to_string(),
    )
}

#[tauri::command]
pub fn settings_get_global_rules(state: State<'_, AppState>) -> AppResult<FolderRules> {
    let conn = state.db.lock();
    get_global_rules(&conn)
}

#[tauri::command]
pub fn settings_set_global_rules(
    app: AppHandle,
    state: State<'_, AppState>,
    rules: FolderRules,
) -> AppResult<FolderRules> {
    let normalized = normalize_rules(rules);
    let folder_ids: Vec<i64> = {
        let conn = state.db.lock();
        db::set_setting(
            &conn,
            db::GLOBAL_RULES_KEY,
            &serde_json::to_string(&normalized)?,
        )?;
        let mut stmt = conn.prepare("SELECT id FROM folders")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.flatten().collect()
    };
    for id in folder_ids {
        enqueue_folder_scan(app.clone(), id, ScanOptions::default());
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_duplicate_preference_defaults_to_true_and_persists_false() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .unwrap();
        assert!(get_detect_duplicates(&conn).unwrap());
        db::set_setting(&conn, db::DETECT_DUPLICATES_KEY, "false").unwrap();
        assert!(!get_detect_duplicates(&conn).unwrap());
    }
}
