use crate::watch::SharedWatchManager;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Clone)]
pub struct PendingTreeContext {
    pub display_name: String,
    pub rel_path: String,
    pub abs_path: PathBuf,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub cancel: Arc<AtomicBool>,
    pub scanning: AtomicBool,
    pub pending_ctx: Mutex<BTreeMap<u64, PendingTreeContext>>,
    pub menu_sequence: AtomicU64,
    pub git_requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub data_revision: AtomicU64,
    pub analysis_cache: Mutex<HashMap<i64, (u64, Arc<crate::analysis::AnalysisSnapshot>)>>,
    pub watchers: SharedWatchManager,
}

impl AppState {
    pub fn new(conn: Connection, watchers: SharedWatchManager) -> Self {
        Self {
            db: Mutex::new(conn),
            cancel: Arc::new(AtomicBool::new(false)),
            scanning: AtomicBool::new(false),
            pending_ctx: Mutex::new(BTreeMap::new()),
            menu_sequence: AtomicU64::new(1),
            git_requests: Mutex::new(HashMap::new()),
            data_revision: AtomicU64::new(0),
            analysis_cache: Mutex::new(HashMap::new()),
            watchers,
        }
    }

    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn clear_cancel(&self) {
        self.cancel.store(false, Ordering::SeqCst);
    }

    pub fn register_tree_context(&self, context: PendingTreeContext) -> u64 {
        let id = self.menu_sequence.fetch_add(1, Ordering::Relaxed);
        let mut contexts = self.pending_ctx.lock();
        // Dismissed native menus do not emit an action. Bound retained contexts
        // without ever letting an old menu act on a newer menu's path.
        if contexts.len() >= 64 {
            if let Some(oldest) = contexts.keys().next().copied() {
                contexts.remove(&oldest);
            }
        }
        contexts.insert(id, context);
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::FolderWatchManager;

    #[test]
    fn overlapping_context_menus_keep_their_own_paths() {
        let state = AppState::new(
            Connection::open_in_memory().unwrap(),
            Arc::new(FolderWatchManager::new()),
        );
        let context = |name: &str| PendingTreeContext {
            display_name: name.into(),
            rel_path: name.into(),
            abs_path: PathBuf::from(name),
        };
        let first = state.register_tree_context(context("first"));
        let second = state.register_tree_context(context("second"));
        assert_ne!(first, second);
        assert_eq!(
            state.pending_ctx.lock().remove(&first).unwrap().rel_path,
            "first"
        );
        assert_eq!(
            state.pending_ctx.lock().remove(&second).unwrap().rel_path,
            "second"
        );
        assert!(state.pending_ctx.lock().remove(&first).is_none());
    }

    #[test]
    fn dismissed_contexts_are_bounded_and_never_reused() {
        let state = AppState::new(
            Connection::open_in_memory().unwrap(),
            Arc::new(FolderWatchManager::new()),
        );
        let mut first = None;
        for _ in 0..65 {
            let id = state.register_tree_context(PendingTreeContext {
                display_name: "file".into(),
                rel_path: "file".into(),
                abs_path: PathBuf::from("file"),
            });
            first.get_or_insert(id);
        }
        let contexts = state.pending_ctx.lock();
        assert_eq!(contexts.len(), 64);
        assert!(!contexts.contains_key(&first.unwrap()));
    }
}
