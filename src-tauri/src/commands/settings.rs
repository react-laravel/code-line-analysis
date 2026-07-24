use crate::commands::folders::{get_global_rules, normalize_rules};
use crate::commands::scan::enqueue_folder_scan;
use crate::db;
use crate::error::AppResult;
use crate::state::AppState;
use crate::types::{FolderRules, ScanOptions};
use tauri::{AppHandle, State};

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
        enqueue_folder_scan(
            app.clone(),
            id,
            ScanOptions {
                detect_duplicates: Some(true),
                ..Default::default()
            },
        );
    }
    Ok(normalized)
}
