mod analysis;
mod commands;
mod db;
mod error;
mod git;
mod parsers;
mod scan;
mod state;
mod stats;
mod types;
mod watch;

use db::open_db;
use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use watch::FolderWatchManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let conn = open_db(&data_dir).map_err(|e| e.to_string())?;
            let watchers = Arc::new(FolderWatchManager::new());
            app.manage(AppState::new(conn, watchers));
            commands::scan::init_scan_scheduler(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| {
            commands::system::handle_menu_event(&app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            commands::folders::folders_add,
            commands::folders::folders_add_git_repositories,
            commands::folders::folders_list,
            commands::folders::folders_relocate,
            commands::folders::folders_remove,
            commands::folders::folders_get_rules,
            commands::folders::folders_set_rules,
            commands::folders::folders_get_duplicate_min_lines,
            commands::folders::folders_set_duplicate_min_lines,
            commands::folders::folders_get_duplicate_rules,
            commands::folders::folders_set_duplicate_rules,
            commands::scan::scan_run,
            commands::scan::scan_cancel,
            commands::settings::settings_get_global_rules,
            commands::settings::settings_set_global_rules,
            commands::stats::stats_summary,
            commands::stats::stats_tree,
            commands::stats::stats_top_files,
            commands::stats::stats_top_functions,
            commands::stats::stats_api_routes,
            commands::stats::stats_file_relations,
            commands::stats::stats_laravel_schema,
            commands::stats::stats_tags,
            commands::stats::stats_file_tags,
            commands::stats::stats_heatmap,
            commands::stats::stats_duplicates,
            commands::file::file_read,
            commands::file::file_write,
            commands::file::file_meta,
            commands::git::git_file_info,
            commands::git::git_repo_info,
            commands::system::system_open_external,
            commands::system::system_show_tree_node_context_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
