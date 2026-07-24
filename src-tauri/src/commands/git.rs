use crate::db;
use crate::error::AppResult;
use crate::git;
use crate::state::AppState;
use crate::types::{GitFileInfo, GitRepoInfo};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn git_file_info(
    state: State<'_, AppState>,
    folder_id: i64,
    rel_path: String,
) -> AppResult<Option<GitFileInfo>> {
    let conn = state.db.lock();
    let root = PathBuf::from(db::folder_root(&conn, folder_id)?);
    drop(conn);
    git::get_git_file_info(&root, &rel_path)
}

#[tauri::command]
pub fn git_repo_info(state: State<'_, AppState>, folder_id: i64) -> AppResult<Option<GitRepoInfo>> {
    let conn = state.db.lock();
    let root = PathBuf::from(db::folder_root(&conn, folder_id)?);
    drop(conn);
    git::get_git_repo_info(&root)
}
