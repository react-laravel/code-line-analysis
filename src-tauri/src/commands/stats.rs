use crate::analysis::{
    build_api_route_overview, build_file_relation_graph, build_laravel_schema_graph, load_source_files,
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
pub fn stats_tree(state: State<'_, AppState>, folder_id: i64) -> AppResult<DirNode> {
    let conn = state.db.lock();
    stats::get_tree(&conn, folder_id)
}

#[tauri::command]
pub fn stats_top_files(
    state: State<'_, AppState>,
    folder_id: i64,
    limit: Option<i64>,
    sort_by: Option<String>,
) -> AppResult<Vec<TopFile>> {
    let conn = state.db.lock();
    let limit = limit.unwrap_or(50);
    let sort_by = sort_by.unwrap_or_else(|| "total".into());
    let mut rows = stats::get_top_files(&conn, folder_id, limit, &sort_by)?;
    let root = db::folder_root(&conn, folder_id).ok().map(PathBuf::from);
    drop(conn);

    if let Some(root) = root {
        for row in &mut rows {
            row.last_commit_date = git::get_git_file_last_date(&root, &row.rel_path);
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

#[tauri::command]
pub fn stats_api_routes(state: State<'_, AppState>, folder_id: i64) -> AppResult<ApiRouteOverview> {
    let conn = state.db.lock();
    let root = match db::folder_root(&conn, folder_id) {
        Ok(r) => r,
        Err(_) => {
            return Ok(ApiRouteOverview {
                frameworks: vec![],
                routes: vec![],
                laravel_route_files: 0,
                next_route_files: 0,
                warnings: vec![],
            });
        }
    };
    let files = load_source_files(&conn, folder_id, &PathBuf::from(root))?;
    Ok(build_api_route_overview(&files))
}

#[tauri::command]
pub fn stats_file_relations(state: State<'_, AppState>, folder_id: i64) -> AppResult<FileRelationGraph> {
    let conn = state.db.lock();
    let root = match db::folder_root(&conn, folder_id) {
        Ok(r) => r,
        Err(_) => {
            return Ok(FileRelationGraph {
                nodes: vec![],
                edges: vec![],
                scanned_files: 0,
                connected_files: 0,
                unresolved_count: 0,
            });
        }
    };
    let files = load_source_files(&conn, folder_id, &PathBuf::from(root))?;
    Ok(build_file_relation_graph(&files))
}

#[tauri::command]
pub fn stats_laravel_schema(state: State<'_, AppState>, folder_id: i64) -> AppResult<LaravelSchemaGraph> {
    let conn = state.db.lock();
    let root = match db::folder_root(&conn, folder_id) {
        Ok(r) => r,
        Err(_) => {
            return Ok(LaravelSchemaGraph {
                is_laravel: false,
                detected_by: vec![],
                tables: vec![],
                relations: vec![],
                migration_count: 0,
                model_count: 0,
                unresolved_model_relations: 0,
                warnings: vec![],
            });
        }
    };
    let files = load_source_files(&conn, folder_id, &PathBuf::from(root))?;
    Ok(build_laravel_schema_graph(&files))
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
pub fn stats_heatmap(state: State<'_, AppState>, folder_id: i64, days: Option<i64>) -> AppResult<Vec<HeatmapBucket>> {
    let days = days.unwrap_or(30);
    let conn = state.db.lock();
    let root = match db::folder_root(&conn, folder_id) {
        Ok(r) => PathBuf::from(r),
        Err(_) => return Ok(vec![]),
    };
    // Prefer git heatmap like Electron
    let git_buckets = git::get_git_heatmap(&root, days)?;
    if !git_buckets.is_empty() {
        return Ok(git_buckets);
    }
    stats::get_heatmap_from_mtime(&conn, folder_id, days)
}

#[tauri::command]
pub fn stats_duplicates(state: State<'_, AppState>, folder_id: i64) -> AppResult<Vec<DuplicateCluster>> {
    let conn = state.db.lock();
    let min_lines = db::get_setting(&conn, &db::duplicate_min_lines_key(folder_id))?
        .and_then(|v| v.parse().ok())
        .filter(|&n: &i64| n >= 3)
        .unwrap_or(db::DEFAULT_DUPLICATE_LINES);
    stats::get_duplicates(&conn, folder_id, min_lines)
}
