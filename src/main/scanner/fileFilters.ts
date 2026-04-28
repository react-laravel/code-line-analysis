const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif', 'heic', 'heif', 'tif', 'tiff', 'psd',
];

const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'mid', 'midi',
];

const VIDEO_EXTENSIONS = [
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'mpeg', 'mpg', '3gp', 'ts',
];

const NON_CODE_TEXT_EXTENSIONS = [
  'txt', 'log', 'dat',
];

const BINARY_EXTENSIONS = [
  'bin', 'exe', 'dll', 'so', 'dylib', 'class', 'jar', 'war', 'ear', 'apk', 'ipa', 'pdf', 'zip', 'tar', 'gz',
  'bz2', 'xz', '7z', 'rar', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'sqlite', 'db', 'pyc', 'pyo', 'wasm',
];

export const EXCLUDED_ASSET_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...NON_CODE_TEXT_EXTENSIONS,
  ...BINARY_EXTENSIONS,
];

const EXCLUDED_ASSET_EXTENSION_SET = new Set(EXCLUDED_ASSET_EXTENSIONS);

function extOf(relPath: string): string {
  const base = relPath.split(/[\\/]/).pop() || relPath;
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function isExcludedAssetPath(relPath: string): boolean {
  return EXCLUDED_ASSET_EXTENSION_SET.has(extOf(relPath));
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  if (probe.length === 0) return false;

  let suspicious = 0;
  for (let i = 0; i < probe.length; i++) {
    const byte = probe[i];
    if (byte === 0) return true;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isUtf8HighByte = byte >= 128;
    if (!isPrintableAscii && !isWhitespace && !isUtf8HighByte) suspicious++;
  }

  return suspicious / probe.length > 0.1;
}