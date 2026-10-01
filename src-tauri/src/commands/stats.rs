use crate::analysis::{
    build_api_route_overview, build_file_relation_graph, build_laravel_schema_graph, load_source_files, source_rows, AnalysisSnapshot,
};
use crate::db;
use crate::error::AppResult;
use crate::git;
use crate::state::AppState;
use crate::stats;
use crate::types::*;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn stats_summary(state: State<'_, AppState>, folder_id: i64) -> AppResult<FolderStats> {
    let conn = state.db.lock();
    stats::summary_for_folder(&conn, folder_id)
}

#[tauri::command]
pub fn stats_tree(state: State<'_, AppState>, folder_id: i64, expanded_paths: Option<Vec<String>>) -> AppResult<DirNode> {
    let rows = { let conn = state.db.lock(); stats::tree_rows(&conn, folder_id)? };
    let expanded = expanded_paths.map(|paths| paths.into_iter().collect());
    Ok(stats::build_tree(rows, expanded.as_ref()))
}

#[tauri::command]
pub fn stats_files_page(state: State<'_, AppState>, folder_id: i64, offset: Option<i64>, limit: Option<i64>) -> AppResult<serde_json::Value> {
    let (rows, total, revision) = {
        let conn = state.db.lock();
        let (rows, total) = stats::get_files_page(&conn, folder_id, offset.unwrap_or(0), limit.unwrap_or(1000))?;
        (rows, total, state.data_revision.load(std::sync::atomic::Ordering::Relaxed))
    };
    Ok(serde_json::json!({ "rows": rows, "total": total, "revision": revision }))
}

#[tauri::command]
pub async fn stats_file_dates(app: tauri::AppHandle, folder_id: i64) -> AppResult<serde_json::Value> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        type Dates = std::collections::HashMap<String, i64>;
        type DateCache = std::collections::HashMap<i64, (u64, PathBuf, std::time::Instant, Dates)>;
        static CACHE: once_cell::sync::Lazy<parking_lot::Mutex<DateCache>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(std::collections::HashMap::new()));
        let state = app.state::<AppState>();
        let (revision, root, paths) = {
            let conn = state.db.lock();
            let revision = state.data_revision.load(std::sync::atomic::Ordering::Relaxed);
            let root = PathBuf::from(db::folder_root(&conn, folder_id)?);
            (revision, root, source_rows(&conn, folder_id)?.into_iter().map(|r| r.0).collect::<Vec<_>>())
        };
        if let Some((cached_revision, cached_root, at, dates)) = CACHE.lock().get(&folder_id) {
            if *cached_revision == revision && *cached_root == root && at.elapsed().as_secs() < 30 { return Ok(serde_json::json!({ "dates": dates, "revision": revision })); }
        }
        let dates = git::get_git_last_dates(&root, &paths);
        if state.data_revision.load(std::sync::atomic::Ordering::Relaxed) == revision {
            let mut cache = CACHE.lock();
            if cache.len() >= 3 { cache.clear(); }
            cache.insert(folder_id, (revision, root, std::time::Instant::now(), dates.clone()));
        }
        let current_revision = state.data_revision.load(std::sync::atomic::Ordering::Relaxed);
        Ok(serde_json::json!({ "dates": dates, "revision": if current_revision == revision { revision } else { u64::MAX } }))
    }).await.map_err(|e| crate::error::AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn stats_top_files(
    state: State<'_, AppState>,
    folder_id: i64,
    limit: Option<i64>,
    sort_by: Option<String>,
) -> AppResult<Vec<TopFile>> {
    let sort_by = sort_by.unwrap_or_else(|| "total".into());
    let (mut rows, root) = {
        let conn = state.db.lock();
        let limit = limit.unwrap_or(50);
        let rows = stats::get_top_files(&conn, folder_id, limit, &sort_by)?;
        let root = db::folder_root(&conn, folder_id).ok().map(PathBuf::from);
        (rows, root)
    };

    if let Some(root) = root {
        // One batched git log for all rows, off-thread so a large history
        // never blocks the IPC/main thread.
        let rel_paths: Vec<String> = rows.iter().map(|r| r.rel_path.clone()).collect();
        let dates =
            tauri::async_runtime::spawn_blocking(move || git::get_git_last_dates(&root, &rel_paths))
                .await
                .unwrap_or_default();
        for row in &mut rows {
            row.last_commit_date = dates.get(&row.rel_path).copied();
        }
        if sort_by == "lastCommitDate" {
            rows.sort_by(|a, b| b.last_commit_date.cmp(&a.last_commit_date));
        }
    }
    Ok(rows)
}

#[tauri::command]
pub fn stats_top_functions(
    state: State<'_, AppState>,
    folder_id: i64,
    limit: Option<i64>,
) -> AppResult<Vec<TopFunction>> {
    let conn = state.db.lock();
    stats::get_top_functions(&conn, folder_id, limit.unwrap_or(50))
}

fn analysis_snapshot(state: &AppState, folder_id: i64) -> AppResult<std::sync::Arc<AnalysisSnapshot>> {
    use std::sync::{Arc, atomic::Ordering};
    static BUILD_LOCK: once_cell::sync::Lazy<parking_lot::Mutex<()>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(()));
    let _building = BUILD_LOCK.lock();
    let (revision, root, rows) = {
        let conn = state.db.lock();
        let revision = state.data_revision.load(Ordering::Relaxed);
        if let Some((cached_revision, snapshot)) = state.analysis_cache.lock().get(&folder_id) {
            if *cached_revision == revision { return Ok(snapshot.clone()); }
        }
        (revision, PathBuf::from(db::folder_root(&conn, folder_id)?), source_rows(&conn, folder_id)?)
    };
    let files = load_source_files(rows, &root);
    let snapshot = Arc::new(AnalysisSnapshot {
        routes: build_api_route_overview(&files),
        relations: build_file_relation_graph(&files),
        schema: build_laravel_schema_graph(&files),
    });
    if state.data_revision.load(Ordering::Relaxed) == revision {
        let mut cache = state.analysis_cache.lock();
        if cache.len() >= 3 { cache.clear(); }
        cache.insert(folder_id, (revision, snapshot.clone()));
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn stats_api_routes(app: tauri::AppHandle, folder_id: i64) -> AppResult<ApiRouteOverview> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || Ok(analysis_snapshot(&app.state::<AppState>(), folder_id)?.routes.clone())).await
        .map_err(|e| crate::error::AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn stats_file_relations(app: tauri::AppHandle, folder_id: i64) -> AppResult<FileRelationGraph> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || Ok(analysis_snapshot(&app.state::<AppState>(), folder_id)?.relations.clone())).await
        .map_err(|e| crate::error::AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn stats_laravel_schema(app: tauri::AppHandle, folder_id: i64) -> AppResult<LaravelSchemaGraph> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || Ok(analysis_snapshot(&app.state::<AppState>(), folder_id)?.schema.clone())).await
        .map_err(|e| crate::error::AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn stats_tags(state: State<'_, AppState>, folder_id: i64, kind: Option<String>) -> AppResult<Vec<TagRow>> {
    let conn = state.db.lock();
    stats::get_tags(&conn, folder_id, kind.as_deref())
}

#[tauri::command]
pub fn stats_file_tags(state: State<'_, AppState>, folder_id: i64, rel_path: String) -> AppResult<Vec<TagRow>> {
    let conn = state.db.lock();
    stats::get_file_tags(&conn, folder_id, &rel_path)
}

#[tauri::command]
pub async fn stats_heatmap(app: tauri::AppHandle, folder_id: i64, days: Option<i64>) -> AppResult<Vec<HeatmapBucket>> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let days = days.unwrap_or(30).clamp(1, 3660);
        let root = { let conn = state.db.lock(); PathBuf::from(db::folder_root(&conn, folder_id)?) };
        let buckets = git::get_git_heatmap(&root, days)?;
        if !buckets.is_empty() { return Ok(buckets); }
        let result = stats::get_heatmap_from_mtime(&state.db.lock(), folder_id, days);
        result
    }).await.map_err(|e| crate::error::AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn stats_duplicates(state: State<'_, AppState>, folder_id: i64) -> AppResult<Vec<DuplicateCluster>> {
    let rows = { let conn = state.db.lock(); stats::duplicate_rows(&conn, folder_id)? };
    Ok(stats::build_duplicates(rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::Ordering};

    #[test]
    fn architecture_lenses_share_a_snapshot_and_committed_changes_invalidate_it() {
        let root = std::env::temp_dir().join(format!("cla-analysis-cache-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("a.ts"), "import './b';").unwrap();
        std::fs::write(root.join("b.ts"), "export const b = 1;").unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE folders(id INTEGER PRIMARY KEY, root_path TEXT); CREATE TABLE files(folder_id INTEGER, rel_path TEXT, lang TEXT, total INTEGER, code INTEGER, deleted INTEGER); INSERT INTO files VALUES(1,'a.ts','TypeScript',1,1,0),(1,'b.ts','TypeScript',1,1,0);").unwrap();
        conn.execute("INSERT INTO folders VALUES(1,?)", [root.to_str().unwrap()]).unwrap();
        let state = AppState::new(conn, Arc::new(crate::watch::FolderWatchManager::new()));
        let first = analysis_snapshot(&state, 1).unwrap();
        assert_eq!(first.relations.connected_files, 2);
        assert!(Arc::ptr_eq(&first, &analysis_snapshot(&state, 1).unwrap()));
        std::fs::write(root.join("a.ts"), "export const a = 1;").unwrap();
        state.data_revision.fetch_add(1, Ordering::Relaxed);
        let next = analysis_snapshot(&state, 1).unwrap();
        assert!(!Arc::ptr_eq(&first, &next));
        assert_eq!(next.relations.connected_files, 0);
        std::fs::remove_dir_all(root).unwrap();
    }
}
