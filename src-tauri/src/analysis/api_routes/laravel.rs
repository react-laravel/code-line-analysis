use super::helpers::{
    dirname, find_matching_brace, find_matching_paren, normalize_rel_path, normalize_route_path,
    read_first_string, read_string_literal, sort_methods, split_args,
};
use crate::analysis::SourceFile;
use crate::types::ApiRouteEntry;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{HashMap, HashSet};

struct LaravelRouteContext {
    path_prefix: String,
    controller: Option<String>,
    name_prefix: String,
}

struct LaravelChainCall {
    call_name: String,
    args: String,
}

fn collect_laravel_route_statements(content: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut index = 0usize;
    let bytes = content.as_bytes();

    while index < content.len() {
        let Some(route_index) = content[index..].find("Route::") else {
            break;
        };
        let route_index = index + route_index;

        let mut quote: Option<char> = None;
        let mut paren_depth = 0i32;
        let mut bracket_depth = 0i32;
        let mut brace_depth = 0i32;
        let mut end_index = None;

        for (cursor, ch) in content[route_index..].char_indices() {
            let cursor = route_index + cursor;
            let previous = if cursor > 0 {
                content.as_bytes()[cursor - 1] as char
            } else {
                '\0'
            };

            if let Some(q) = quote {
                if ch == q && previous != '\\' {
                    quote = None;
                }
                continue;
            }

            if ch == '\'' || ch == '"' || ch == '`' {
                quote = Some(ch);
                continue;
            }

            if ch == '(' {
                paren_depth += 1;
            }
            if ch == ')' {
                paren_depth = (paren_depth - 1).max(0);
            }
            if ch == '[' {
                bracket_depth += 1;
            }
            if ch == ']' {
                bracket_depth = (bracket_depth - 1).max(0);
            }
            if ch == '{' {
                brace_depth += 1;
            }
            if ch == '}' {
                brace_depth = (brace_depth - 1).max(0);
            }

            if ch == ';' && paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 {
                end_index = Some(cursor);
                break;
            }
        }

        let Some(end) = end_index else { break };
        statements.push(content[route_index..=end].trim().to_string());
        index = end + 1;
        let _ = bytes;
    }

    statements
}

fn collect_laravel_chain_calls(statement: &str) -> Vec<LaravelChainCall> {
    static HEADER: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"^Route::([A-Za-z_][A-Za-z0-9_]*)\s*\(").unwrap()
    });

    let Some(header) = HEADER.captures(statement) else {
        return vec![];
    };
    let call_name = header.get(1).unwrap().as_str().to_lowercase();
    let open_index = statement.find('(').unwrap_or(0);
    let Some(close_index) = find_matching_paren(statement, open_index) else {
        return vec![];
    };

    let mut calls = vec![LaravelChainCall {
        call_name,
        args: statement[open_index + 1..close_index].to_string(),
    }];

    let mut cursor = close_index + 1;
    while cursor < statement.len() {
        while cursor < statement.len() && statement.as_bytes()[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if statement.get(cursor..cursor + 2) != Some("->") {
            cursor += 1;
            continue;
        }
        cursor += 2;
        while cursor < statement.len() && statement.as_bytes()[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        static NAME: Lazy<Regex> =
            Lazy::new(|| Regex::new(r"^([A-Za-z_][A-Za-z0-9_]*)\s*\(").unwrap());
        let rest = &statement[cursor..];
        let Some(name_match) = NAME.captures(rest) else {
            break;
        };
        let chain_name = name_match.get(1).unwrap().as_str().to_lowercase();
        let chain_open = statement[cursor..]
            .find('(')
            .map(|i| cursor + i)
            .unwrap_or(cursor);
        let Some(chain_close) = find_matching_paren(statement, chain_open) else {
            break;
        };
        calls.push(LaravelChainCall {
            call_name: chain_name,
            args: statement[chain_open + 1..chain_close].to_string(),
        });
        cursor = chain_close + 1;
    }

    calls
}

fn parse_laravel_handler(value: &str) -> String {
    if value.is_empty() || value.contains("function") || value.contains("fn ") {
        return "Closure".into();
    }

    static ARRAY: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"\[\s*([A-Za-z0-9_\\]+)::class\s*,\s*['"`]([^'"`]+)['"`]\s*\]"#).unwrap()
    });
    if let Some(caps) = ARRAY.captures(value) {
        return format!(
            "{}@{}",
            caps.get(1).unwrap().as_str(),
            caps.get(2).unwrap().as_str()
        );
    }

    static CLASS: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"([A-Za-z0-9_\\]+)::class").unwrap());
    if let Some(caps) = CLASS.captures(value) {
        return caps.get(1).unwrap().as_str().to_string();
    }

    read_string_literal(value).unwrap_or_else(|| "Closure".into())
}

fn parse_laravel_controller(value: &str) -> Option<String> {
    static CLASS: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"([A-Za-z0-9_\\]+)::class").unwrap());
    if let Some(caps) = CLASS.captures(value) {
        return Some(caps.get(1).unwrap().as_str().to_string());
    }
    let literal = read_string_literal(value)?;
    if literal.contains('@') {
        None
    } else {
        Some(literal)
    }
}

fn resolve_laravel_route_handler(value: &str, controller: &Option<String>) -> String {
    if let Some(ctrl) = controller {
        if let Some(literal) = read_string_literal(value) {
            if !literal.contains('@') && !literal.contains('\\') {
                return format!("{ctrl}@{literal}");
            }
        }
    }
    parse_laravel_handler(value)
}

fn trim_laravel_route_segment(value: &str) -> String {
    value.trim().trim_matches('/').to_string()
}

fn join_laravel_route_segments(prefix: &str, segment: Option<&str>) -> String {
    let normalized_prefix = trim_laravel_route_segment(prefix);
    let normalized_segment = trim_laravel_route_segment(segment.unwrap_or(""));
    if normalized_prefix.is_empty() {
        return normalized_segment;
    }
    if normalized_segment.is_empty() {
        return normalized_prefix;
    }
    format!("{normalized_prefix}/{normalized_segment}")
}

fn combine_laravel_route_path(prefix: &str, route_path: &str) -> String {
    let normalized = route_path.trim();
    if prefix.is_empty() {
        return normalized.to_string();
    }
    if normalized.is_empty() || normalized == "/" {
        return prefix.to_string();
    }
    join_laravel_route_segments(prefix, Some(normalized))
}

fn parse_laravel_name_segment(value: &str) -> String {
    read_string_literal(value)
        .or_else(|| read_first_string(value))
        .unwrap_or_default()
}

fn normalize_laravel_path(route_path: &str, source_file: &str) -> String {
    let normalized = normalize_route_path(route_path);
    let is_api = source_file == "routes/api.php" || source_file.starts_with("routes/api/");
    if !is_api {
        return normalized;
    }
    if normalized == "/" || normalized == "/api" {
        return "/api".into();
    }
    if normalized.starts_with("/api/") {
        return normalized;
    }
    normalize_route_path(&format!("api{}", normalized))
}

fn parse_match_methods(value: &str) -> Vec<String> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"['"`]([A-Za-z]+)['"`]"#).unwrap());
    let methods: Vec<String> = RE
        .captures_iter(value)
        .map(|c| c.get(1).unwrap().as_str().to_uppercase())
        .collect();
    if methods.is_empty() {
        vec!["ANY".into()]
    } else {
        sort_methods(&methods)
    }
}

fn resolve_laravel_route_name(
    base_name_prefix: &str,
    pending_name: &str,
    tail_calls: &[LaravelChainCall],
) -> Option<String> {
    let tail_name: String = tail_calls
        .iter()
        .filter(|c| c.call_name == "name" || c.call_name == "as")
        .map(|c| parse_laravel_name_segment(&c.args))
        .collect();
    let local = format!("{pending_name}{tail_name}");
    if local.is_empty() {
        None
    } else {
        Some(format!("{base_name_prefix}{local}"))
    }
}

fn laravel_resource_routes(
    resource: &str,
    controller: &str,
    source_file: &str,
    route_name: Option<&str>,
) -> Vec<ApiRouteEntry> {
    let base_path = normalize_laravel_path(resource, source_file);
    let item_path = if base_path == "/" {
        "/{id}".into()
    } else {
        format!("{base_path}/{{id}}")
    };

    let mk = |methods: &[&str], path: &str, handler: &str, suffix: &str| ApiRouteEntry {
        framework: "laravel".into(),
        methods: methods.iter().map(|m| (*m).to_string()).collect(),
        path: path.into(),
        handler: handler.into(),
        source_file: source_file.into(),
        route_name: route_name.map(|n| format!("{n}.{suffix}")),
    };

    vec![
        mk(&["GET"], &base_path, &format!("{controller}@index"), "index"),
        mk(
            &["POST"],
            &base_path,
            &format!("{controller}@store"),
            "store",
        ),
        mk(
            &["GET"],
            &item_path,
            &format!("{controller}@show"),
            "show",
        ),
        mk(
            &["PUT", "PATCH"],
            &item_path,
            &format!("{controller}@update"),
            "update",
        ),
        mk(
            &["DELETE"],
            &item_path,
            &format!("{controller}@destroy"),
            "destroy",
        ),
    ]
}

fn extract_laravel_closure_body(value: &str) -> Option<String> {
    let function_index = value.find("function")?;
    let open_brace = value[function_index..].find('{')? + function_index;
    let close_brace = find_matching_brace(value, open_brace)?;
    Some(value[open_brace + 1..close_brace].to_string())
}

fn parse_laravel_group_context(args: &str) -> LaravelRouteContext {
    let config_arg = split_args(args)
        .into_iter()
        .find(|arg| {
            let t = arg.trim();
            t.starts_with('[') || t.starts_with("array(") || t.starts_with("Array(")
        });

    let Some(config) = config_arg else {
        return LaravelRouteContext {
            path_prefix: String::new(),
            controller: None,
            name_prefix: String::new(),
        };
    };

    static PREFIX: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"['"`]prefix['"`]\s*=>\s*['"`]([^'"`]+)['"`]"#).unwrap()
    });
    static NAME: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"['"`](?:as|name)['"`]\s*=>\s*['"`]([^'"`]+)['"`]"#).unwrap()
    });
    static CTRL: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"['"`]controller['"`]\s*=>\s*([A-Za-z0-9_\\]+)::class"#).unwrap()
    });

    LaravelRouteContext {
        path_prefix: PREFIX
            .captures(&config)
            .map(|c| c.get(1).unwrap().as_str().to_string())
            .unwrap_or_default(),
        controller: CTRL
            .captures(&config)
            .map(|c| c.get(1).unwrap().as_str().to_string()),
        name_prefix: NAME
            .captures(&config)
            .map(|c| c.get(1).unwrap().as_str().to_string())
            .unwrap_or_default(),
    }
}

fn collect_laravel_routes_from_content(
    content: &str,
    source_file: &str,
    context: &LaravelRouteContext,
) -> Vec<ApiRouteEntry> {
    let mut routes = Vec::new();

    for statement in collect_laravel_route_statements(content) {
        let calls = collect_laravel_chain_calls(&statement);
        if calls.is_empty() {
            continue;
        }

        let mut path_prefix = context.path_prefix.clone();
        let mut controller = context.controller.clone();
        let mut pending_name = String::new();

        for (index, call) in calls.iter().enumerate() {
            let args = split_args(&call.args);

            match call.call_name.as_str() {
                "prefix" => {
                    path_prefix = join_laravel_route_segments(
                        &path_prefix,
                        args.first().map(|s| s.as_str()),
                    );
                    continue;
                }
                "controller" => {
                    if let Some(arg) = args.first() {
                        controller = parse_laravel_controller(arg).or(controller);
                    }
                    continue;
                }
                "name" | "as" => {
                    if let Some(arg) = args.first() {
                        pending_name.push_str(&parse_laravel_name_segment(arg));
                    }
                    continue;
                }
                "group" => {
                    let group_ctx = parse_laravel_group_context(&call.args);
                    let Some(body) = extract_laravel_closure_body(&call.args) else {
                        break;
                    };
                    let nested = LaravelRouteContext {
                        path_prefix: join_laravel_route_segments(
                            &path_prefix,
                            Some(&group_ctx.path_prefix),
                        ),
                        controller: group_ctx.controller.or(controller.clone()),
                        name_prefix: format!(
                            "{}{}{}",
                            context.name_prefix, pending_name, group_ctx.name_prefix
                        ),
                    };
                    routes.extend(collect_laravel_routes_from_content(
                        &body,
                        source_file,
                        &nested,
                    ));
                    break;
                }
                "get" | "post" | "put" | "patch" | "delete" | "options" | "head" | "any" => {
                    let uri = args
                        .first()
                        .and_then(|a| read_string_literal(a).or_else(|| read_first_string(a)));
                    let Some(uri) = uri else { break };
                    let method = if call.call_name == "any" {
                        "ANY".into()
                    } else {
                        call.call_name.to_uppercase()
                    };
                    routes.push(ApiRouteEntry {
                        framework: "laravel".into(),
                        methods: vec![method],
                        path: normalize_laravel_path(
                            &combine_laravel_route_path(&path_prefix, &uri),
                            source_file,
                        ),
                        handler: resolve_laravel_route_handler(
                            args.get(1).map(|s| s.as_str()).unwrap_or(""),
                            &controller,
                        ),
                        source_file: source_file.into(),
                        route_name: resolve_laravel_route_name(
                            &context.name_prefix,
                            &pending_name,
                            &calls[index + 1..],
                        ),
                    });
                    break;
                }
                "match" => {
                    let uri = args
                        .get(1)
                        .and_then(|a| read_string_literal(a).or_else(|| read_first_string(a)));
                    let Some(uri) = uri else { break };
                    routes.push(ApiRouteEntry {
                        framework: "laravel".into(),
                        methods: parse_match_methods(args.first().map(|s| s.as_str()).unwrap_or("")),
                        path: normalize_laravel_path(
                            &combine_laravel_route_path(&path_prefix, &uri),
                            source_file,
                        ),
                        handler: resolve_laravel_route_handler(
                            args.get(2).map(|s| s.as_str()).unwrap_or(""),
                            &controller,
                        ),
                        source_file: source_file.into(),
                        route_name: resolve_laravel_route_name(
                            &context.name_prefix,
                            &pending_name,
                            &calls[index + 1..],
                        ),
                    });
                    break;
                }
                "resource" | "apiresource" => {
                    let resource = args
                        .first()
                        .and_then(|a| read_string_literal(a).or_else(|| read_first_string(a)));
                    let Some(resource) = resource else { break };
                    let resource_controller = args
                        .get(1)
                        .map(|a| parse_laravel_handler(a))
                        .filter(|h| h != "Closure")
                        .or_else(|| controller.clone())
                        .unwrap_or_else(|| "Closure".into());
                    routes.extend(laravel_resource_routes(
                        &combine_laravel_route_path(&path_prefix, &resource),
                        &resource_controller,
                        source_file,
                        resolve_laravel_route_name(
                            &context.name_prefix,
                            &pending_name,
                            &calls[index + 1..],
                        )
                        .as_deref(),
                    ));
                    break;
                }
                _ => {}
            }
        }
    }

    routes
}

fn resolve_laravel_include_path(source_file: &str, expression: &str) -> Option<String> {
    static BASE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"base_path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)"#).unwrap()
    });
    if let Some(caps) = BASE.captures(expression) {
        return Some(normalize_rel_path(caps.get(1).unwrap().as_str()));
    }

    static DIR: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"__DIR__\s*\.\s*['"`]/?([^'"`]+)['"`]"#).unwrap()
    });
    if let Some(caps) = DIR.captures(expression) {
        return Some(normalize_rel_path(&format!(
            "{}/{}",
            dirname(source_file),
            caps.get(1).unwrap().as_str()
        )));
    }

    let literal = read_string_literal(expression).or_else(|| read_first_string(expression))?;
    if literal.starts_with('/') {
        Some(normalize_rel_path(&literal))
    } else {
        Some(normalize_rel_path(&format!("{}/{}", dirname(source_file), literal)))
    }
}

fn collect_laravel_required_route_files(content: &str, source_file: &str) -> Vec<String> {
    static PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
        vec![
            Regex::new(r#"\b(?:require|require_once|include|include_once)\s*\(?\s*(base_path\s*\(\s*['"`][^'"`]+['"`]\s*\))\s*\)?\s*;"#).unwrap(),
            Regex::new(r#"\b(?:require|require_once|include|include_once)\s*\(?\s*(__DIR__\s*\.\s*['"`]/?[^'"`]+['"`])\s*\)?\s*;"#).unwrap(),
            Regex::new(r#"\b(?:require|require_once|include|include_once)\s*\(?\s*(['"`][^'"`]+['"`])\s*\)?\s*;"#).unwrap(),
        ]
    });

    let mut required = HashSet::new();
    for pattern in PATTERNS.iter() {
        for caps in pattern.captures_iter(content) {
            if let Some(expr) = caps.get(1) {
                if let Some(resolved) = resolve_laravel_include_path(source_file, expr.as_str()) {
                    if resolved.ends_with(".php") {
                        required.insert(resolved);
                    }
                }
            }
        }
    }
    required.into_iter().collect()
}

pub(super) fn parse_laravel_routes(
    files: &[SourceFile],
) -> (Vec<ApiRouteEntry>, i64, Vec<String>) {
    let mut route_file_map: HashMap<String, &SourceFile> = HashMap::new();
    for file in files {
        let rel = normalize_rel_path(&file.rel_path);
        if rel == "routes/api.php" || (rel.starts_with("routes/api/") && rel.ends_with(".php")) {
            route_file_map.insert(rel, file);
        }
    }

    let mut visited = HashSet::new();
    let mut missing = HashSet::new();
    let mut route_files: Vec<String> = Vec::new();
    let mut routes = Vec::new();
    let mut warnings = Vec::new();

    fn visit(
        rel_path: &str,
        route_file_map: &HashMap<String, &SourceFile>,
        visited: &mut HashSet<String>,
        missing: &mut HashSet<String>,
        route_files: &mut Vec<String>,
    ) {
        let normalized = normalize_rel_path(rel_path);
        if visited.contains(&normalized) {
            return;
        }
        let Some(file) = route_file_map.get(&normalized) else {
            missing.insert(normalized);
            return;
        };
        visited.insert(normalized.clone());
        route_files.push(normalized.clone());
        for included in collect_laravel_required_route_files(&file.content, &normalized) {
            visit(&included, route_file_map, visited, missing, route_files);
        }
    }

    if route_file_map.contains_key("routes/api.php") {
        visit("routes/api.php", &route_file_map, &mut visited, &mut missing, &mut route_files);
    }
    for rel in route_file_map.keys().cloned().collect::<Vec<_>>() {
        visit(&rel, &route_file_map, &mut visited, &mut missing, &mut route_files);
    }

    if !missing.is_empty() {
        let mut list: Vec<_> = missing.into_iter().collect();
        list.sort();
        warnings.push(format!(
            "Laravel included route files were referenced but not found in the scan: {}",
            list.join(", ")
        ));
    }

    static GROUP_HINT: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"Route::(?:prefix|controller|middleware|name|group)\s*\(|->group\s*\(").unwrap()
    });

    let ctx = LaravelRouteContext {
        path_prefix: String::new(),
        controller: None,
        name_prefix: String::new(),
    };

    for rel in &route_files {
        if let Some(file) = route_file_map.get(rel) {
            if GROUP_HINT.is_match(&file.content) {
                warnings.push(
                    "Laravel route groups are expanded best-effort; dynamic group attributes or runtime-defined routes can still be incomplete.".into(),
                );
            }
            routes.extend(collect_laravel_routes_from_content(
                &file.content,
                rel,
                &ctx,
            ));
        }
    }

    let mut warnings: Vec<_> = warnings.into_iter().collect::<HashSet<_>>().into_iter().collect();
    warnings.sort();
    (routes, visited.len() as i64, warnings)
}

