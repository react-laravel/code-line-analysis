pub const EXCLUDED_ASSET_EXTENSIONS: &[&str] = &[
    "jpg","jpeg","png","gif","webp","bmp","ico","svg","avif","heic","heif","tif","tiff","psd",
    "mp3","wav","flac","aac","m4a","ogg","oga","opus","wma","aiff","aif","mid","midi",
    "mp4","mov","m4v","avi","mkv","webm","wmv","flv","mpeg","mpg","3gp","ts",
    "txt","log","dat",
    "bin","exe","dll","so","dylib","class","jar","war","ear","apk","ipa","pdf","zip","tar","gz",
    "bz2","xz","7z","rar","woff","woff2","ttf","otf","eot","sqlite","db","pyc","pyo","wasm",
];

pub fn is_excluded_asset_path(rel_path: &str) -> bool {
    let base = rel_path.rsplit(['/', '\\']).next().unwrap_or(rel_path);
    let ext = match base.rsplit_once('.') {
        Some((_, e)) => e.to_lowercase(),
        None => return false,
    };
    EXCLUDED_ASSET_EXTENSIONS.iter().any(|e| *e == ext)
}

pub fn is_binary_buffer(buf: &[u8]) -> bool {
    let probe = &buf[..buf.len().min(8192)];
    if probe.is_empty() { return false; }
    let mut suspicious = 0usize;
    for &byte in probe {
        if byte == 0 { return true; }
        let printable = (32..=126).contains(&byte);
        let ws = byte == 9 || byte == 10 || byte == 13;
        let utf8_high = byte >= 128;
        if !printable && !ws && !utf8_high { suspicious += 1; }
    }
    (suspicious as f64) / (probe.len() as f64) > 0.1
}
