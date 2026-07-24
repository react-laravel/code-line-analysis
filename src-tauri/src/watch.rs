use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

use crate::commands::scan::enqueue_folder_scan;
use crate::types::ScanOptions;

struct WatchSession {
    _debouncer: Debouncer<RecommendedWatcher>,
}

pub struct FolderWatchManager {
    sessions: Mutex<HashMap<i64, WatchSession>>,
}

impl FolderWatchManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(self: &Arc<Self>, app: AppHandle, folder_id: i64, root: PathBuf) {
        self.stop(folder_id);
        if !root.is_dir() {
            return;
        }

        let app_cb = app.clone();
        let root_cb = root.clone();
        let this = Arc::clone(self);
        let mut debouncer = match new_debouncer(Duration::from_millis(900), move |result: DebounceEventResult| {
            let Ok(events) = result else {
                log::warn!("folder watch error for {folder_id}; stopping watcher");
                this.stop(folder_id);
                return;
            };
            let mut should_scan = false;
            for event in events {
                if should_ignore_watched_path(&event.path, &root_cb) {
                    continue;
                }
                should_scan = true;
                break;
            }
            if !should_scan {
                return;
            }
            enqueue_folder_scan(
                app_cb.clone(),
                folder_id,
                ScanOptions {
                    detect_duplicates: Some(true),
                    ..Default::default()
                },
            );
        }) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("folder watch start failed for {folder_id}: {e}");
                return;
            }
        };

        if let Err(e) = debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
            log::warn!("watch {root:?} failed: {e}");
            return;
        }

        self.sessions.lock().insert(
            folder_id,
            WatchSession {
                _debouncer: debouncer,
            },
        );
    }

    pub fn stop(&self, folder_id: i64) {
        self.sessions.lock().remove(&folder_id);
    }

    pub fn refresh_all(self: &Arc<Self>, app: &AppHandle, folders: &[(i64, String)]) {
        let active: std::collections::HashSet<i64> = folders.iter().map(|(id, _)| *id).collect();
        {
            let mut sessions = self.sessions.lock();
            let stale: Vec<i64> = sessions
                .keys()
                .copied()
                .filter(|id| !active.contains(id))
                .collect();
            for id in stale {
                sessions.remove(&id);
            }
        }
        for (id, root) in folders {
            self.start(app.clone(), *id, PathBuf::from(root));
        }
    }
}

pub type SharedWatchManager = Arc<FolderWatchManager>;

fn should_ignore_watched_path(path: &Path, root: &Path) -> bool {
    let rel = path
        .strip_prefix(root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| path.to_string_lossy().replace('\\', "/"));
    if rel.is_empty() {
        return true;
    }
    let normalized = rel.as_str();
    let ignore_segments = [
        ".git",
        "node_modules",
        "dist",
        "build",
        ".idea",
        ".vscode",
        "target",
        "vendor",
    ];
    if normalized.split('/').any(|s| ignore_segments.contains(&s)) {
        return true;
    }
    if normalized.ends_with(".min.js") || normalized.ends_with(".min.css") {
        return true;
    }
    if normalized.ends_with(".lock")
        || normalized.ends_with("package-lock.json")
        || normalized.ends_with("yarn.lock")
        || normalized.ends_with("pnpm-lock.yaml")
    {
        return true;
    }
    false
}
