use crate::db;
use crate::error::{AppError, AppResult};
use crate::git;
use crate::state::AppState;
use crate::types::{GitFileInfo, GitRepoInfo};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn git_file_info(
    state: State<'_, AppState>,
    folder_id: i64,
    rel_path: String,
    request_id: Option<String>,
) -> AppResult<Option<GitFileInfo>> {
    let root = {
        let conn = state.db.lock();
        PathBuf::from(db::folder_root(&conn, folder_id)?)
    };
    crate::scan::walk::ensure_inside_root(&root, &rel_path).map_err(AppError::msg)?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(id) = request_id.as_ref() {
        let mut requests = state.git_requests.lock();
        if requests.len() >= 64 && !requests.contains_key(id) {
            return Err(AppError::msg("Too many Git metadata requests"));
        }
        if let Some(previous) = requests.insert(id.clone(), Arc::clone(&cancel)) {
            previous.store(true, Ordering::Release);
        }
    }
    let worker_cancel = Arc::clone(&cancel);
    let result = tauri::async_runtime::spawn_blocking(move || {
        git::get_git_file_info(&root, &rel_path, Some(&worker_cancel))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()));
    if let Some(id) = request_id.as_ref() {
        let mut requests = state.git_requests.lock();
        if requests
            .get(id)
            .is_some_and(|active| Arc::ptr_eq(active, &cancel))
        {
            requests.remove(id);
        }
    }
    if cancel.load(Ordering::Acquire) {
        return Ok(None);
    }
    result?
}

#[tauri::command]
pub fn git_cancel_file_info(state: State<'_, AppState>, request_id: String) {
    if let Some(cancel) = state.git_requests.lock().get(&request_id) {
        cancel.store(true, Ordering::Release);
    }
}

#[tauri::command]
pub async fn git_repo_info(
    state: State<'_, AppState>,
    folder_id: i64,
) -> AppResult<Option<GitRepoInfo>> {
    let root = {
        let conn = state.db.lock();
        PathBuf::from(db::folder_root(&conn, folder_id)?)
    };
    tauri::async_runtime::spawn_blocking(move || git::get_git_repo_info(&root))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}
