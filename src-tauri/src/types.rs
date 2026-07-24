use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRow {
    pub id: i64,
    pub root_path: String,
    pub name: String,
    pub created_at: i64,
    pub is_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderRules {
    pub whitelist: Vec<String>,
    pub blacklist: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub folder_id: i64,
    pub phase: String,
    pub total: usize,
    pub done: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_hits: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub full: Option<bool>,
    pub detect_duplicates: Option<bool>,
    pub duplicate_min_lines: Option<i64>,
    pub duplicate_rules: Option<FolderRules>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LangStat {
    pub lang: String,
    pub files: i64,
    pub total: i64,
    pub code: i64,
    pub comment: i64,
    pub blank: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    pub total_files: i64,
    pub total_lines: i64,
    pub total_code: i64,
    pub runtime_code: i64,
    pub test_code: i64,
    pub total_comment: i64,
    pub total_blank: i64,
    pub total_block_comment: i64,
    pub by_lang: Vec<LangStat>,
    pub tag_counts: HashMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub total: i64,
    pub code: i64,
    pub comment: i64,
    pub blank: i64,
    pub files: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DirNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopFile {
    pub rel_path: String,
    pub total: i64,
    pub code: i64,
    pub size: i64,
    pub lang: String,
    pub last_commit_date: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopFunction {
    pub rel_path: String,
    pub name: String,
    pub start_line: i64,
    pub end_line: i64,
    pub length: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRow {
    pub file_id: i64,
    pub kind: String,
    pub line_no: i64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapBucket {
    pub date: String,
    pub files: i64,
    pub lines: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateOccurrence {
    pub rel_path: String,
    pub start_line: i64,
    pub end_line: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCluster {
    pub hash: String,
    pub occurrences: Vec<DuplicateOccurrence>,
    pub lines: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub rel_path: String,
    pub size: i64,
    pub mtime: i64,
    pub lang: String,
    pub total: i64,
    pub code: i64,
    pub comment: i64,
    pub blank: i64,
    pub block_comment: i64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAuthorStat {
    pub author: String,
    pub lines: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileInfo {
    pub last_sha: Option<String>,
    pub last_author: Option<String>,
    pub last_date: Option<i64>,
    pub top_authors: Vec<GitAuthorStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub last_commit_sha: Option<String>,
    pub last_commit_date: Option<i64>,
    pub remote_origin_url: Option<String>,
    pub remote_origin_web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNodeContextMenuLabels {
    pub copy_name: String,
    pub copy_relative_path: String,
    pub copy_absolute_path: String,
    pub open_path: String,
    pub reveal_in_finder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNodeContextMenuRequest {
    pub folder_id: i64,
    pub rel_path: String,
    pub display_name: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub labels: TreeNodeContextMenuLabels,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRouteEntry {
    pub framework: String,
    pub methods: Vec<String>,
    pub path: String,
    pub handler: String,
    pub source_file: String,
    pub route_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRouteOverview {
    pub frameworks: Vec<String>,
    pub routes: Vec<ApiRouteEntry>,
    pub laravel_route_files: i64,
    pub next_route_files: i64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRelationNode {
    pub id: String,
    pub rel_path: String,
    pub lang: String,
    pub total: i64,
    pub code: i64,
    pub incoming: i64,
    pub outgoing: i64,
    pub group: String,
    pub is_test: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRelationEdge {
    pub source: String,
    pub target: String,
    pub value: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRelationGraph {
    pub nodes: Vec<FileRelationNode>,
    pub edges: Vec<FileRelationEdge>,
    pub scanned_files: i64,
    pub connected_files: i64,
    pub unresolved_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaravelSchemaColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub nullable: bool,
    pub indexed: bool,
    pub unique: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaravelSchemaTable {
    pub name: String,
    pub columns: Vec<LaravelSchemaColumn>,
    pub migration_files: Vec<String>,
    pub model_class: Option<String>,
    pub model_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaravelSchemaRelation {
    pub source_table: String,
    pub target_table: String,
    pub kind: String,
    pub label: String,
    pub source_column: Option<String>,
    pub target_column: Option<String>,
    pub source_model: Option<String>,
    pub target_model: Option<String>,
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaravelSchemaGraph {
    pub is_laravel: bool,
    pub detected_by: Vec<String>,
    pub tables: Vec<LaravelSchemaTable>,
    pub relations: Vec<LaravelSchemaRelation>,
    pub migration_count: i64,
    pub model_count: i64,
    pub unresolved_model_relations: i64,
    pub warnings: Vec<String>,
}
