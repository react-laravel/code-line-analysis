import type { TopFile } from '../../shared/api';

/** Read the complete index in bounded IPC pages from a single scan revision. */
export async function loadFileIndex(folderId: number, withDates = false): Promise<TopFile[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows: TopFile[] = [];
    let revision: number | undefined;
    let changed = false;
    while (true) {
      const page = await window.api.stats.filesPage(folderId, rows.length, 1000);
      if (revision !== undefined && revision !== page.revision) { changed = true; break; }
      revision = page.revision;
      rows.push(...page.rows);
      if (rows.length >= page.total) break;
      if (page.rows.length === 0) throw new Error('Incomplete file index');
    }
    if (changed) continue;
    if (withDates) {
      const result = await window.api.stats.fileDates(folderId);
      if (result.revision !== revision) continue;
      const dates = result.dates;
      for (const row of rows) row.lastCommitDate = dates[row.relPath] ?? null;
    }
    return rows;
  }
  throw new Error('File index changed while loading; retry after the scan');
}
