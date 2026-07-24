use crate::watch::SharedWatchManager;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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
    pub pending_ctx: Mutex<Option<PendingTreeContext>>,
    pub watchers: SharedWatchManager,
}

impl AppState {
    pub fn new(conn: Connection, watchers: SharedWatchManager) -> Self {
        Self {
            db: Mutex::new(conn),
            cancel: Arc::new(AtomicBool::new(false)),
            scanning: AtomicBool::new(false),
            pending_ctx: Mutex::new(None),
            watchers,
        }
    }

    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn clear_cancel(&self) {
        self.cancel.store(false, Ordering::SeqCst);
    }
}
