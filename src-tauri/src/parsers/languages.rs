#[derive(Clone, Debug)]
pub struct LangDef {
    pub id: &'static str,
    pub line: &'static [&'static str],
    pub block: &'static [(&'static str, &'static str)],
    pub string: &'static [(&'static str, &'static str)],
}

const QS: &[(&str, &str)] = &[("\"", "\""), ("'", "'")];
const C_LINE: &[&str] = &["//"];
const C_BLOCK: &[(&str, &str)] = &[("/*", "*/")];
const C_STR: &[(&str, &str)] = &[("\"", "\""), ("'", "'"), ("`", "`")];
const WEB_BLOCK: &[(&str, &str)] = &[("<!--", "-->"), ("/*", "*/")];
const PY_BLOCK: &[(&str, &str)] = &[("\"\"\"", "\"\"\""), ("'''", "'''")];

fn c_like(id: &'static str) -> LangDef {
    LangDef { id, line: C_LINE, block: C_BLOCK, string: C_STR }
}

pub fn detect_lang(rel_path: &str) -> (String, Option<LangDef>, String) {
    let base = rel_path.rsplit(['/', '\\']).next().unwrap_or(rel_path);
    let special = match base {
        "Dockerfile" => Some(("dockerfile", LangDef { id: "Dockerfile", line: &["#"], block: &[], string: QS })),
        "Makefile" | "GNUmakefile" => Some(("makefile", LangDef { id: "Makefile", line: &["#"], block: &[], string: QS })),
        _ => None,
    };
    if let Some((ext, lang)) = special {
        return (ext.to_string(), Some(lang.clone()), lang.id.to_string());
    }
    let ext = match base.rsplit_once('.') {
        Some((_, e)) => e.to_lowercase(),
        None => return (String::new(), None, "Other".into()),
    };
    let lang = match ext.as_str() {
        "ts" => Some(c_like("TypeScript")),
        "tsx" => Some(c_like("TSX")),
        "js" | "mjs" | "cjs" => Some(c_like("JavaScript")),
        "jsx" => Some(c_like("JSX")),
        "json" => Some(LangDef { id: "JSON", line: &[], block: &[], string: &[] }),
        "c" => Some(c_like("C")),
        "h" => Some(c_like("C/C++ Header")),
        "cpp" | "cc" => Some(c_like("C++")),
        "hpp" => Some(c_like("C++ Header")),
        "java" => Some(c_like("Java")),
        "kt" => Some(c_like("Kotlin")),
        "swift" => Some(c_like("Swift")),
        "go" => Some(c_like("Go")),
        "rs" => Some(c_like("Rust")),
        "cs" => Some(c_like("C#")),
        "scala" => Some(c_like("Scala")),
        "php" => Some(LangDef { id: "PHP", line: &["//", "#"], block: C_BLOCK, string: C_STR }),
        "py" => Some(LangDef { id: "Python", line: &["#"], block: PY_BLOCK, string: QS }),
        "rb" => Some(LangDef { id: "Ruby", line: &["#"], block: &[("=begin", "=end")], string: QS }),
        "sh" | "bash" | "zsh" => Some(LangDef { id: "Shell", line: &["#"], block: &[], string: QS }),
        "yml" | "yaml" => Some(LangDef { id: "YAML", line: &["#"], block: &[], string: QS }),
        "toml" => Some(LangDef { id: "TOML", line: &["#"], block: &[], string: QS }),
        "ini" => Some(LangDef { id: "INI", line: &[";", "#"], block: &[], string: QS }),
        "sql" => Some(LangDef { id: "SQL", line: &["--"], block: C_BLOCK, string: QS }),
        "html" | "htm" => Some(LangDef { id: "HTML", line: &[], block: &[("<!--", "-->")], string: &[] }),
        "xml" => Some(LangDef { id: "XML", line: &[], block: &[("<!--", "-->")], string: &[] }),
        "css" => Some(LangDef { id: "CSS", line: &[], block: C_BLOCK, string: &[] }),
        "scss" => Some(c_like("SCSS")),
        "less" => Some(c_like("Less")),
        "md" => Some(LangDef { id: "Markdown", line: &[], block: &[], string: &[] }),
        "vue" | "svelte" => Some(LangDef {
            id: if ext == "vue" { "Vue" } else { "Svelte" },
            line: C_LINE, block: WEB_BLOCK, string: C_STR,
        }),
        "lua" => Some(LangDef { id: "Lua", line: &["--"], block: &[("--[[", "]]")], string: &[] }),
        "dart" => Some(c_like("Dart")),
        "ex" | "exs" => Some(LangDef { id: "Elixir", line: &["#"], block: &[], string: &[] }),
        "hs" | "elm" => Some(LangDef { id: if ext == "hs" { "Haskell" } else { "Elm" }, line: &["--"], block: &[("{-", "-}")], string: &[] }),
        _ => None,
    };
    let lang_id = lang.as_ref().map(|l| l.id.to_string()).unwrap_or_else(|| "Other".into());
    (ext, lang, lang_id)
}
