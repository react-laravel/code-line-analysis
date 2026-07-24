mod api_routes;
mod file_relations;
mod laravel_schema;

pub use api_routes::build_api_route_overview;
pub use file_relations::build_file_relation_graph;
pub use laravel_schema::build_laravel_schema_graph;

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::Path;

#[derive(Clone)]
pub struct SourceFile {
    pub rel_path: String,
    pub lang: String,
    pub total: i64,
    pub code: i64,
    pub content: String,
}

pub fn load_source_files(conn: &Connection, folder_id: i64, root: &Path) -> AppResult<Vec<SourceFile>> {
    let mut stmt = conn.prepare(
        "SELECT rel_path, lang, total, code FROM files WHERE folder_id = ? AND deleted = 0",
    )?;
    let rows: Vec<_> = stmt
        .query_map([folder_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?))
        })?
        .flatten()
        .collect();
    let mut out = Vec::new();
    for (rel, lang, total, code) in rows {
        let path = root.join(&rel);
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        // skip huge files for analysis
        if content.len() > 2_000_000 { continue; }
        out.push(SourceFile { rel_path: rel, lang, total, code, content });
    }
    Ok(out)
}
