mod helpers;
mod migrations;
mod models;

use crate::analysis::SourceFile;
use crate::types::{LaravelSchemaGraph, LaravelSchemaTable};
use helpers::normalize_rel_path;
use migrations::parse_migrations;
use models::{add_model_relations, parse_models};
use std::collections::HashMap;

fn detect_laravel(files: &[SourceFile], migration_count: i64, model_count: i64) -> Vec<String> {
    let mut detected_by = Vec::new();

    if let Some(composer) = files.iter().find(|f| normalize_rel_path(&f.rel_path) == "composer.json")
    {
        if composer.content.contains("\"laravel/framework\"") {
            detected_by.push("composer:laravel/framework".into());
        }
    }

    if files.iter().any(|f| {
        normalize_rel_path(&f.rel_path) == "artisan"
            && f.content.contains("Illuminate\\Foundation\\Console\\Kernel")
    }) {
        detected_by.push("artisan".into());
    }

    if files
        .iter()
        .any(|f| normalize_rel_path(&f.rel_path) == "bootstrap/app.php")
    {
        detected_by.push("bootstrap/app.php".into());
    }

    if migration_count > 0 {
        detected_by.push("database/migrations".into());
    }
    if model_count > 0 {
        detected_by.push("eloquent-models".into());
    }

    detected_by.sort();
    detected_by.dedup();
    detected_by
}

pub fn build_laravel_schema_graph(files: &[SourceFile]) -> LaravelSchemaGraph {
    let normalized: Vec<SourceFile> = files
        .iter()
        .map(|f| SourceFile {
            rel_path: normalize_rel_path(&f.rel_path),
            ..f.clone()
        })
        .collect();

    let mut tables: HashMap<String, LaravelSchemaTable> = HashMap::new();
    let mut relations: HashMap<String, crate::types::LaravelSchemaRelation> = HashMap::new();

    let migration_count = parse_migrations(&normalized, &mut tables, &mut relations);
    let parsed_models = parse_models(&normalized);
    let model_count = parsed_models.len() as i64;
    let unresolved_model_relations =
        add_model_relations(&parsed_models, &mut tables, &mut relations);
    let detected_by = detect_laravel(&normalized, migration_count, model_count);

    let mut sorted_tables: Vec<LaravelSchemaTable> = tables.into_values().collect();
    for table in &mut sorted_tables {
        table.columns.sort_by(|a, b| {
            if a.name == "id" {
                std::cmp::Ordering::Less
            } else if b.name == "id" {
                std::cmp::Ordering::Greater
            } else {
                a.name.cmp(&b.name)
            }
        });
        table.migration_files.sort();
    }
    sorted_tables.sort_by(|a, b| {
        b.columns
            .len()
            .cmp(&a.columns.len())
            .then_with(|| a.name.cmp(&b.name))
    });

    let mut sorted_relations: Vec<_> = relations.into_values().collect();
    sorted_relations.sort_by(|a, b| {
        a.source_table
            .cmp(&b.source_table)
            .then_with(|| a.target_table.cmp(&b.target_table))
            .then_with(|| a.kind.cmp(&b.kind))
    });

    let warnings = if unresolved_model_relations > 0 {
        vec![format!(
            "{unresolved_model_relations} model relations could not be resolved to scanned model files."
        )]
    } else {
        vec![]
    };

    LaravelSchemaGraph {
        is_laravel: !detected_by.is_empty(),
        detected_by,
        tables: sorted_tables,
        relations: sorted_relations,
        migration_count,
        model_count,
        unresolved_model_relations,
        warnings,
    }
}
