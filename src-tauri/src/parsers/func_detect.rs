use once_cell::sync::Lazy;
use regex::Regex;

#[derive(Debug, Clone)]
pub struct FoundFunction {
    pub name: String,
    pub start_line: i64,
    pub end_line: i64,
    pub length: i64,
}

fn family_for(ext: &str) -> &'static str {
    match ext {
        "js"|"jsx"|"ts"|"tsx"|"mjs"|"cjs"|"c"|"h"|"cpp"|"cc"|"hpp"|"java"|"kt"|"swift"|"go"|"rs"|"cs"|"scala"|"php"|"dart"|"scss"|"less" => "brace",
        "py" => "python",
        _ => "none",
    }
}

static BRACE_RES: Lazy<Vec<Regex>> = Lazy::new(|| vec![
    Regex::new(r"(?m)\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{").unwrap(),
    Regex::new(r"(?m)\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?:=>\s*)?\{").unwrap(),
    Regex::new(r"(?m)^\s{2,}(?:async\s+|public\s+|private\s+|protected\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{").unwrap(),
    Regex::new(r"(?m)\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\([^)]*\)[^{]*\{").unwrap(),
    Regex::new(r"(?m)\bfn\s+([A-Za-z_][\w]*)\s*[<(][^{]*\{").unwrap(),
]);

fn line_of(content: &str, idx: usize) -> i64 {
    (content[..idx].bytes().filter(|&b| b == b'\n').count() + 1) as i64
}

fn find_brace_functions(content: &str) -> Vec<FoundFunction> {
    let line_count = content.lines().count().max(1) as i64;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for re in BRACE_RES.iter() {
        for caps in re.captures_iter(content) {
            let m = caps.get(0).unwrap();
            let name = caps.get(1).map(|x| x.as_str()).unwrap_or("<anonymous>");
            let open_idx = if m.as_str().ends_with('{') {
                m.end() - 1
            } else {
                match content[m.end()-1..].find('{') {
                    Some(p) => m.end() - 1 + p,
                    None => continue,
                }
            };
            let start_line = line_of(content, m.start());
            if !seen.insert(start_line) { continue; }
            let bytes = content.as_bytes();
            let mut depth = 1i32;
            let mut i = open_idx + 1;
            let mut in_str: Option<u8> = None;
            let mut in_line = false;
            let mut in_block = false;
            while i < bytes.len() && depth > 0 {
                let ch = bytes[i];
                let nx = bytes.get(i + 1).copied().unwrap_or(0);
                if in_line { if ch == b'\n' { in_line = false; } i += 1; continue; }
                if in_block { if ch == b'*' && nx == b'/' { in_block = false; i += 2; continue; } i += 1; continue; }
                if let Some(q) = in_str {
                    if ch == b'\\' { i += 2; continue; }
                    if ch == q { in_str = None; }
                    i += 1; continue;
                }
                if ch == b'/' && nx == b'/' { in_line = true; i += 2; continue; }
                if ch == b'/' && nx == b'*' { in_block = true; i += 2; continue; }
                if ch == b'"' || ch == b'\'' || ch == b'`' { in_str = Some(ch); i += 1; continue; }
                if ch == b'{' { depth += 1; }
                else if ch == b'}' { depth -= 1; }
                i += 1;
            }
            let end_line = if depth == 0 { line_of(content, i.saturating_sub(1)) } else { line_count };
            out.push(FoundFunction {
                name: name.to_string(),
                start_line,
                end_line,
                length: end_line - start_line + 1,
            });
        }
    }
    out
}

fn find_python_functions(content: &str) -> Vec<FoundFunction> {
    let lines: Vec<&str> = content.lines().collect();
    let def_re = Regex::new(r"^(\s*)def\s+([A-Za-z_][\w]*)\s*\(").unwrap();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let Some(caps) = def_re.captures(line) else { continue };
        let indent = caps.get(1).unwrap().as_str().len();
        let name = caps.get(2).unwrap().as_str();
        let start = (i + 1) as i64;
        let mut end = lines.len() as i64;
        for (j, ln) in lines.iter().enumerate().skip(i + 1) {
            if ln.trim().is_empty() { continue; }
            let cur = ln.len() - ln.trim_start().len();
            if cur <= indent { end = j as i64; break; }
        }
        out.push(FoundFunction {
            name: name.to_string(),
            start_line: start,
            end_line: end,
            length: end - start + 1,
        });
    }
    out
}

pub fn find_functions(content: &str, ext: &str) -> Vec<FoundFunction> {
    match family_for(ext) {
        "brace" => find_brace_functions(content),
        "python" => find_python_functions(content),
        _ => vec![],
    }
}
