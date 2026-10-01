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

pub type SourceRow = (String, String, i64, i64);

pub struct AnalysisSnapshot {
    pub routes: crate::types::ApiRouteOverview,
    pub relations: crate::types::FileRelationGraph,
    pub schema: crate::types::LaravelSchemaGraph,
}

pub fn source_rows(conn: &Connection, folder_id: i64) -> AppResult<Vec<SourceRow>> {
    let mut stmt = conn.prepare(
        "SELECT rel_path, lang, total, code FROM files WHERE folder_id = ? AND deleted = 0",
    )?;
    let rows = stmt
        .query_map([folder_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?))
        })?
        .flatten()
        .collect();
    Ok(rows)
}

pub fn load_source_files(rows: Vec<SourceRow>, root: &Path) -> Vec<SourceFile> {
    let mut out = Vec::new();
    for (rel, lang, total, code) in rows {
        let Some((bytes, _)) = crate::scan::walk::read_regular_file(root, &rel, 2_000_000).ok().flatten() else { continue };
        let Ok(content) = String::from_utf8(bytes) else { continue };
        out.push(SourceFile { rel_path: rel, lang, total, code, content });
    }
    out
}
