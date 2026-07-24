use crate::error::AppResult;
use crate::types::*;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::Connection;
use std::collections::HashMap;

static TEST_FILE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)\.(?:test|spec)\.[^/.]+$").unwrap(),
        Regex::new(r"(?i)[_-](?:test|spec)\.[^/.]+$").unwrap(),
        Regex::new(r"[A-Z][A-Za-z0-9]*(?:Test|Tests|Spec|Specs)\.[^/.]+$").unwrap(),
    ]
});

const TEST_DIRS: &[&str] = &["__tests__", "__test__", "tests", "test", "spec", "specs", "e2e", "cypress"];

fn is_test_file_path(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/");
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    let file_name = segments.last().copied().unwrap_or(normalized.as_str());
    if segments[..segments.len().saturating_sub(1)]
        .iter()
        .any(|s| TEST_DIRS.iter().any(|d| s.eq_ignore_ascii_case(d)))
    {
        return true;
    }
    TEST_FILE_PATTERNS.iter().any(|re| re.is_match(file_name))
}

pub fn summary_for_folder(conn: &Connection, folder_id: i64) -> AppResult<FolderStats> {
    let totals = conn.query_row(
        "SELECT COUNT(*) AS files, COALESCE(SUM(total),0), COALESCE(SUM(code),0),
                COALESCE(SUM(comment),0), COALESCE(SUM(blank),0), COALESCE(SUM(block_comment),0)
         FROM files WHERE folder_id = ? AND deleted = 0",
        [folder_id],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?)),
    )?;

    let mut test_code = 0i64;
    {
        let mut stmt = conn.prepare("SELECT rel_path, code FROM files WHERE folder_id = ? AND deleted = 0")?;
        let rows = stmt.query_map([folder_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows.flatten() {
            if is_test_file_path(&row.0) { test_code += row.1; }
        }
    }
    let runtime_code = (totals.2 - test_code).max(0);

    let mut by_lang = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT lang, COUNT(*) AS files, SUM(total), SUM(code), SUM(comment), SUM(blank)
             FROM files WHERE folder_id = ? AND deleted = 0
             GROUP BY lang ORDER BY SUM(total) DESC",
        )?;
        let rows = stmt.query_map([folder_id], |r| {
            Ok(LangStat {
                lang: r.get(0)?,
                files: r.get(1)?,
                total: r.get(2)?,
                code: r.get(3)?,
                comment: r.get(4)?,
                blank: r.get(5)?,
            })
        })?;
        for row in rows.flatten() { by_lang.push(row); }
    }

    let mut tag_counts = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT kind, COUNT(*) FROM tags JOIN files ON tags.file_id = files.id
             WHERE files.folder_id = ? AND files.deleted = 0 GROUP BY kind",
        )?;
        let rows = stmt.query_map([folder_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for (k, c) in rows.flatten() { tag_counts.insert(k, c); }
    }

    Ok(FolderStats {
        total_files: totals.0,
        total_lines: totals.1,
        total_code: totals.2,
        runtime_code,
        test_code,
        total_comment: totals.3,
        total_blank: totals.4,
        total_block_comment: totals.5,
        by_lang,
        tag_counts,
    })
}

pub fn get_tree(conn: &Connection, folder_id: i64) -> AppResult<DirNode> {
    let mut rows = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT rel_path, total, code, comment, blank FROM files WHERE folder_id = ? AND deleted = 0",
        )?;
        let it = stmt.query_map([folder_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?))
        })?;
        for row in it.flatten() { rows.push(row); }
    }

    let mut nodes: HashMap<String, DirNode> = HashMap::new();
    nodes.insert(String::new(), DirNode {
        name: "/".into(), path: String::new(), is_dir: true,
        total: 0, code: 0, comment: 0, blank: 0, files: 0, children: Some(vec![]),
    });

    for (rel, total, code, comment, blank) in rows {
        let segs: Vec<&str> = rel.split('/').collect();
        let file_name = segs.last().unwrap().to_string();
        let mut parent_path = String::new();
        for seg in segs.iter().take(segs.len() - 1) {
            let path = if parent_path.is_empty() { (*seg).to_string() } else { format!("{parent_path}/{seg}") };
            if !nodes.contains_key(&path) {
                nodes.insert(path.clone(), DirNode {
                    name: (*seg).to_string(), path: path.clone(), is_dir: true,
                    total: 0, code: 0, comment: 0, blank: 0, files: 0, children: Some(vec![]),
                });
            }
            parent_path = path;
        }
        let file_node = DirNode {
            name: file_name, path: rel.clone(), is_dir: false,
            total, code, comment, blank, files: 1, children: None,
        };
        let parent = nodes.get_mut(&parent_path).unwrap();
        parent.children.get_or_insert_with(Vec::new).push(file_node);
    }

    // Rebuild hierarchy properly
    let mut children_of: HashMap<String, Vec<String>> = HashMap::new();
    let keys: Vec<String> = nodes.keys().cloned().collect();
    for key in &keys {
        if key.is_empty() { continue; }
        let parent = match key.rfind('/') {
            Some(i) => key[..i].to_string(),
            None => String::new(),
        };
        children_of.entry(parent).or_default().push(key.clone());
    }

    fn assemble(path: &str, nodes: &mut HashMap<String, DirNode>, children_of: &HashMap<String, Vec<String>>) -> DirNode {
        let mut node = nodes.remove(path).unwrap_or(DirNode {
            name: if path.is_empty() { "/".into() } else { path.rsplit('/').next().unwrap().into() },
            path: path.to_string(), is_dir: true, total: 0, code: 0, comment: 0, blank: 0, files: 0, children: Some(vec![]),
        });
        let mut kids = node.children.take().unwrap_or_default();
        // files already in kids
        if let Some(dirs) = children_of.get(path) {
            for d in dirs {
                kids.push(assemble(d, nodes, children_of));
            }
        }
        // aggregate
        let mut t=0i64; let mut c=0; let mut cm=0; let mut b=0; let mut files=0;
        for ch in &kids {
            t += ch.total; c += ch.code; cm += ch.comment; b += ch.blank;
            files += if ch.is_dir { ch.files } else { 1 };
        }
        kids.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(b.total.cmp(&a.total))
        });
        node.total = t; node.code = c; node.comment = cm; node.blank = b; node.files = files;
        node.children = Some(kids);
        node
    }

    Ok(assemble("", &mut nodes, &children_of))
}

pub fn get_top_files(conn: &Connection, folder_id: i64, limit: i64, sort_by: &str) -> AppResult<Vec<TopFile>> {
    let order = if sort_by == "size" { "size" } else { "total" };
    let sql = format!(
        "SELECT rel_path, total, code, size, lang FROM files WHERE folder_id = ? AND deleted = 0 ORDER BY {order} DESC LIMIT ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params![folder_id, limit], |r| {
        Ok(TopFile {
            rel_path: r.get(0)?,
            total: r.get(1)?,
            code: r.get(2)?,
            size: r.get(3)?,
            lang: r.get(4)?,
            last_commit_date: None,
        })
    })?;
    Ok(rows.flatten().collect())
}

pub fn get_top_functions(conn: &Connection, folder_id: i64, limit: i64) -> AppResult<Vec<TopFunction>> {
    let mut stmt = conn.prepare(
        "SELECT files.rel_path, functions.name, functions.start_line, functions.end_line, functions.length
         FROM functions JOIN files ON functions.file_id = files.id
         WHERE files.folder_id = ? AND files.deleted = 0
         ORDER BY functions.length DESC LIMIT ?",
    )?;
    let rows = stmt.query_map(rusqlite::params![folder_id, limit], |r| {
        Ok(TopFunction {
            rel_path: r.get(0)?,
            name: r.get(1)?,
            start_line: r.get(2)?,
            end_line: r.get(3)?,
            length: r.get(4)?,
        })
    })?;
    Ok(rows.flatten().collect())
}

pub fn get_tags(conn: &Connection, folder_id: i64, kind: Option<&str>) -> AppResult<Vec<TagRow>> {
    let mut sql = String::from(
        "SELECT tags.file_id, tags.kind, tags.line_no, tags.text, files.rel_path
         FROM tags JOIN files ON tags.file_id = files.id
         WHERE files.folder_id = ? AND files.deleted = 0",
    );
    if kind.is_some() { sql.push_str(" AND tags.kind = ?"); }
    sql.push_str(" ORDER BY tags.kind, files.rel_path, tags.line_no");
    let mut stmt = conn.prepare(&sql)?;
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<TagRow> {
        Ok(TagRow {
            file_id: r.get(0)?,
            kind: r.get(1)?,
            line_no: r.get(2)?,
            text: r.get(3)?,
            rel_path: Some(r.get(4)?),
        })
    };
    let rows = if let Some(k) = kind {
        stmt.query_map(rusqlite::params![folder_id, k], map_row)?
    } else {
        stmt.query_map(rusqlite::params![folder_id], map_row)?
    };
    Ok(rows.flatten().collect())
}

pub fn get_file_tags(conn: &Connection, folder_id: i64, rel_path: &str) -> AppResult<Vec<TagRow>> {
    let mut stmt = conn.prepare(
        "SELECT tags.file_id, tags.kind, tags.line_no, tags.text
         FROM tags JOIN files ON tags.file_id = files.id
         WHERE files.folder_id = ? AND files.rel_path = ? AND files.deleted = 0
         ORDER BY tags.line_no",
    )?;
    let rows = stmt.query_map(rusqlite::params![folder_id, rel_path], |r| {
        Ok(TagRow {
            file_id: r.get(0)?,
            kind: r.get(1)?,
            line_no: r.get(2)?,
            text: r.get(3)?,
            rel_path: None,
        })
    })?;
    Ok(rows.flatten().collect())
}

pub fn get_duplicates(
    conn: &Connection,
    folder_id: i64,
    duplicate_min_lines: i64,
) -> AppResult<Vec<DuplicateCluster>> {
    let mut stmt = conn.prepare(
        "SELECT duplicates.hash, files.rel_path, duplicates.start_line, duplicates.end_line
         FROM duplicates JOIN files ON duplicates.file_id = files.id
         WHERE files.folder_id = ? AND files.deleted = 0
         ORDER BY duplicates.hash",
    )?;
    let mut by_hash: HashMap<String, Vec<DuplicateOccurrence>> = HashMap::new();
    let rows = stmt.query_map([folder_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    for (hash, rel, start, end) in rows.flatten() {
        by_hash.entry(hash).or_default().push(DuplicateOccurrence {
            rel_path: rel,
            start_line: start,
            end_line: end,
        });
    }

    let mut clusters = Vec::new();
    for (hash, mut occurrences) in by_hash {
        if occurrences.len() < 2 {
            continue;
        }
        occurrences.sort_by(|a, b| {
            a.rel_path
                .cmp(&b.rel_path)
                .then(a.start_line.cmp(&b.start_line))
                .then(a.end_line.cmp(&b.end_line))
        });
        clusters.push(DuplicateCluster {
            hash,
            occurrences,
            lines: duplicate_min_lines,
        });
    }

    let mut compacted = compact_duplicate_clusters(clusters);
    compacted.sort_by(|a, b| {
        let score_a = a.occurrences.len() as i64 * a.lines;
        let score_b = b.occurrences.len() as i64 * b.lines;
        score_b.cmp(&score_a).then(b.lines.cmp(&a.lines))
    });
    compacted.truncate(200);
    Ok(compacted)
}

fn duplicate_signature(occurrences: &[DuplicateOccurrence]) -> String {
    occurrences
        .iter()
        .map(|o| o.rel_path.as_str())
        .collect::<Vec<_>>()
        .join("|")
}

fn cluster_order_value(cluster: &DuplicateCluster) -> String {
    cluster
        .occurrences
        .iter()
        .map(|o| {
            format!(
                "{}:{:08}:{:08}",
                o.rel_path, o.start_line, o.end_line
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn has_stable_duplicate_alignment(current: &DuplicateCluster, next: &DuplicateCluster) -> bool {
    if current.occurrences.len() != next.occurrences.len() {
        return false;
    }
    let current_base = &current.occurrences[0];
    let next_base = &next.occurrences[0];
    for (cur, nxt) in current.occurrences.iter().zip(next.occurrences.iter()) {
        if cur.rel_path != nxt.rel_path {
            return false;
        }
        let cur_start_off = cur.start_line - current_base.start_line;
        let nxt_start_off = nxt.start_line - next_base.start_line;
        let cur_end_off = cur.end_line - current_base.end_line;
        let nxt_end_off = nxt.end_line - next_base.end_line;
        if cur_start_off != nxt_start_off || cur_end_off != nxt_end_off {
            return false;
        }
        let overlaps = nxt.start_line <= cur.end_line + 1 && nxt.end_line >= cur.start_line - 1;
        if !overlaps {
            return false;
        }
    }
    true
}

fn merge_duplicate_clusters(current: DuplicateCluster, next: DuplicateCluster) -> DuplicateCluster {
    let occurrences: Vec<_> = current
        .occurrences
        .into_iter()
        .zip(next.occurrences.into_iter())
        .map(|(cur, nxt)| DuplicateOccurrence {
            rel_path: cur.rel_path,
            start_line: cur.start_line.min(nxt.start_line),
            end_line: cur.end_line.max(nxt.end_line),
        })
        .collect();
    let lines = occurrences
        .iter()
        .map(|o| o.end_line - o.start_line + 1)
        .max()
        .unwrap_or(current.lines);
    DuplicateCluster {
        hash: current.hash,
        occurrences,
        lines,
    }
}

fn compact_duplicate_clusters(clusters: Vec<DuplicateCluster>) -> Vec<DuplicateCluster> {
    let mut grouped: HashMap<String, Vec<DuplicateCluster>> = HashMap::new();
    for cluster in clusters {
        grouped
            .entry(duplicate_signature(&cluster.occurrences))
            .or_default()
            .push(cluster);
    }

    let mut merged_clusters = Vec::new();
    for mut items in grouped.into_values() {
        items.sort_by(|a, b| cluster_order_value(a).cmp(&cluster_order_value(b)));
        let mut current = items.remove(0);
        for next in items {
            if has_stable_duplicate_alignment(&current, &next) {
                current = merge_duplicate_clusters(current, next);
            } else {
                merged_clusters.push(current);
                current = next;
            }
        }
        merged_clusters.push(current);
    }
    merged_clusters
}

pub fn get_heatmap_from_mtime(conn: &Connection, folder_id: i64, days: i64) -> AppResult<Vec<HeatmapBucket>> {
    let cutoff = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
        now - days.max(1) * 24 * 60 * 60 * 1000
    };
    let mut stmt = conn.prepare(
        "SELECT mtime, total FROM files WHERE folder_id = ? AND deleted = 0 AND mtime >= ?",
    )?;
    let mut map: HashMap<String, (i64, i64)> = HashMap::new();
    let rows = stmt.query_map(rusqlite::params![folder_id, cutoff], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
    })?;
    for (mtime, total) in rows.flatten() {
        let date = chrono::DateTime::from_timestamp_millis(mtime)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "1970-01-01".into());
        let e = map.entry(date).or_insert((0, 0));
        e.0 += 1;
        e.1 += total;
    }
    let mut out: Vec<HeatmapBucket> = map
        .into_iter()
        .map(|(date, (files, lines))| HeatmapBucket { date, files, lines })
        .collect();
    out.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(out)
}
