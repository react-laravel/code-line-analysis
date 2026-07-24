use crate::commands::folders::{get_folder_rules, get_global_rules, resolve_rules};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::scan::scan_folder;
use crate::state::AppState;
use crate::types::{FolderStats, ScanOptions, ScanProgress};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, State};

enum ScanJob {
    Run {
        folder_id: i64,
        opts: ScanOptions,
        reply: Option<Sender<AppResult<FolderStats>>>,
    },
}

struct ScanScheduler {
    tx: Sender<ScanJob>,
}

static SCHEDULER: OnceLock<ScanScheduler> = OnceLock::new();

pub fn init_scan_scheduler(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<ScanJob>();
    let worker_app = app.clone();
    std::thread::Builder::new()
        .name("cla-scan-queue".into())
        .spawn(move || {
            while let Ok(job) = rx.recv() {
                match job {
                    ScanJob::Run {
                        folder_id,
                        opts,
                        reply,
                    } => {
                        let Some(state) = worker_app.try_state::<AppState>() else {
                            if let Some(reply) = reply {
                                let _ = reply.send(Err(AppError::msg("App state unavailable")));
                            }
                            continue;
                        };
                        let result = perform_scan(&worker_app, state.inner(), folder_id, opts);
                        match &result {
                            Ok(_) => log::info!("scan finished for folder {folder_id}"),
                            Err(e) => log::warn!("scan failed for folder {folder_id}: {e}"),
                        }
                        if let Some(reply) = reply {
                            let _ = reply.send(result);
                        }
                    }
                }
            }
        })
        .expect("spawn scan queue worker");

    let _ = SCHEDULER.set(ScanScheduler { tx });
}

fn scheduler() -> &'static ScanScheduler {
    SCHEDULER
        .get()
        .expect("scan scheduler not initialized")
}

pub fn perform_scan(
    app: &AppHandle,
    state: &AppState,
    folder_id: i64,
    mut opts: ScanOptions,
) -> AppResult<FolderStats> {
    // Serial queue guarantees exclusivity; still set flag for UI/cancel coordination.
    state.scanning.store(true, Ordering::SeqCst);
    let result = (|| {
        let cancel = state.cancel.clone();
        state.clear_cancel();

        let (root, rules, dup_min, dup_rules) = {
            let conn = state.db.lock();
            let root = db::folder_root(&conn, folder_id)?;
            let global = get_global_rules(&conn)?;
            let folder = get_folder_rules(&conn, folder_id)?;
            let rules = resolve_rules(global, folder);
            let dup_min = db::get_setting(&conn, &db::duplicate_min_lines_key(folder_id))?
                .and_then(|v| v.parse().ok())
                .filter(|&n: &i64| n >= 3)
                .unwrap_or(db::DEFAULT_DUPLICATE_LINES);
            let dup_rules = db::get_setting(&conn, &db::duplicate_rules_key(folder_id))?
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or_default();
            (root, rules, dup_min, dup_rules)
        };

        opts.duplicate_min_lines = Some(opts.duplicate_min_lines.unwrap_or(dup_min));
        if opts.detect_duplicates.is_none() {
            opts.detect_duplicates = Some(true);
        }
        if opts.duplicate_rules.is_none() {
            opts.duplicate_rules = Some(dup_rules);
        }

        let app2 = app.clone();
        let on_progress: crate::scan::engine::ProgressCb = Box::new(move |p: ScanProgress| {
            let _ = app2.emit("scan:progress", p);
        });

        scan_folder(
            &state.db,
            folder_id,
            &PathBuf::from(root),
            &rules,
            &opts,
            cancel,
            on_progress,
        )
    })();
    state.scanning.store(false, Ordering::SeqCst);
    result
}

/// Fire-and-forget scan used by folder watchers / rule changes.
pub fn enqueue_folder_scan(app: AppHandle, folder_id: i64, opts: ScanOptions) {
    let _ = app;
    let _ = scheduler().tx.send(ScanJob::Run {
        folder_id,
        opts,
        reply: None,
    });
}

#[tauri::command]
pub fn scan_run(
    app: AppHandle,
    folder_id: i64,
    opts: Option<ScanOptions>,
) -> AppResult<FolderStats> {
    let _ = app;
    let (reply_tx, reply_rx) = mpsc::channel();
    scheduler()
        .tx
        .send(ScanJob::Run {
            folder_id,
            opts: opts.unwrap_or_default(),
            reply: Some(reply_tx),
        })
        .map_err(|_| AppError::msg("Scan queue unavailable"))?;
    reply_rx
        .recv()
        .map_err(|_| AppError::msg("Scan worker disconnected"))?
}

#[tauri::command]
pub fn scan_cancel(state: State<'_, AppState>) -> AppResult<()> {
    state.request_cancel();
    Ok(())
}
