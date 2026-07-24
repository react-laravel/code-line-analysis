use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, PendingTreeContext};
use crate::types::TreeNodeContextMenuRequest;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::Manager;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn system_open_external(app: AppHandle, url: String) -> AppResult<()> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::msg("Only http/https URLs are allowed"));
    }
    app.opener()
        .open_url(trimmed, None::<&str>)
        .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub fn system_show_tree_node_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: TreeNodeContextMenuRequest,
) -> AppResult<()> {
    let conn = state.db.lock();
    let root = PathBuf::from(db::folder_root(&conn, request.folder_id)?);
    drop(conn);

    let abs_path = if request.rel_path.is_empty() {
        root.clone()
    } else {
        let candidate = root.join(&request.rel_path);
        let abs = candidate.canonicalize().unwrap_or(candidate);
        let root_c = root.canonicalize().unwrap_or(root.clone());
        if abs != root_c && !abs.starts_with(&root_c) {
            return Err(AppError::msg("Path outside folder root rejected"));
        }
        abs
    };

    let rel_path = if request.rel_path.is_empty() {
        ".".to_string()
    } else {
        request.rel_path.clone()
    };

    *state.pending_ctx.lock() = Some(PendingTreeContext {
        display_name: request.display_name.clone(),
        rel_path: rel_path.clone(),
        abs_path: abs_path.clone(),
    });

    let copy_name = MenuItem::with_id(
        &app,
        "ctx-copy-name",
        &request.labels.copy_name,
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::msg(e.to_string()))?;
    let copy_rel = MenuItem::with_id(
        &app,
        "ctx-copy-rel",
        &request.labels.copy_relative_path,
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::msg(e.to_string()))?;
    let copy_abs = MenuItem::with_id(
        &app,
        "ctx-copy-abs",
        &request.labels.copy_absolute_path,
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::msg(e.to_string()))?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| AppError::msg(e.to_string()))?;
    let open_path = MenuItem::with_id(
        &app,
        "ctx-open-path",
        &request.labels.open_path,
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::msg(e.to_string()))?;
    let reveal = MenuItem::with_id(
        &app,
        "ctx-reveal",
        &request.labels.reveal_in_finder,
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::msg(e.to_string()))?;

    let menu = Menu::with_items(
        &app,
        &[&copy_name, &copy_rel, &copy_abs, &sep, &open_path, &reveal],
    )
    .map_err(|e| AppError::msg(e.to_string()))?;

    let x = request.x.unwrap_or(0.0);
    let y = request.y.unwrap_or(0.0);
    window
        .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| AppError::msg(e.to_string()))?;

    Ok(())
}

pub fn handle_menu_event(app: &AppHandle, id: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let pending = state.pending_ctx.lock().clone();
    let Some(ctx) = pending else { return };

    match id {
        "ctx-copy-name" => {
            if let Err(e) = copy_text(&ctx.display_name) {
                show_error(app, "Unable to copy", &e);
            }
        }
        "ctx-copy-rel" => {
            if let Err(e) = copy_text(&ctx.rel_path) {
                show_error(app, "Unable to copy", &e);
            }
        }
        "ctx-copy-abs" => {
            if let Err(e) = copy_text(&ctx.abs_path.to_string_lossy()) {
                show_error(app, "Unable to copy", &e);
            }
        }
        "ctx-open-path" => {
            if let Err(e) = app
                .opener()
                .open_path(ctx.abs_path.to_string_lossy().to_string(), None::<&str>)
            {
                show_error(app, "Unable to open path", &e.to_string());
            }
        }
        "ctx-reveal" => {
            if let Err(e) = app.opener().reveal_item_in_dir(&ctx.abs_path) {
                show_error(app, "Unable to reveal path", &e.to_string());
            }
        }
        _ => {}
    }
}

fn show_error(app: &AppHandle, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

fn copy_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| e.to_string())
}
