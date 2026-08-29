/** Directory without a trailing slash; empty when `path` is a bare name. */
export function splitRelPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return { dir: '', name: path };
  return { dir: path.slice(0, slash), name: path.slice(slash + 1) };
}

/** Lower-case extension without the dot; empty when the name has none. */
export function fileExt(path: string): string {
  const { name } = splitRelPath(path);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}
