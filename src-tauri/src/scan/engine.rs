use crate::db::DEFAULT_DUPLICATE_LINES;
use crate::error::{AppError, AppResult};
use crate::parsers::{
    duplicate::find_duplicate_slices, func_detect::find_functions, languages::detect_lang,
    line_parser::count_lines, tag_scanner::scan_tags,
};
use crate::scan::filters::{is_binary_buffer, is_excluded_asset_path};
use crate::scan::walk::{open_regular_file, walk_folder};
use crate::stats::summary_for_folder;
use crate::types::{FolderRules, FolderStats, ScanOptions, ScanProgress};
use rayon::prelude::*;
use rusqlite::Connection;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub type ProgressCb = Box<dyn Fn(ScanProgress) + Send + Sync>;

const MAX_SCAN_BYTES: u64 = 5 * 1024 * 1024;
// Change this version when duplicate normalization or window construction changes.
const DUPLICATE_CACHE_VERSION: &str = "1";

struct ExistingRow {
    id: i64,
    duplicate_hash: Option<String>,
    duplicate_config: Option<String>,
    size: i64,
    mtime: i64,
    hash: String,
    total: i64,
    code: i64,
    comment: i64,
    blank: i64,
    block_comment: i64,
    lang: String,
    ext: String,
}

struct ParsedFile {
    rel_path: String,
    existing_id: Option<i64>,
    duplicate_config: Option<String>,
    ext: String,
    lang: String,
    size: i64,
    mtime: i64,
    hash: String,
    total: i64,
    code: i64,
    comment: i64,
    blank: i64,
    block_comment: i64,
    tags: Vec<crate::parsers::tag_scanner::FoundTag>,
    functions: Vec<crate::parsers::func_detect::FoundFunction>,
    duplicates: Vec<crate::parsers::duplicate::DupSlice>,
    cached: bool,
    duplicates_refreshed: bool,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn sha1_hex(buf: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(buf);
    hex::encode(h.finalize())
}

fn check_cancel(cancel: &AtomicBool) -> AppResult<()> {
    if cancel.load(Ordering::SeqCst) {
        Err(AppError::Cancelled)
    } else {
        Ok(())
    }
}

fn load_existing_map(
    conn: &Connection,
    folder_id: i64,
) -> AppResult<std::collections::HashMap<String, ExistingRow>> {
    let mut map = std::collections::HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT f.size, f.mtime, f.hash, f.total, f.code, f.comment, f.blank,
                f.block_comment, f.lang, f.ext, f.rel_path, f.id, d.hash, d.config
         FROM files f LEFT JOIN duplicate_cache d ON d.file_id = f.id
         WHERE f.folder_id = ?",
    )?;
    let rows = stmt.query_map([folder_id], |r| {
        Ok((
            r.get::<_, String>(10)?,
            ExistingRow {
                id: r.get(11)?,
                duplicate_hash: r.get(12)?,
                duplicate_config: r.get(13)?,
                size: r.get(0)?,
                mtime: r.get(1)?,
                hash: r.get(2)?,
                total: r.get(3)?,
                code: r.get(4)?,
                comment: r.get(5)?,
                blank: r.get(6)?,
                block_comment: r.get(7)?,
                lang: r.get(8)?,
                ext: r.get(9)?,
            },
        ))
    })?;
    for row in rows {
        let row = row?;
        map.insert(row.0, row.1);
    }
    Ok(map)
}

/// Scan holds the DB mutex only while loading cache rows and while persisting.
pub fn scan_folder(
    db: &parking_lot::Mutex<Connection>,
    folder_id: i64,
    root: &Path,
    rules: &FolderRules,
    opts: &ScanOptions,
    cancel: Arc<AtomicBool>,
    on_progress: ProgressCb,
) -> AppResult<FolderStats> {
    check_cancel(&cancel)?;
    let duplicate_min_lines = opts
        .duplicate_min_lines
        .unwrap_or(DEFAULT_DUPLICATE_LINES)
        .max(3);
    let full = opts.full.unwrap_or(false);
    let detect_dups = opts.detect_duplicates.unwrap_or(false);
    let duplicate_rules_json = serde_json::to_string(&opts.duplicate_rules)?;
    let duplicate_config_hash = sha1_hex(
        format!("{DUPLICATE_CACHE_VERSION}:{duplicate_min_lines}:{duplicate_rules_json}")
            .as_bytes(),
    );

    on_progress(ScanProgress {
        request_id: None,
        folder_id,
        phase: "walking".into(),
        total: 0,
        done: 0,
        current: None,
        cache_hits: None,
        outcome: None,
    });

    let rel_paths = walk_folder(root, rules);
    check_cancel(&cancel)?;
    let dup_eligible: Option<std::collections::HashSet<String>> = if detect_dups {
        if let Some(ref dr) = opts.duplicate_rules {
            if !dr.whitelist.is_empty() || !dr.blacklist.is_empty() {
                Some(walk_folder(root, dr).into_iter().collect())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    check_cancel(&cancel)?;

    let total = rel_paths.len();
    on_progress(ScanProgress {
        request_id: None,
        folder_id,
        phase: "parsing".into(),
        total,
        done: 0,
        current: None,
        cache_hits: Some(0),
        outcome: None,
    });

    // Short lock: snapshot cache rows, then release for CPU/IO heavy parsing.
    let existing_map = {
        let conn = db.lock();
        load_existing_map(&conn, folder_id)?
    };

    let done = AtomicUsize::new(0);
    let cache_hits = AtomicUsize::new(0);
    let on_progress = Arc::new(on_progress);
    // Emit at most about 100 parsing updates, while still giving small
    // workspaces visible progress for every completed file.
    let progress_step = (total / 100).clamp(1, 50);

    let parsed: Vec<Option<ParsedFile>> = rel_paths
        .par_iter()
        .map(|rel| {
            if cancel.load(Ordering::SeqCst) {
                return None;
            }
            let advance_progress = || {
                let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                if d % progress_step == 0 || d == total {
                    on_progress(ScanProgress {
                        request_id: None,
                        folder_id,
                        phase: "parsing".into(),
                        total,
                        done: d,
                        current: Some(rel.clone()),
                        cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
                        outcome: None,
                    });
                }
                d
            };
            if is_excluded_asset_path(rel) {
                advance_progress();
                return None;
            }
            // Open relative to directory handles without following links. The same
            // handle supplies both metadata and content, including after path changes.
            let mut file = match open_regular_file(root, rel) {
                Ok(Some(file)) => file,
                _ => {
                    advance_progress();
                    return None;
                }
            };
            let meta = match file.metadata() {
                Ok(meta) if meta.is_file() && meta.len() <= MAX_SCAN_BYTES => meta,
                _ => {
                    advance_progress();
                    return None;
                }
            };
            let size_num = meta.len() as i64;
            let mtime_num = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let (ext, lang_def, lang_id) = detect_lang(rel);
            let duplicate_allowed = dup_eligible
                .as_ref()
                .map(|s| s.contains(rel))
                .unwrap_or(true);
            let duplicate_config = format!("{duplicate_config_hash}:{duplicate_allowed}");
            let existing = existing_map.get(rel);
            let duplicate_cache_matches = existing
                .map(|row| {
                    row.duplicate_hash.as_ref() == Some(&row.hash)
                        && row.duplicate_config.as_ref() == Some(&duplicate_config)
                })
                .unwrap_or(false);

            if let Some(existing) = existing {
                if !full
                    && existing.lang != "Binary"
                    && existing.size == size_num
                    && existing.mtime == mtime_num
                    && (!detect_dups || duplicate_cache_matches)
                {
                    cache_hits.fetch_add(1, Ordering::Relaxed);
                    advance_progress();
                    return Some(ParsedFile {
                        rel_path: rel.clone(),
                        existing_id: Some(existing.id),
                        duplicate_config: None,
                        ext: existing.ext.clone(),
                        lang: existing.lang.clone(),
                        size: size_num,
                        mtime: mtime_num,
                        hash: existing.hash.clone(),
                        total: existing.total,
                        code: existing.code,
                        comment: existing.comment,
                        blank: existing.blank,
                        block_comment: existing.block_comment,
                        tags: vec![],
                        functions: vec![],
                        duplicates: vec![],
                        cached: true,
                        duplicates_refreshed: false,
                    });
                }
            }

            // A file may grow after metadata was checked. Never read more than
            // the limit plus one byte and reject it if it crossed the limit.
            let mut buf = Vec::with_capacity(size_num as usize);
            if file
                .by_ref()
                .take(MAX_SCAN_BYTES + 1)
                .read_to_end(&mut buf)
                .is_err()
                || buf.len() as u64 > MAX_SCAN_BYTES
                || is_binary_buffer(&buf)
            {
                advance_progress();
                return None;
            }
            let size_num = buf.len() as i64;
            let hash = sha1_hex(&buf);
            let duplicate_cache_matches = existing
                .map(|row| {
                    row.duplicate_hash.as_ref() == Some(&hash)
                        && row.duplicate_config.as_ref() == Some(&duplicate_config)
                })
                .unwrap_or(false);
            if let Some(existing) = existing {
                if !full
                    && existing.lang != "Binary"
                    && existing.hash == hash
                    && existing.size == size_num
                {
                    let duplicates_refreshed = detect_dups && !duplicate_cache_matches;
                    let duplicates = if duplicates_refreshed && duplicate_allowed {
                        find_duplicate_slices(&String::from_utf8_lossy(&buf), duplicate_min_lines)
                    } else {
                        vec![]
                    };
                    cache_hits.fetch_add(1, Ordering::Relaxed);
                    advance_progress();
                    return Some(ParsedFile {
                        rel_path: rel.clone(),
                        existing_id: Some(existing.id),
                        duplicate_config: duplicates_refreshed.then_some(duplicate_config),
                        ext: existing.ext.clone(),
                        lang: existing.lang.clone(),
                        size: size_num,
                        mtime: mtime_num,
                        hash,
                        total: existing.total,
                        code: existing.code,
                        comment: existing.comment,
                        blank: existing.blank,
                        block_comment: existing.block_comment,
                        tags: vec![],
                        functions: vec![],
                        duplicates,
                        cached: true,
                        duplicates_refreshed,
                    });
                }
            }

            let content = String::from_utf8_lossy(&buf);
            let counts = count_lines(&content, lang_def.as_ref());
            let tags = scan_tags(&content, lang_def.as_ref());
            let functions = find_functions(&content, &ext);
            let duplicates = if detect_dups && !duplicate_cache_matches && duplicate_allowed {
                find_duplicate_slices(&content, duplicate_min_lines)
            } else {
                vec![]
            };
            advance_progress();
            Some(ParsedFile {
                rel_path: rel.clone(),
                existing_id: existing.map(|row| row.id),
                duplicate_config: detect_dups.then_some(duplicate_config),
                ext,
                lang: lang_id,
                size: size_num,
                mtime: mtime_num,
                hash,
                total: counts.total,
                code: counts.code,
                comment: counts.comment,
                blank: counts.blank,
                block_comment: counts.block_comment,
                tags,
                functions,
                duplicates,
                cached: false,
                // A changed file scanned without duplicate detection must discard
                // its stale windows. Unchanged duplicate caches stay untouched.
                duplicates_refreshed: !duplicate_cache_matches,
            })
        })
        .collect();

    check_cancel(&cancel)?;

    on_progress(ScanProgress {
        request_id: None,
        folder_id,
        phase: "persisting".into(),
        total,
        done: 0,
        current: None,
        cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
        outcome: None,
    });

    let scanned_at = now_ms();
    let mut conn = db.lock();
    // Cancellation while waiting for another query's lock still stops persistence.
    check_cancel(&cancel)?;
    let tx = conn.transaction()?;
    persist_files(&tx, folder_id, parsed, scanned_at, &cancel, |done| {
        if done % progress_step == 0 || done == total {
            on_progress(ScanProgress {
                request_id: None,
                folder_id,
                phase: "persisting".into(),
                total,
                done,
                current: None,
                cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
                outcome: None,
            });
        }
    })?;
    check_cancel(&cancel)?;
    let summary = summary_for_folder(&tx, folder_id)?;
    check_cancel(&cancel)?;
    tx.commit()?;

    on_progress(ScanProgress {
        request_id: None,
        folder_id,
        phase: "done".into(),
        total,
        done: total,
        current: None,
        cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
        outcome: Some("success".into()),
    });

    Ok(summary)
}

/// Prepared statements and INSERT RETURNING avoid preparing SQL and looking up
/// the same file id for every duplicate window. Cancellation drops the entire
/// transaction, so none of a partial scan becomes visible.
fn persist_files(
    tx: &rusqlite::Transaction<'_>,
    folder_id: i64,
    parsed: Vec<Option<ParsedFile>>,
    scanned_at: i64,
    cancel: &AtomicBool,
    on_file_persisted: impl Fn(usize),
) -> AppResult<()> {
    let present: std::collections::HashSet<&str> = parsed
        .iter()
        .filter_map(|p| p.as_ref().map(|x| x.rel_path.as_str()))
        .collect();
    let rows: Vec<(i64, String)> = {
        let mut stmt =
            tx.prepare("SELECT id, rel_path FROM files WHERE folder_id = ? AND deleted = 0")?;
        let rows = stmt.query_map([folder_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut soft_delete = tx.prepare("UPDATE files SET deleted = 1 WHERE id = ?")?;
    for (id, rel) in rows {
        check_cancel(cancel)?;
        if !present.contains(rel.as_str()) {
            soft_delete.execute([id])?;
        }
    }
    let mut cached_update =
        tx.prepare("UPDATE files SET mtime = ?, scanned_at = ?, deleted = 0 WHERE id = ?")?;
    let mut upsert = tx.prepare(
        "INSERT INTO files(folder_id, rel_path, lang, ext, size, mtime, hash, total, code, comment, blank, block_comment, scanned_at, deleted)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,0)
         ON CONFLICT(folder_id, rel_path) DO UPDATE SET
           lang=excluded.lang, ext=excluded.ext, size=excluded.size, mtime=excluded.mtime, hash=excluded.hash,
           total=excluded.total, code=excluded.code, comment=excluded.comment, blank=excluded.blank,
           block_comment=excluded.block_comment, scanned_at=excluded.scanned_at, deleted=0
         RETURNING id",
    )?;
    let mut delete_tags = tx.prepare("DELETE FROM tags WHERE file_id = ?")?;
    let mut delete_functions = tx.prepare("DELETE FROM functions WHERE file_id = ?")?;
    let mut insert_tag =
        tx.prepare("INSERT INTO tags(file_id, kind, line_no, text) VALUES(?,?,?,?)")?;
    let mut insert_function = tx.prepare(
        "INSERT INTO functions(file_id, name, start_line, end_line, length) VALUES(?,?,?,?,?)",
    )?;
    let mut delete_duplicates = tx.prepare("DELETE FROM duplicates WHERE file_id = ?")?;
    let mut insert_duplicate =
        tx.prepare("INSERT INTO duplicates(hash, file_id, start_line, end_line) VALUES(?,?,?,?)")?;
    let mut delete_duplicate_cache = tx.prepare("DELETE FROM duplicate_cache WHERE file_id = ?")?;
    let mut update_duplicate_cache = tx.prepare(
        "INSERT INTO duplicate_cache(file_id, hash, config) VALUES(?,?,?)
         ON CONFLICT(file_id) DO UPDATE SET hash=excluded.hash, config=excluded.config",
    )?;

    for (index, item) in parsed.into_iter().flatten().enumerate() {
        check_cancel(cancel)?;
        let file_id = if item.cached {
            let id = item.existing_id.expect("cached file has an existing id");
            cached_update.execute(rusqlite::params![item.mtime, scanned_at, id])?;
            id
        } else {
            upsert.query_row(
                rusqlite::params![
                    folder_id,
                    item.rel_path,
                    item.lang,
                    item.ext,
                    item.size,
                    item.mtime,
                    item.hash,
                    item.total,
                    item.code,
                    item.comment,
                    item.blank,
                    item.block_comment,
                    scanned_at,
                ],
                |row| row.get(0),
            )?
        };
        if !item.cached {
            delete_tags.execute([file_id])?;
            delete_functions.execute([file_id])?;
            for t in &item.tags {
                check_cancel(cancel)?;
                insert_tag.execute(rusqlite::params![file_id, t.kind, t.line_no, t.text])?;
            }
            for f in &item.functions {
                check_cancel(cancel)?;
                insert_function.execute(rusqlite::params![
                    file_id,
                    f.name,
                    f.start_line,
                    f.end_line,
                    f.length
                ])?;
            }
        }
        if item.duplicates_refreshed {
            delete_duplicates.execute([file_id])?;
            for d in &item.duplicates {
                check_cancel(cancel)?;
                insert_duplicate.execute(rusqlite::params![
                    d.hash,
                    file_id,
                    d.start_line,
                    d.end_line
                ])?;
            }
            if let Some(config) = item.duplicate_config {
                update_duplicate_cache.execute(rusqlite::params![file_id, item.hash, config])?;
            } else {
                delete_duplicate_cache.execute([file_id])?;
            }
        }
        on_file_persisted(index + 1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);
    const SOURCE: &str =
        "value += 1;\nvalue += 2;\nvalue += 3;\nvalue += 4;\nvalue += 5;\nvalue += 6;\n";

    struct Fixture {
        base: PathBuf,
        root: PathBuf,
        db: parking_lot::Mutex<Connection>,
    }

    impl Fixture {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!(
                "cla-engine-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            let root = base.join("repo");
            std::fs::create_dir_all(&root).unwrap();
            let root = root.canonicalize().unwrap();
            let conn = crate::db::open_db(&base.join("data")).unwrap();
            conn.execute(
                "INSERT INTO folders(id, root_path, name, created_at) VALUES(1, ?, 'fixture', 0)",
                [root.to_str().unwrap()],
            )
            .unwrap();
            Self {
                base,
                root,
                db: parking_lot::Mutex::new(conn),
            }
        }

        fn write(&self, name: &str, contents: &str) {
            std::fs::write(self.root.join(name), contents).unwrap();
        }

        fn opts() -> ScanOptions {
            ScanOptions {
                detect_duplicates: Some(true),
                duplicate_min_lines: Some(3),
                ..Default::default()
            }
        }

        fn scan(&self, opts: ScanOptions) -> FolderStats {
            scan_folder(
                &self.db,
                1,
                &self.root,
                &FolderRules::default(),
                &opts,
                Arc::new(AtomicBool::new(false)),
                Box::new(|_| {}),
            )
            .unwrap()
        }

        fn scalar(&self, sql: &str) -> i64 {
            self.db.lock().query_row(sql, [], |r| r.get(0)).unwrap()
        }

        fn snapshot(&self) -> Vec<(String, String, i64, i64, i64)> {
            let conn = self.db.lock();
            let mut stmt = conn.prepare("SELECT rel_path, hash, total, scanned_at, deleted FROM files ORDER BY rel_path").unwrap();
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .unwrap();
            rows.collect::<Result<Vec<_>, _>>().unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    #[test]
    fn oversized_files_are_skipped_before_reading() {
        let fixture = Fixture::new();
        fixture.write("small.ts", "const value = 1;\n");
        let huge = std::fs::File::create(fixture.root.join("huge.ts")).unwrap();
        huge.set_len(MAX_SCAN_BYTES + 1).unwrap();
        assert_eq!(fixture.scan(Fixture::opts()).total_files, 1);
        assert_eq!(
            fixture.scalar("SELECT COUNT(*) FROM files WHERE rel_path = 'huge.ts'"),
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_and_named_pipes_are_not_scanned() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fixture.write("small.ts", "const value = 1;\n");
        std::fs::write(fixture.base.join("outside.ts"), SOURCE).unwrap();
        symlink(
            fixture.base.join("outside.ts"),
            fixture.root.join("link.ts"),
        )
        .unwrap();
        let fifo = std::ffi::CString::new(fixture.root.join("pipe.ts").to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert_eq!(fixture.scan(Fixture::opts()).total_files, 1);
    }

    #[test]
    fn unchanged_hashes_preserve_duplicate_rows_even_after_metadata_changes() {
        let fixture = Fixture::new();
        fixture.write("a.ts", SOURCE);
        fixture.scan(Fixture::opts());
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicates"), 4);
        // Reject writes to existing windows so this verifies incremental persistence.
        fixture
            .db
            .lock()
            .execute_batch(
                "CREATE TRIGGER forbid_dup_delete BEFORE DELETE ON duplicates BEGIN
               SELECT RAISE(ABORT, 'unchanged duplicates were rewritten'); END;
             CREATE TRIGGER forbid_cache_update BEFORE UPDATE ON duplicate_cache BEGIN
               SELECT RAISE(ABORT, 'unchanged duplicate cache was updated'); END;
             CREATE TRIGGER forbid_cache_insert BEFORE INSERT ON duplicate_cache BEGIN
               SELECT RAISE(ABORT, 'unchanged duplicate cache was inserted'); END;
             CREATE TRIGGER forbid_cache_delete BEFORE DELETE ON duplicate_cache BEGIN
               SELECT RAISE(ABORT, 'unchanged duplicate cache was deleted'); END;",
            )
            .unwrap();
        fixture.scan(Fixture::opts());
        fixture
            .db
            .lock()
            .execute("UPDATE files SET mtime = 0", [])
            .unwrap();
        fixture.scan(Fixture::opts());
        let mut full = Fixture::opts();
        full.full = Some(true);
        fixture.scan(full);
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicates"), 4);
    }

    #[test]
    fn changing_window_size_rebuilds_cached_files() {
        let fixture = Fixture::new();
        fixture.write("a.ts", SOURCE);
        fixture.scan(Fixture::opts());
        let mut opts = Fixture::opts();
        opts.duplicate_min_lines = Some(4);
        fixture.scan(opts);
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicates"), 3);
        assert_eq!(
            fixture.scalar("SELECT MIN(end_line - start_line + 1) FROM duplicates"),
            4
        );
    }

    #[test]
    fn changing_duplicate_rules_removes_windows_from_newly_excluded_files() {
        let fixture = Fixture::new();
        fixture.write("a.ts", SOURCE);
        fixture.write("b.ts", SOURCE);
        fixture.scan(Fixture::opts());
        let mut opts = Fixture::opts();
        opts.duplicate_rules = Some(FolderRules {
            whitelist: vec!["a.ts".into()],
            blacklist: vec![],
        });
        fixture.scan(opts.clone());
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicates"), 4);
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicates d JOIN files f ON f.id = d.file_id WHERE f.rel_path = 'b.ts'"), 0);
        fixture
            .db
            .lock()
            .execute_batch(
                "CREATE TRIGGER forbid_dup_delete BEFORE DELETE ON duplicates BEGIN
               SELECT RAISE(ABORT, 'unchanged rules recomputed duplicates'); END;",
            )
            .unwrap();
        fixture.scan(opts);
    }

    #[test]
    fn changed_files_without_detection_discard_stale_windows() {
        let fixture = Fixture::new();
        fixture.write("a.ts", SOURCE);
        fixture.scan(Fixture::opts());
        fixture.write("a.ts", "value = 42;\n");
        let mut opts = Fixture::opts();
        opts.detect_duplicates = Some(false);
        fixture.scan(opts);
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicates"), 0);
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicate_cache"), 0);
        fixture.write("a.ts", SOURCE);
        fixture.scan(Fixture::opts());
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM duplicates"), 4);
    }

    #[test]
    fn cancelling_during_persistence_rolls_back_updates_and_deletions() {
        let fixture = Fixture::new();
        fixture.write("a.ts", SOURCE);
        fixture.write("b.ts", SOURCE);
        fixture.scan(Fixture::opts());
        let before = fixture.snapshot();
        let duplicate_count = fixture.scalar("SELECT COUNT(*) FROM duplicates");
        fixture.write("a.ts", "value = 42;\n");
        std::fs::remove_file(fixture.root.join("b.ts")).unwrap();
        fixture.write("c.ts", SOURCE);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_on_progress = cancel.clone();
        let result = scan_folder(
            &fixture.db,
            1,
            &fixture.root,
            &FolderRules::default(),
            &Fixture::opts(),
            cancel.clone(),
            Box::new(move |progress| {
                if progress.phase == "persisting" && progress.done > 0 {
                    cancel_on_progress.store(true, Ordering::SeqCst);
                }
                assert_ne!(progress.outcome.as_deref(), Some("success"));
            }),
        );
        assert!(matches!(result, Err(AppError::Cancelled)));
        assert!(
            cancel.load(Ordering::SeqCst),
            "test must cancel after a persisted file"
        );
        assert_eq!(fixture.snapshot(), before);
        assert_eq!(
            fixture.scalar("SELECT COUNT(*) FROM duplicates"),
            duplicate_count
        );
    }

    #[test]
    fn preexisting_cancel_requests_are_not_cleared_by_the_engine() {
        let fixture = Fixture::new();
        let result = scan_folder(
            &fixture.db,
            1,
            &fixture.root,
            &FolderRules::default(),
            &Fixture::opts(),
            Arc::new(AtomicBool::new(true)),
            Box::new(|_| {}),
        );
        assert!(matches!(result, Err(AppError::Cancelled)));
    }
}
