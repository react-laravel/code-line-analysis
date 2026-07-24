use crate::db::DEFAULT_DUPLICATE_LINES;
use crate::error::AppResult;
use crate::parsers::{
    duplicate::find_duplicate_slices,
    func_detect::find_functions,
    languages::detect_lang,
    line_parser::count_lines,
    tag_scanner::scan_tags,
};
use crate::scan::filters::{is_binary_buffer, is_excluded_asset_path};
use crate::scan::walk::walk_folder;
use crate::types::{FolderRules, FolderStats, ScanOptions, ScanProgress};
use crate::stats::summary_for_folder;
use rayon::prelude::*;
use rusqlite::Connection;
use sha1::{Digest, Sha1};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub type ProgressCb = Box<dyn Fn(ScanProgress) + Send + Sync>;

struct ExistingRow {
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
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

fn sha1_hex(buf: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(buf);
    hex::encode(h.finalize())
}

fn refresh_dups(abs: &Path, size: i64, min_lines: i64) -> Vec<crate::parsers::duplicate::DupSlice> {
    if size > 5 * 1024 * 1024 { return vec![]; }
    let Ok(buf) = std::fs::read(abs) else { return vec![] };
    if is_binary_buffer(&buf) { return vec![]; }
    let content = String::from_utf8_lossy(&buf);
    find_duplicate_slices(&content, min_lines)
}

fn load_existing_map(conn: &Connection, folder_id: i64) -> AppResult<std::collections::HashMap<String, ExistingRow>> {
    let mut map = std::collections::HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT size, mtime, hash, total, code, comment, blank, block_comment, lang, ext, rel_path
         FROM files WHERE folder_id = ?",
    )?;
    let rows = stmt.query_map([folder_id], |r| {
        Ok((
            r.get::<_, String>(10)?,
            ExistingRow {
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
    for row in rows.flatten() {
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
    cancel.store(false, Ordering::SeqCst);
    let duplicate_min_lines = opts.duplicate_min_lines.unwrap_or(DEFAULT_DUPLICATE_LINES).max(3);
    let full = opts.full.unwrap_or(false);
    let detect_dups = opts.detect_duplicates.unwrap_or(false);

    on_progress(ScanProgress {
        folder_id,
        phase: "walking".into(),
        total: 0,
        done: 0,
        current: None,
        cache_hits: None,
    });

    let rel_paths = walk_folder(root, rules);
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

    let total = rel_paths.len();
    on_progress(ScanProgress {
        folder_id,
        phase: "parsing".into(),
        total,
        done: 0,
        current: None,
        cache_hits: Some(0),
    });

    // Short lock: snapshot cache rows, then release for CPU/IO heavy parsing.
    let existing_map = {
        let conn = db.lock();
        load_existing_map(&conn, folder_id)?
    };

    let done = AtomicUsize::new(0);
    let cache_hits = AtomicUsize::new(0);
    let on_progress = Arc::new(on_progress);

    let parsed: Vec<Option<ParsedFile>> = rel_paths
        .par_iter()
        .map(|rel| {
            if cancel.load(Ordering::SeqCst) { return None; }
            if is_excluded_asset_path(rel) {
                done.fetch_add(1, Ordering::Relaxed);
                return None;
            }
            let abs = root.join(rel);
            let meta = match std::fs::metadata(&abs) {
                Ok(m) if m.is_file() => m,
                _ => {
                    done.fetch_add(1, Ordering::Relaxed);
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
            let duplicate_allowed = !detect_dups
                || dup_eligible.as_ref().map(|s| s.contains(rel)).unwrap_or(true);

            if let Some(existing) = existing_map.get(rel) {
                if !full
                    && existing.lang != "Binary"
                    && existing.size == size_num
                    && existing.mtime == mtime_num
                {
                    let duplicates = if detect_dups {
                        if duplicate_allowed {
                            refresh_dups(&abs, size_num, duplicate_min_lines)
                        } else {
                            vec![]
                        }
                    } else {
                        vec![]
                    };
                    cache_hits.fetch_add(1, Ordering::Relaxed);
                    let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if d % 50 == 0 {
                        on_progress(ScanProgress {
                            folder_id,
                            phase: "parsing".into(),
                            total,
                            done: d,
                            current: Some(rel.clone()),
                            cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
                        });
                    }
                    return Some(ParsedFile {
                        rel_path: rel.clone(),
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
                        duplicates,
                        cached: true,
                        duplicates_refreshed: detect_dups,
                    });
                }
            }

            let buf = match std::fs::read(&abs) {
                Ok(b) => b,
                Err(_) => {
                    done.fetch_add(1, Ordering::Relaxed);
                    return None;
                }
            };
            if is_binary_buffer(&buf) {
                done.fetch_add(1, Ordering::Relaxed);
                return None;
            }
            let hash = sha1_hex(&buf);
            if let Some(existing) = existing_map.get(rel) {
                if !full
                    && existing.lang != "Binary"
                    && existing.hash == hash
                    && existing.size == size_num
                {
                    let duplicates = if detect_dups {
                        if duplicate_allowed && size_num <= 5 * 1024 * 1024 {
                            find_duplicate_slices(&String::from_utf8_lossy(&buf), duplicate_min_lines)
                        } else {
                            vec![]
                        }
                    } else {
                        vec![]
                    };
                    cache_hits.fetch_add(1, Ordering::Relaxed);
                    let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if d % 50 == 0 {
                        on_progress(ScanProgress {
                            folder_id,
                            phase: "parsing".into(),
                            total,
                            done: d,
                            current: Some(rel.clone()),
                            cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
                        });
                    }
                    return Some(ParsedFile {
                        rel_path: rel.clone(),
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
                        duplicates_refreshed: detect_dups,
                    });
                }
            }

            // Skip full parse for huge files (>5MB) — count newlines only.
            if size_num > 5 * 1024 * 1024 {
                let newlines = buf.iter().filter(|&&b| b == b'\n').count() as i64;
                let lines = newlines + 1;
                let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                if d % 50 == 0 {
                    on_progress(ScanProgress {
                        folder_id,
                        phase: "parsing".into(),
                        total,
                        done: d,
                        current: Some(rel.clone()),
                        cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
                    });
                }
                return Some(ParsedFile {
                    rel_path: rel.clone(),
                    ext,
                    lang: lang_id,
                    size: size_num,
                    mtime: mtime_num,
                    hash,
                    total: lines,
                    code: lines,
                    comment: 0,
                    blank: 0,
                    block_comment: 0,
                    tags: vec![],
                    functions: vec![],
                    duplicates: vec![],
                    cached: false,
                    duplicates_refreshed: false,
                });
            }

            let content = String::from_utf8_lossy(&buf);
            let counts = count_lines(&content, lang_def.as_ref());
            let tags = scan_tags(&content, lang_def.as_ref());
            let functions = find_functions(&content, &ext);
            let duplicates = if detect_dups && duplicate_allowed {
                find_duplicate_slices(&content, duplicate_min_lines)
            } else {
                vec![]
            };
            let d = done.fetch_add(1, Ordering::Relaxed) + 1;
            if d % 50 == 0 {
                on_progress(ScanProgress {
                    folder_id,
                    phase: "parsing".into(),
                    total,
                    done: d,
                    current: Some(rel.clone()),
                    cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
                });
            }
            Some(ParsedFile {
                rel_path: rel.clone(),
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
                duplicates_refreshed: detect_dups,
            })
        })
        .collect();

    if cancel.load(Ordering::SeqCst) {
        on_progress(ScanProgress {
            folder_id,
            phase: "done".into(),
            total,
            done: done.load(Ordering::Relaxed),
            current: None,
            cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
        });
        let conn = db.lock();
        return summary_for_folder(&conn, folder_id);
    }

    on_progress(ScanProgress {
        folder_id,
        phase: "persisting".into(),
        total,
        done: total,
        current: None,
        cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
    });

    let scanned_at = now_ms();
    let mut conn = db.lock();
    let tx = conn.transaction()?;
    // soft-delete missing
    {
        let present: std::collections::HashSet<&str> = parsed
            .iter()
            .filter_map(|p| p.as_ref().map(|x| x.rel_path.as_str()))
            .collect();
        let mut stmt = tx.prepare("SELECT id, rel_path FROM files WHERE folder_id = ? AND deleted = 0")?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([folder_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .flatten()
            .collect();
        drop(stmt);
        for (id, rel) in rows {
            if !present.contains(rel.as_str()) {
                tx.execute("UPDATE files SET deleted = 1 WHERE id = ?", [id])?;
            }
        }
    }

    for item in parsed.into_iter().flatten() {
        tx.execute(
            "INSERT INTO files(folder_id, rel_path, lang, ext, size, mtime, hash, total, code, comment, blank, block_comment, scanned_at, deleted)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,0)
             ON CONFLICT(folder_id, rel_path) DO UPDATE SET
               lang=excluded.lang, ext=excluded.ext, size=excluded.size, mtime=excluded.mtime, hash=excluded.hash,
               total=excluded.total, code=excluded.code, comment=excluded.comment, blank=excluded.blank,
               block_comment=excluded.block_comment, scanned_at=excluded.scanned_at, deleted=0",
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
        )?;
        let file_id: i64 = tx.query_row(
            "SELECT id FROM files WHERE folder_id = ? AND rel_path = ?",
            rusqlite::params![folder_id, item.rel_path],
            |r| r.get(0),
        )?;

        if !item.cached {
            tx.execute("DELETE FROM tags WHERE file_id = ?", [file_id])?;
            tx.execute("DELETE FROM functions WHERE file_id = ?", [file_id])?;
            for t in &item.tags {
                tx.execute(
                    "INSERT INTO tags(file_id, kind, line_no, text) VALUES(?,?,?,?)",
                    rusqlite::params![file_id, t.kind, t.line_no, t.text],
                )?;
            }
            for f in &item.functions {
                tx.execute(
                    "INSERT INTO functions(file_id, name, start_line, end_line, length) VALUES(?,?,?,?,?)",
                    rusqlite::params![file_id, f.name, f.start_line, f.end_line, f.length],
                )?;
            }
        }
        if item.duplicates_refreshed {
            tx.execute("DELETE FROM duplicates WHERE file_id = ?", [file_id])?;
            for d in &item.duplicates {
                tx.execute(
                    "INSERT INTO duplicates(hash, file_id, start_line, end_line) VALUES(?,?,?,?)",
                    rusqlite::params![d.hash, file_id, d.start_line, d.end_line],
                )?;
            }
        }
    }
    tx.commit()?;

    on_progress(ScanProgress {
        folder_id,
        phase: "done".into(),
        total,
        done: total,
        current: None,
        cache_hits: Some(cache_hits.load(Ordering::Relaxed)),
    });

    summary_for_folder(&conn, folder_id)
}
