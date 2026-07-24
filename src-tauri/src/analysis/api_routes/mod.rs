mod helpers;
mod laravel;
mod next;

use helpers::{normalize_rel_path, sort_methods};
use laravel::parse_laravel_routes;
use next::parse_next_routes;
use crate::analysis::SourceFile;
use crate::types::{ApiRouteEntry, ApiRouteOverview};
use std::collections::{HashMap, HashSet};

fn dedupe_routes(routes: Vec<ApiRouteEntry>) -> Vec<ApiRouteEntry> {
    let mut by_key: HashMap<String, ApiRouteEntry> = HashMap::new();

    for route in routes {
        let key = format!(
            "{}|{}|{}|{}|{}",
            route.framework,
            route.path,
            route.handler,
            route.source_file,
            route.route_name.as_deref().unwrap_or("")
        );
        if let Some(existing) = by_key.get_mut(&key) {
            existing.methods = sort_methods(&[existing.methods.clone(), route.methods].concat());
        } else {
            by_key.insert(
                key,
                ApiRouteEntry {
                    methods: sort_methods(&route.methods),
                    ..route
                },
            );
        }
    }

    let mut out: Vec<_> = by_key.into_values().collect();
    out.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.framework.cmp(&b.framework))
            .then_with(|| a.handler.cmp(&b.handler))
    });
    out
}

pub fn build_api_route_overview(files: &[SourceFile]) -> ApiRouteOverview {
    let normalized: Vec<SourceFile> = files
        .iter()
        .map(|f| SourceFile {
            rel_path: normalize_rel_path(&f.rel_path),
            ..f.clone()
        })
        .collect();

    let (laravel_routes, laravel_files, warnings) = parse_laravel_routes(&normalized);
    let (next_routes, next_files) = parse_next_routes(&normalized);
    let routes = dedupe_routes([laravel_routes, next_routes].concat());
    let frameworks: Vec<String> = routes
        .iter()
        .map(|r| r.framework.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    ApiRouteOverview {
        frameworks,
        routes,
        laravel_route_files: laravel_files,
        next_route_files: next_files,
        warnings,
    }
}
