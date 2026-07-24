use super::helpers::{
    class_name_from_class_expr, column_name_for_foreign_id_for, default_table_name, has_chain, infer_constrained_table, named_string_arg, read_first_string,
    read_string_literal, split_args,
};
use crate::analysis::SourceFile;
use crate::types::{LaravelSchemaColumn, LaravelSchemaRelation, LaravelSchemaTable};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

static SCHEMA_BLOCK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"Schema::(create|table)\s*\(\s*['"]([^'"]+)['"][\s\S]*?function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{([\s\S]*?)\n\s*\}\s*\);"#,
    )
    .unwrap()
});

static TABLE_STMT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\$table->([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*([^;]*);").unwrap()
});

const NO_ARG_COLUMNS: &[(&str, &[(&str, &str)])] = &[
    ("id", &[("id", "id")]),
    (
        "timestamps",
        &[("created_at", "timestamp"), ("updated_at", "timestamp")],
    ),
    (
        "timestampsTz",
        &[("created_at", "timestampTz"), ("updated_at", "timestampTz")],
    ),
    (
        "nullableTimestamps",
        &[("created_at", "timestamp"), ("updated_at", "timestamp")],
    ),
    ("softDeletes", &[("deleted_at", "timestamp")]),
    ("softDeletesTz", &[("deleted_at", "timestampTz")]),
    ("rememberToken", &[("remember_token", "string")]),
];

fn column_methods() -> &'static std::collections::HashSet<&'static str> {
    static METHODS: Lazy<std::collections::HashSet<&str>> = Lazy::new(|| {
        [
            "bigIncrements", "bigInteger", "binary", "boolean", "char", "date", "dateTime",
            "dateTimeTz", "decimal", "double", "enum", "float", "foreignId", "foreignIdFor",
            "foreignUlid", "foreignUuid", "geometry", "id", "increments", "integer", "ipAddress",
            "json", "jsonb", "longText", "mediumIncrements", "mediumInteger", "mediumText",
            "morphs", "nullableMorphs", "nullableTimestamps", "rememberToken", "set",
            "smallIncrements", "smallInteger", "mediumText", "softDeletes", "softDeletesTz",
            "string", "text", "time", "timeTz", "timestamp", "timestamps", "timestampsTz",
            "tinyIncrements", "tinyInteger", "unsignedBigInteger", "unsignedInteger",
            "unsignedMediumInteger", "unsignedSmallInteger", "unsignedTinyInteger", "ulid",
            "uuid", "year",
        ]
        .into_iter()
        .collect()
    });
    &METHODS
}

pub fn ensure_table<'a>(
    tables: &'a mut HashMap<String, LaravelSchemaTable>,
    name: &str,
) -> &'a mut LaravelSchemaTable {
    if !tables.contains_key(name) {
        tables.insert(
            name.to_string(),
            LaravelSchemaTable {
                name: name.to_string(),
                columns: vec![],
                migration_files: vec![],
                model_class: None,
                model_path: None,
            },
        );
    }
    tables.get_mut(name).unwrap()
}

fn add_column(table: &mut LaravelSchemaTable, column: LaravelSchemaColumn) {
    if let Some(existing) = table.columns.iter_mut().find(|c| c.name == column.name) {
        if existing.type_name == "unknown" {
            existing.type_name = column.type_name;
        }
        existing.nullable |= column.nullable;
        existing.indexed |= column.indexed;
        existing.unique |= column.unique;
    } else {
        table.columns.push(column);
    }
}

pub fn add_relation(
    relations: &mut HashMap<String, LaravelSchemaRelation>,
    relation: LaravelSchemaRelation,
) {
    if relation.source_table.is_empty()
        || relation.target_table.is_empty()
        || relation.source_table == relation.target_table
    {
        return;
    }
    let key = format!(
        "{}|{}|{}|{}|{}|{}|{}",
        relation.source_table,
        relation.target_table,
        relation.kind,
        relation.source_column.as_deref().unwrap_or(""),
        relation.target_column.as_deref().unwrap_or(""),
        relation.source_model.as_deref().unwrap_or(""),
        relation.target_model.as_deref().unwrap_or(""),
    );
    relations.insert(key, relation);
}

fn add_columns_from_statement(
    table: &mut LaravelSchemaTable,
    method: &str,
    args: &str,
    chain: &str,
) {
    let nullable = has_chain(chain, "nullable")
        || method == "nullableMorphs"
        || method == "nullableTimestamps";
    let indexed = has_chain(chain, "index")
        || has_chain(chain, "constrained")
        || method.starts_with("foreign")
        || method.ends_with("Morphs");
    let unique = has_chain(chain, "unique");
    let parts = split_args(args);
    let first_arg = parts.first().map(|s| s.as_str()).unwrap_or("");
    let first_string = read_string_literal(first_arg).or_else(|| read_first_string(first_arg));

    if let Some((_, cols)) = NO_ARG_COLUMNS.iter().find(|(m, _)| *m == method) {
        for (name, type_name) in *cols {
            add_column(
                table,
                LaravelSchemaColumn {
                    name: name.to_string(),
                    type_name: (*type_name).to_string(),
                    nullable,
                    indexed,
                    unique,
                    source: "migration".into(),
                },
            );
        }
        return;
    }

    if method == "morphs" || method == "nullableMorphs" {
        let Some(name) = first_string else { return };
        add_column(
            table,
            LaravelSchemaColumn {
                name: format!("{name}_type"),
                type_name: "string".into(),
                nullable,
                indexed: true,
                unique,
                source: "migration".into(),
            },
        );
        add_column(
            table,
            LaravelSchemaColumn {
                name: format!("{name}_id"),
                type_name: "unsignedBigInteger".into(),
                nullable,
                indexed: true,
                unique,
                source: "migration".into(),
            },
        );
        return;
    }

    if method == "foreignIdFor" {
        let Some(column_name) = column_name_for_foreign_id_for(args) else {
            return;
        };
        add_column(
            table,
            LaravelSchemaColumn {
                name: column_name,
                type_name: method.to_string(),
                nullable,
                indexed: true,
                unique,
                source: "migration".into(),
            },
        );
        return;
    }

    if !column_methods().contains(method) {
        return;
    }
    let Some(name) = first_string else { return };
    add_column(
        table,
        LaravelSchemaColumn {
            name,
            type_name: method.to_string(),
            nullable,
            indexed,
            unique,
            source: "migration".into(),
        },
    );
}

fn parse_constrained_table(args: &str, source_column: &str) -> Option<String> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"->constrained\s*\(([^)]*)\)").unwrap());
    let caps = RE.captures(args)?;
    let constrained_args = caps.get(1).map(|m| m.as_str()).unwrap_or("");
    named_string_arg(constrained_args, "table")
        .or_else(|| read_first_string(constrained_args))
        .or_else(|| Some(infer_constrained_table(source_column)))
}

fn add_migration_relations(
    table_name: &str,
    migration_file: &str,
    method: &str,
    args: &str,
    chain: &str,
    relations: &mut HashMap<String, LaravelSchemaRelation>,
) {
    let parts = split_args(args);
    let first_arg = parts.first().map(|s| s.as_str()).unwrap_or("");
    let first_string = read_string_literal(first_arg).or_else(|| read_first_string(first_arg));
    let explicit_foreign_column = if method == "foreign" {
        first_string.clone()
    } else {
        None
    };
    let source_column = explicit_foreign_column
        .or_else(|| {
            if method == "foreignIdFor" {
                column_name_for_foreign_id_for(args)
            } else {
                first_string.clone()
            }
        });
    let Some(source_column) = source_column else {
        return;
    };

    static REFS: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"->references\s*\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap()
    });
    static ON: Lazy<Regex> =
        Lazy::new(|| Regex::new(r#"->on\s*\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap());

    let target_column = REFS
        .captures(chain)
        .map(|c| c.get(1).unwrap().as_str().to_string())
        .unwrap_or_else(|| "id".into());
    let on_table = ON
        .captures(chain)
        .map(|c| c.get(1).unwrap().as_str().to_string());
    let constrained_table = parse_constrained_table(chain, &source_column);
    let mut target_table = on_table.or(constrained_table);

    if target_table.is_none() && method == "foreignIdFor" {
        let target_class = parts
            .first()
            .and_then(|p| class_name_from_class_expr(p.as_str()));
        target_table = target_class.map(|c| default_table_name(&c));
    }

    if target_table.is_none() && method.starts_with("foreign") && source_column.ends_with("_id") {
        target_table = Some(infer_constrained_table(&source_column));
    }

    let Some(target_table) = target_table else {
        return;
    };

    add_relation(
        relations,
        LaravelSchemaRelation {
            source_table: table_name.to_string(),
            target_table: target_table.clone(),
            kind: "foreign-key".into(),
            label: format!("{source_column} -> {target_table}.{target_column}"),
            source_column: Some(source_column),
            target_column: Some(target_column),
            source_model: None,
            target_model: None,
            source_file: Some(migration_file.to_string()),
        },
    );
}

pub fn parse_migrations(
    files: &[SourceFile],
    tables: &mut HashMap<String, LaravelSchemaTable>,
    relations: &mut HashMap<String, LaravelSchemaRelation>,
) -> i64 {
    let mut migration_count = 0i64;

    for file in files {
        let rel_path = super::helpers::normalize_rel_path(&file.rel_path);
        if !rel_path.starts_with("database/migrations/") || !rel_path.ends_with(".php") {
            continue;
        }
        migration_count += 1;

        for caps in SCHEMA_BLOCK.captures_iter(&file.content) {
            let table_name = caps.get(2).unwrap().as_str();
            let body = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let table = ensure_table(tables, table_name);
            if !table.migration_files.contains(&rel_path) {
                table.migration_files.push(rel_path.clone());
            }

            for stmt in TABLE_STMT.captures_iter(body) {
                let method = stmt.get(1).unwrap().as_str();
                let args = stmt.get(2).map(|m| m.as_str()).unwrap_or("");
                let chain = stmt.get(3).map(|m| m.as_str()).unwrap_or("");
                add_columns_from_statement(table, method, args, chain);
                add_migration_relations(table_name, &rel_path, method, args, chain, relations);
            }
        }
    }

    migration_count
}
