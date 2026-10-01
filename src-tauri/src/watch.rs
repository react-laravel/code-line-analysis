use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

use crate::commands::scan::enqueue_folder_scan;
use crate::scan::filters::is_excluded_asset_path;
use crate::types::ScanOptions;

struct WatchSession {
    root: PathBuf,
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
        let mut debouncer = match new_debouncer(
            Duration::from_millis(900),
            move |result: DebounceEventResult| {
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
                enqueue_folder_scan(app_cb.clone(), folder_id, ScanOptions::default());
            },
        ) {
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
                root,
                _debouncer: debouncer,
            },
        );
    }

    pub fn stop(&self, folder_id: i64) {
        self.sessions.lock().remove(&folder_id);
    }

    pub fn refresh_all(self: &Arc<Self>, app: &AppHandle, folders: &[(i64, String)]) {
        let active: std::collections::HashSet<i64> = folders.iter().map(|(id, _)| *id).collect();
        // Idempotent: only (re)start sessions that are missing or whose root changed
        // (folders_relocate). Restarting live sessions would drop the Debouncer and any
        // events pending inside its debounce window.
        let mut to_start: Vec<(i64, PathBuf)> = Vec::new();
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
            for (id, root) in folders {
                let root = PathBuf::from(root);
                match sessions.get(id) {
                    Some(session) if session.root == root => {}
                    _ => to_start.push((*id, root)),
                }
            }
        }
        for (id, root) in to_start {
            self.start(app.clone(), id, root);
        }
    }
}

pub type SharedWatchManager = Arc<FolderWatchManager>;

fn should_ignore_watched_path(path: &Path, root: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return true;
    };
    let rel = relative.to_string_lossy().replace('\\', "/");
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
    // An exclusion edit changes the scan's candidate set even though .git
    // itself is not scanned.
    if normalized == ".git/info/exclude" {
        return false;
    }
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

    let parts: Vec<_> = relative.components().collect();
    let ignore_file = matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".gitignore" | ".ignore")
    );
    if parts.iter().enumerate().any(|(index, part)| {
        part.as_os_str().to_string_lossy().starts_with('.')
            && !(ignore_file && index + 1 == parts.len())
    }) {
        return true;
    }
    if !path.is_dir() && is_excluded_asset_path(normalized) {
        return true;
    }

    // Match top-down, just like walking the scan candidates. Checking only
    // the leaf would let a child's negation resurrect an ignored parent.
    let mut rules = WatchIgnoreRules::default();
    for directory in root.ancestors().collect::<Vec<_>>().into_iter().rev() {
        rules.enter(directory);
    }
    let mut current = root.to_path_buf();
    for (index, part) in parts.iter().enumerate() {
        current.push(part.as_os_str());
        let last = index + 1 == parts.len();
        if last && ignore_file {
            return false;
        }
        if rules.ignored(&current, !last || path.is_dir()) {
            return true;
        }
        if !last {
            rules.enter(&current);
        }
    }
    false
}

#[derive(Default)]
struct WatchIgnoreRules {
    ignores: Vec<Gitignore>,
    gitignores: Vec<Gitignore>,
    excludes: Vec<Gitignore>,
    in_repo: bool,
}

impl WatchIgnoreRules {
    fn load(into: &mut Vec<Gitignore>, root: &Path, file: &Path) {
        if !file.is_file() {
            return;
        }
        let mut builder = GitignoreBuilder::new(root);
        let _ = builder.add(file);
        if let Ok(matcher) = builder.build() {
            into.push(matcher);
        }
    }

    fn enter(&mut self, directory: &Path) {
        let dot_git = directory.join(".git");
        if dot_git.exists() {
            self.in_repo = true;
            self.gitignores.clear();
            self.excludes.clear();
            let git_dir = if dot_git.is_file() {
                std::fs::read_to_string(&dot_git).ok().and_then(|content| {
                    content
                        .trim()
                        .strip_prefix("gitdir: ")
                        .map(|path| directory.join(path))
                })
            } else {
                Some(dot_git)
            };
            if let Some(git_dir) = git_dir {
                Self::load(&mut self.excludes, directory, &git_dir.join("info/exclude"));
            }
        }
        Self::load(
            &mut self.gitignores,
            directory,
            &directory.join(".gitignore"),
        );
        Self::load(&mut self.ignores, directory, &directory.join(".ignore"));
    }

    fn ignored(&self, path: &Path, is_dir: bool) -> bool {
        // .ignore has priority over .gitignore, then local Git exclusions.
        // Within a class the closest directory wins. No global Git rules:
        // walk_folder deliberately uses git_global(false).
        for (index, rules) in [&self.ignores, &self.gitignores, &self.excludes]
            .into_iter()
            .enumerate()
        {
            if !self.in_repo && index > 0 {
                continue;
            }
            for matcher in rules.iter().rev() {
                let matched = matcher.matched(path, is_dir);
                if !matched.is_none() {
                    return matched.is_ignore();
                }
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::should_ignore_watched_path;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_DIR: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "cla-watch-{}-{}",
                std::process::id(),
                NEXT_DIR.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(root.join(".git/info")).unwrap();
            Self(root.canonicalize().unwrap())
        }

        fn write(&self, rel: &str, contents: &str) {
            let path = self.0.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }

        fn ignored(&self, rel: &str) -> bool {
            should_ignore_watched_path(&self.0.join(rel), &self.0)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn ignored_runtime_updates_do_not_schedule_scans() {
        let dir = Fixture::new();
        dir.write("companion/.gitignore", "state/\n");
        dir.write("companion/state/observer-status.json", "{}");
        dir.write("companion/state/skills.sqlite3-wal", "data");
        for _ in 0..20 {
            assert!(dir.ignored("companion/state/observer-status.json"));
            assert!(dir.ignored("companion/state/skills.sqlite3-wal"));
        }
    }

    #[test]
    fn gitignore_negations_and_parent_directories_are_respected() {
        let dir = Fixture::new();
        dir.write(".gitignore", "generated/*\n!generated/keep.ts\ncache/\n");
        dir.write("generated/keep.ts", "export {};");
        dir.write("cache/.gitignore", "!keep.ts\n");
        assert!(!dir.ignored("generated/keep.ts"));
        assert!(dir.ignored("generated/remove.ts"));
        assert!(dir.ignored("cache/keep.ts"));
        // Deleted paths must still be ignored without requiring metadata.
        assert!(dir.ignored("generated/deleted.json"));
    }

    #[test]
    fn source_deletions_and_ignore_rule_edits_still_trigger_scans() {
        let dir = Fixture::new();
        assert!(!dir.ignored("src/deleted.ts"));
        assert!(!dir.ignored(".gitignore"));
        assert!(!dir.ignored(".ignore"));
        assert!(!dir.ignored(".git/info/exclude"));
        dir.write(".gitignore", "state/\n");
        assert!(dir.ignored("state/output.json"));
        dir.write(".gitignore", "");
        assert!(!dir.ignored("state/output.json"));
    }

    #[test]
    fn scan_exclusions_also_apply_to_watch_events() {
        let dir = Fixture::new();
        for path in [
            "logs/latest.log",
            ".next/server/app.js",
            ".cache/result.json",
            "node_modules/a/index.js",
            "assets/image.png",
        ] {
            assert!(dir.ignored(path), "{path}");
        }
        assert!(!dir.ignored("src/index.ts"));
    }

    #[test]
    fn ignore_files_override_gitignore_and_local_excludes_are_honored() {
        let dir = Fixture::new();
        dir.write(".ignore", "state/\n");
        dir.write("sub/.gitignore", "!state/\n");
        dir.write(".git/info/exclude", "private/\n");
        assert!(dir.ignored("sub/state/output.json"));
        assert!(dir.ignored("private/generated.ts"));
    }

    #[test]
    fn native_watcher_ignores_runtime_writes_but_observes_source_edits() {
        use notify::RecursiveMode;
        use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
        use std::sync::mpsc;
        use std::time::Duration;

        let dir = Fixture::new();
        dir.write("companion/.gitignore", "state/\n");
        dir.write("companion/state/observer-status.json", "{}");
        dir.write("src/index.ts", "export const value = 0;");
        let root = dir.0.clone();
        let (tx, rx) = mpsc::channel();
        let mut watcher = new_debouncer(
            Duration::from_millis(100),
            move |events: DebounceEventResult| {
                let events = events.unwrap();
                for event in events {
                    if !should_ignore_watched_path(&event.path, &root) {
                        let _ = tx.send(event.path);
                    }
                }
            },
        )
        .unwrap();
        watcher
            .watcher()
            .watch(&dir.0, RecursiveMode::Recursive)
            .unwrap();

        for value in 0..5 {
            dir.write(
                "companion/state/observer-status.json",
                &format!("{{\"tick\":{value}}}"),
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(
            rx.recv_timeout(Duration::from_millis(500)).is_err(),
            "ignored writes scheduled a scan"
        );
        dir.write("src/index.ts", "export const value = 1;");
        let changed = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("source edit should schedule a scan");
        assert_eq!(changed, dir.0.join("src/index.ts"));
    }
}
