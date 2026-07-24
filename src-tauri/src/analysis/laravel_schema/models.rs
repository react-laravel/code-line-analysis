use super::helpers::{
    default_foreign_key_for_table, default_morph_id_column, default_morph_pivot_table,
    default_morph_type_column, default_pivot_table_name, default_table_name, format_bare_columns,
    format_table_columns, is_test_file_path, normalize_rel_path, read_string_literal, snake_case,
    split_args, table_name_from_class,
};
use super::migrations::{add_relation, ensure_table};
use crate::analysis::SourceFile;
use crate::types::LaravelSchemaRelation;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

const RELATIONSHIP_METHODS: &[&str] = &[
    "belongsTo",
    "hasOne",
    "hasMany",
    "belongsToMany",
    "morphOne",
    "morphMany",
    "morphTo",
    "morphToMany",
    "morphedByMany",
];

pub struct ParsedModelRelationship {
    pub method_name: String,
    pub kind: String,
    pub target_class: Option<String>,
    pub source_column: Option<String>,
    pub target_column: Option<String>,
    pub pivot_table: Option<String>,
    pub morph_name: Option<String>,
    pub morph_type_column: Option<String>,
}

pub struct ParsedModel {
    pub fqcn: String,
    pub rel_path: String,
    pub table: String,
    pub relationships: Vec<ParsedModelRelationship>,
}

fn php_namespace(content: &str) -> String {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*namespace\s+([^;]+);").unwrap());
    RE.captures(content)
        .map(|c| c.get(1).unwrap().as_str().trim().trim_end_matches('\\').to_string())
        .unwrap_or_default()
}

fn expand_php_use_statement(statement: &str) -> Vec<String> {
    let normalized = Regex::new(r"\s+")
        .unwrap()
        .replace_all(statement.trim(), " ")
        .to_string();
    if normalized.is_empty()
        || normalized.starts_with("function ")
        || normalized.starts_with("const ")
    {
        return vec![];
    }

    if let Some(group_start) = normalized.find('{') {
        let group_end = normalized.rfind('}');
        if group_end.map(|e| e > group_start).unwrap_or(false)
            && group_start > 0
            && normalized.as_bytes()[group_start - 1] == b'\\'
        {
            let prefix = normalized[..group_start - 1]
                .trim()
                .trim_start_matches('\\')
                .trim_end_matches('\\');
            return normalized[group_start + 1..group_end.unwrap()]
                .split(',')
                .map(|part| {
                    let alias_re =
                        Regex::new(r"\s+as\s+[A-Za-z_][A-Za-z0-9_]*$").unwrap();
                    format!(
                        "{prefix}\\{}",
                        alias_re.replace(part.trim(), "").trim()
                    )
                })
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    normalized
        .split(',')
        .map(|p| p.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn php_uses(content: &str) -> HashMap<String, String> {
    static USE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*use\s+([\s\S]*?);").unwrap());
    static ALIAS: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$").unwrap());

    let mut uses = HashMap::new();
    for caps in USE.captures_iter(content) {
        for item in expand_php_use_statement(caps.get(1).map(|m| m.as_str()).unwrap_or("")) {
            let alias = ALIAS
                .captures(&item)
                .map(|c| c.get(1).unwrap().as_str().to_string());
            let fqcn = ALIAS
                .replace(&item, "")
                .trim()
                .trim_start_matches('\\')
                .to_string();
            let alias = alias.unwrap_or_else(|| {
                fqcn.split('\\')
                    .filter(|s| !s.is_empty())
                    .last()
                    .unwrap_or("")
                    .to_string()
            });
            if !alias.is_empty() && !fqcn.is_empty() {
                uses.insert(alias, fqcn);
            }
        }
    }
    uses
}

fn model_class_name(content: &str) -> Option<(String, Option<String>)> {
    static RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:extends\s+([^\s{]+))?").unwrap());
    RE.captures(content).map(|c| {
        (
            c.get(1).unwrap().as_str().to_string(),
            c.get(2).map(|m| m.as_str().to_string()),
        )
    })
}

fn is_model_file(rel_path: &str, class_info: Option<&(String, Option<String>)>) -> bool {
    let Some((_, extends_name)) = class_info else {
        return false;
    };
    if !rel_path.ends_with(".php") || is_test_file_path(rel_path) {
        return false;
    }
    if !rel_path.starts_with("app/") {
        return false;
    }
    if rel_path.starts_with("app/Models/") {
        return true;
    }
    extends_name
        .as_deref()
        .map(|e| Regex::new(r"(?:^|\\)(Model|Authenticatable)$").unwrap().is_match(e))
        .unwrap_or(false)
}

fn resolve_class_reference(
    value: Option<&str>,
    namespace: &str,
    uses: &HashMap<String, String>,
) -> Option<String> {
    let value = value?;
    let trimmed = value
        .trim()
        .trim_end_matches("::class")
        .trim_matches(['\'', '"'])
        .trim_start_matches('\\');
    if trimmed.is_empty() || trimmed.contains('$') || trimmed == "self" || trimmed == "static" {
        return None;
    }
    let parts: Vec<&str> = trimmed.split('\\').filter(|s| !s.is_empty()).collect();
    let head = parts.first()?;
    if let Some(used) = uses.get(*head) {
        let rest: Vec<&str> = parts.iter().copied().skip(1).collect();
        return Some(if rest.is_empty() {
            used.clone()
        } else {
            format!("{used}\\{}", rest.join("\\"))
        });
    }
    if trimmed.contains('\\') {
        return Some(trimmed.to_string());
    }
    if namespace.is_empty() {
        Some(trimmed.to_string())
    } else {
        Some(format!("{namespace}\\{trimmed}"))
    }
}

fn parse_relationship_args(
    method_name: &str,
    kind: &str,
    args: &str,
    namespace: &str,
    uses: &HashMap<String, String>,
    source_table: &str,
) -> Option<ParsedModelRelationship> {
    if !RELATIONSHIP_METHODS.contains(&kind) {
        return None;
    }
    let parts = split_args(args);
    let target_class = if kind == "morphTo" {
        None
    } else {
        resolve_class_reference(parts.first().map(|s| s.as_str()), namespace, uses)
    };
    let target_table = table_name_from_class(target_class.as_deref());

    match kind {
        "belongsTo" => {
            let target_class = target_class?;
            Some(ParsedModelRelationship {
                method_name: method_name.to_string(),
                kind: kind.to_string(),
                target_class: Some(target_class),
                source_column: read_string_literal(parts.get(1)?.as_str())
                    .or_else(|| Some(format!("{}_id", snake_case(method_name)))),
                target_column: read_string_literal(parts.get(2).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some("id".into())),
                pivot_table: None,
                morph_name: None,
                morph_type_column: None,
            })
        }
        "hasOne" | "hasMany" => {
            let target_class = target_class?;
            Some(ParsedModelRelationship {
                method_name: method_name.to_string(),
                kind: kind.to_string(),
                target_class: Some(target_class),
                source_column: read_string_literal(parts.get(1).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_foreign_key_for_table(source_table))),
                target_column: read_string_literal(parts.get(2).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some("id".into())),
                pivot_table: None,
                morph_name: None,
                morph_type_column: None,
            })
        }
        "morphTo" => {
            let morph_name = read_string_literal(parts.first().map(|s| s.as_str()).unwrap_or(""))
                .unwrap_or_else(|| method_name.to_string());
            Some(ParsedModelRelationship {
                method_name: method_name.to_string(),
                kind: kind.to_string(),
                target_class: None,
                source_column: read_string_literal(parts.get(2).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_id_column(&morph_name))),
                target_column: read_string_literal(parts.get(3).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some("id".into())),
                pivot_table: None,
                morph_name: Some(morph_name),
                morph_type_column: read_string_literal(parts.get(1).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_type_column(
                        read_string_literal(parts.first().map(|s| s.as_str()).unwrap_or(""))
                            .unwrap_or_else(|| method_name.to_string())
                            .as_str(),
                    ))),
            })
        }
        "morphOne" | "morphMany" => {
            let target_class = target_class?;
            let morph_name = read_string_literal(parts.get(1).map(|s| s.as_str()).unwrap_or(""))
                .unwrap_or_else(|| method_name.to_string());
            Some(ParsedModelRelationship {
                method_name: method_name.to_string(),
                kind: kind.to_string(),
                target_class: Some(target_class),
                source_column: read_string_literal(parts.get(3).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_id_column(&morph_name))),
                target_column: read_string_literal(parts.get(4).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some("id".into())),
                pivot_table: None,
                morph_name: Some(morph_name.clone()),
                morph_type_column: read_string_literal(parts.get(2).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_type_column(&morph_name))),
            })
        }
        "belongsToMany" => {
            let target_class = target_class?;
            Some(ParsedModelRelationship {
                method_name: method_name.to_string(),
                kind: kind.to_string(),
                target_class: Some(target_class),
                source_column: read_string_literal(parts.get(2).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_foreign_key_for_table(source_table))),
                target_column: read_string_literal(parts.get(3).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| target_table.as_ref().map(|t| default_foreign_key_for_table(t))),
                pivot_table: read_string_literal(parts.get(1).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| {
                        target_table
                            .as_ref()
                            .map(|t| default_pivot_table_name(source_table, t))
                    }),
                morph_name: None,
                morph_type_column: None,
            })
        }
        "morphToMany" => {
            let target_class = target_class?;
            let morph_name = read_string_literal(parts.get(1).map(|s| s.as_str()).unwrap_or(""))
                .unwrap_or_else(|| method_name.to_string());
            Some(ParsedModelRelationship {
                method_name: method_name.to_string(),
                kind: kind.to_string(),
                target_class: Some(target_class),
                source_column: read_string_literal(parts.get(3).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_id_column(&morph_name))),
                target_column: read_string_literal(parts.get(4).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| target_table.map(|t| default_foreign_key_for_table(&t))),
                pivot_table: read_string_literal(parts.get(2).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_pivot_table(&morph_name))),
                morph_name: Some(morph_name.clone()),
                morph_type_column: Some(default_morph_type_column(&morph_name)),
            })
        }
        "morphedByMany" => {
            let target_class = target_class?;
            let morph_name = read_string_literal(parts.get(1).map(|s| s.as_str()).unwrap_or(""))
                .unwrap_or_else(|| method_name.to_string());
            Some(ParsedModelRelationship {
                method_name: method_name.to_string(),
                kind: kind.to_string(),
                target_class: Some(target_class),
                source_column: read_string_literal(parts.get(3).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_foreign_key_for_table(source_table))),
                target_column: read_string_literal(parts.get(4).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_id_column(&morph_name))),
                pivot_table: read_string_literal(parts.get(2).map(|s| s.as_str()).unwrap_or(""))
                    .or_else(|| Some(default_morph_pivot_table(&morph_name))),
                morph_name: Some(morph_name.clone()),
                morph_type_column: Some(default_morph_type_column(&morph_name)),
            })
        }
        _ => Some(ParsedModelRelationship {
            method_name: method_name.to_string(),
            kind: kind.to_string(),
            target_class,
            source_column: None,
            target_column: None,
            pivot_table: None,
            morph_name: None,
            morph_type_column: None,
        }),
    }
}

fn parse_model_relationships(
    content: &str,
    namespace: &str,
    uses: &HashMap<String, String>,
    source_table: &str,
) -> Vec<ParsedModelRelationship> {
    static METHOD: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^{]*\{([\s\S]*?return\s+\$this->[A-Za-z_][A-Za-z0-9_]*\s*\([\s\S]*?;)[\s\S]*?\}",
        )
        .unwrap()
    });
    static REL: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\$this->([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)").unwrap());

    let mut relationships = Vec::new();
    for caps in METHOD.captures_iter(content) {
        let method_name = caps.get(1).unwrap().as_str();
        let body = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        if let Some(rel) = REL.captures(body) {
            let kind = rel.get(1).unwrap().as_str();
            if let Some(relationship) = parse_relationship_args(
                method_name,
                kind,
                rel.get(2).map(|m| m.as_str()).unwrap_or(""),
                namespace,
                uses,
                source_table,
            ) {
                relationships.push(relationship);
            }
        }
    }
    relationships
}

pub fn parse_models(files: &[SourceFile]) -> Vec<ParsedModel> {
    static TABLE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"protected\s+\$table\s*=\s*['"]([^'"]+)['"]\s*;"#).unwrap()
    });

    let mut models = Vec::new();
    for file in files {
        let class_info = model_class_name(&file.content);
        let rel_path = normalize_rel_path(&file.rel_path);
        if !is_model_file(&rel_path, class_info.as_ref()) {
            continue;
        }
        let (class_name, _) = class_info.unwrap();
        let namespace = php_namespace(&file.content);
        let uses = php_uses(&file.content);
        let table = TABLE
            .captures(&file.content)
            .map(|c| c.get(1).unwrap().as_str().to_string())
            .unwrap_or_else(|| default_table_name(&class_name));
        let fqcn = if namespace.is_empty() {
            class_name.clone()
        } else {
            format!("{namespace}\\{class_name}")
        };

        models.push(ParsedModel {
            fqcn,
            rel_path,
            table: table.clone(),
            relationships: parse_model_relationships(&file.content, &namespace, &uses, &table),
        });
    }
    models
}

fn format_model_relation_label(
    relation: &ParsedModelRelationship,
    source_table: &str,
    target_table: &str,
) -> String {
    match relation.kind.as_str() {
        "belongsTo" => format!(
            "{}: {}.{} -> {}.{}",
            relation.kind,
            source_table,
            relation.source_column.as_deref().unwrap_or("?"),
            target_table,
            relation.target_column.as_deref().unwrap_or("id")
        ),
        "hasOne" | "hasMany" => format!(
            "{}: {}.{} -> {}.{}",
            relation.kind,
            source_table,
            relation.target_column.as_deref().unwrap_or("id"),
            target_table,
            relation.source_column.as_deref().unwrap_or("?")
        ),
        "morphTo" => format!(
            "{}: {} -> {}.{}",
            relation.kind,
            format_table_columns(
                source_table,
                &[
                    relation.morph_type_column.clone(),
                    relation.source_column.clone(),
                ],
            ),
            target_table,
            relation.target_column.as_deref().unwrap_or("id")
        ),
        "morphOne" | "morphMany" => format!(
            "{}: {}.{} -> {}",
            relation.kind,
            source_table,
            relation.target_column.as_deref().unwrap_or("id"),
            format_table_columns(
                target_table,
                &[
                    relation.morph_type_column.clone(),
                    relation.source_column.clone(),
                ],
            )
        ),
        "belongsToMany" => format!(
            "{}: {} <-> {} via {} ({})",
            relation.kind,
            source_table,
            target_table,
            relation
                .pivot_table
                .as_deref()
                .unwrap_or(&default_pivot_table_name(source_table, target_table)),
            format_bare_columns(&[relation.source_column.clone(), relation.target_column.clone()])
        ),
        "morphToMany" | "morphedByMany" => format!(
            "{}: {} <-> {} via {} ({})",
            relation.kind,
            source_table,
            target_table,
            relation.pivot_table.as_deref().unwrap_or(&default_morph_pivot_table(
                relation
                    .morph_name
                    .as_deref()
                    .unwrap_or(&relation.method_name)
            )),
            format_bare_columns(&[
                relation.morph_type_column.clone(),
                relation.source_column.clone(),
                relation.target_column.clone(),
            ])
        ),
        _ => relation.kind.clone(),
    }
}

fn resolve_morph_to_targets<'a>(
    source_model: &'a ParsedModel,
    relationship: &ParsedModelRelationship,
    models: &'a [ParsedModel],
) -> Vec<&'a ParsedModel> {
    if relationship.kind != "morphTo" {
        return vec![];
    }
    let Some(morph_name) = relationship.morph_name.as_ref() else {
        return vec![];
    };
    models
        .iter()
        .filter(|model| {
            model.fqcn != source_model.fqcn
                && model.relationships.iter().any(|candidate| {
                    (candidate.kind == "morphOne" || candidate.kind == "morphMany")
                        && candidate.target_class.as_deref() == Some(&source_model.fqcn)
                        && candidate.morph_name.as_deref() == Some(morph_name.as_str())
                })
        })
        .collect()
}

pub fn add_model_relations(
    models: &[ParsedModel],
    tables: &mut HashMap<String, crate::types::LaravelSchemaTable>,
    relations: &mut HashMap<String, LaravelSchemaRelation>,
) -> i64 {
    let models_by_fqcn: HashMap<&str, &ParsedModel> =
        models.iter().map(|m| (m.fqcn.as_str(), m)).collect();
    let mut unresolved = 0i64;

    for model in models {
        let table = ensure_table(tables, &model.table);
        table.model_class = Some(model.fqcn.clone());
        table.model_path = Some(model.rel_path.clone());

        for relationship in &model.relationships {
            if relationship.kind == "morphTo" {
                let targets = resolve_morph_to_targets(model, relationship, models);
                if targets.is_empty() {
                    unresolved += 1;
                    continue;
                }
                for target_model in targets {
                    ensure_table(tables, &target_model.table);
                    add_relation(
                        relations,
                        LaravelSchemaRelation {
                            source_table: model.table.clone(),
                            target_table: target_model.table.clone(),
                            kind: relationship.kind.clone(),
                            label: format_model_relation_label(
                                relationship,
                                &model.table,
                                &target_model.table,
                            ),
                            source_column: relationship.source_column.clone(),
                            target_column: relationship.target_column.clone(),
                            source_model: Some(model.fqcn.clone()),
                            target_model: Some(target_model.fqcn.clone()),
                            source_file: Some(model.rel_path.clone()),
                        },
                    );
                }
                continue;
            }

            let target_model = relationship
                .target_class
                .as_deref()
                .and_then(|fqcn| models_by_fqcn.get(fqcn).copied());
            if target_model.is_none() {
                unresolved += 1;
            }
            let target_table = target_model
                .map(|m| m.table.clone())
                .or_else(|| table_name_from_class(relationship.target_class.as_deref()));
            let Some(target_table) = target_table else {
                continue;
            };

            ensure_table(tables, &target_table);
            add_relation(
                relations,
                LaravelSchemaRelation {
                    source_table: model.table.clone(),
                    target_table,
                    kind: relationship.kind.clone(),
                    label: format_model_relation_label(
                        relationship,
                        &model.table,
                        target_model.map(|m| m.table.as_str()).unwrap_or(""),
                    ),
                    source_column: relationship.source_column.clone(),
                    target_column: relationship.target_column.clone(),
                    source_model: Some(model.fqcn.clone()),
                    target_model: relationship.target_class.clone(),
                    source_file: Some(model.rel_path.clone()),
                },
            );
        }
    }

    unresolved
}
