import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'en' | 'zh-CN';

const LANGUAGE_STORAGE_KEY = 'code-line-analysis-language';

const en = {
  'app.addFolder': '+ Add Folder',
  'app.baselineAt': 'baseline @ {date}',
  'app.cacheHits': 'cache hits: {count}',
  'app.currentFolder': 'Current Folder',
  'app.folders': 'Folders',
  'app.language': 'Language',
  'app.noBaseline': 'no baseline',
  'app.openSettings': 'Open Settings',
  'app.selectFolder': 'Choose a folder',
  'app.settings': 'Settings',
  'app.views': 'Views',
  'common.close': 'Close',
  'common.all': 'ALL',
  'common.blank': 'Blank',
  'common.code': 'Code',
  'common.comment': 'Comment',
  'common.comments': 'Comments',
  'common.date': 'Date',
  'common.file': 'File',
  'common.files': 'Files',
  'common.kind': 'Kind',
  'common.lang': 'Lang',
  'common.language': 'Language',
  'common.lines': 'Lines',
  'common.path': 'Path',
  'common.selectFolder': 'Select a folder.',
  'common.size': 'Size',
  'common.text': 'Text',
  'common.total': 'Total',
  'dashboard.addOrSelectFolder': 'Add or select a folder to begin.',
  'dashboard.blockCommentLines': 'Block Comment Lines',
  'dashboard.byLanguage': 'By Language',
  'dashboard.fullRescan': 'Full Rescan',
  'dashboard.languagesDetail': 'Languages Detail',
  'dashboard.moreActions': 'More actions',
  'dashboard.noData': 'No data yet. Run a scan.',
  'dashboard.resetBaseline': 'Reset Baseline',
  'dashboard.scan': 'Scan',
  'dashboard.scanIncremental': 'Scan (incremental)',
  'dashboard.setBaseline': 'Set Baseline',
  'dashboard.sinceBaseline': 'since baseline',
  'dashboard.totalLines': 'Total Lines',
  'duplicates.empty': 'No duplicates yet. Run a scan.',
  'duplicates.hash': 'hash',
  'duplicates.help': 'Run a scan with duplicate detection enabled to populate this list. Top 200 clusters shown.',
  'duplicates.occurrences': 'occurrences',
  'duplicates.title': 'Duplicate Code (>=6 lines)',
  'editor.back': 'Back',
  'editor.editMode': 'Edit mode',
  'editor.git': 'Git',
  'editor.gitBy': 'by',
  'editor.gitOn': 'on',
  'editor.gitTop': 'top',
  'editor.loadingAssets': 'Loading editor assets...',
  'editor.monacoLoading': 'Editor assets are loading. If this stays visible, Monaco failed to initialize.',
  'editor.mtime': 'mtime',
  'editor.save': 'Save',
  'editor.saving': 'Saving...',
  'files.allExtensions': 'All Extensions',
  'files.allLanguages': 'All Languages',
  'files.clearFilters': 'Clear Filters',
  'files.count': '{shown} / {total} files',
  'files.ext': 'Ext',
  'files.maxLines': 'Max lines',
  'files.minLines': 'Min lines',
  'files.noExtension': '(none)',
  'files.searchPlaceholder': 'Search path / language / ext...',
  'files.showingFirst': 'Showing first 1000 of {count}',
  'files.title': 'Files',
  'folderManager.activeRules': 'Active: whitelist={whitelist}, blacklist={blacklist}',
  'folderManager.blacklist': 'Blacklist (extra)',
  'folderManager.remove': 'Remove Folder',
  'folderManager.removeConfirm': 'Remove folder "{name}"? Cached data will be deleted.',
  'folderManager.rules': 'Rules',
  'folderManager.rulesHelp': 'Glob patterns (one per line). Whitelist: only listed files are scanned (empty = all). Blacklist: subtracted from scan. Default blacklist always applies:',
  'folderManager.save': 'Save Rules',
  'folderManager.title': 'Folder: {name}',
  'folderManager.whitelist': 'Whitelist',
  'heatmap.days': '{count} days',
  'heatmap.filesChanged': 'Files changed',
  'heatmap.title': 'Recent Activity (mtime-based)',
  'heatmap.totalLinesSinceDate': 'Total Lines (mtime >= date)',
  'heatmap.window': 'Window:',
  'language.english': 'English',
  'language.simplifiedChinese': 'Simplified Chinese',
  'nav.dashboard': 'Dashboard',
  'nav.duplicates': 'Duplicates',
  'nav.files': 'Files',
  'nav.folderManager': 'Folder Manager',
  'nav.heatmap': 'Heatmap',
  'nav.tags': 'Tags (TODO/FIXME)',
  'nav.top': 'Top Files / Functions',
  'nav.tree': 'Tree',
  'nav.workspace': 'Workspace',
  'progress.done': 'Done',
  'progress.parsing': 'Parsing',
  'progress.persisting': 'Persisting',
  'progress.walking': 'Walking',
  'tags.count': '{tags} tags in {files} files',
  'tags.jump': 'Jump',
  'tags.jumpToLine': 'Jump to line {line}',
  'tags.title': 'Tags',
  'top.end': 'End',
  'top.function': 'Function',
  'top.largestFiles': 'Largest Files by Lines',
  'top.largestFilesBySize': 'Largest Files by Size',
  'top.length': 'Length',
  'top.longestFunctions': 'Longest Functions',
  'top.start': 'Start',
  'top.title': 'Top Files & Functions',
  'tree.loading': 'Loading tree...',
  'tree.menu.copyAbsolutePath': 'Copy Absolute Path',
  'tree.menu.copyName': 'Copy Name',
  'tree.menu.copyRelativePath': 'Copy Relative Path',
  'tree.menu.openPath': 'Open',
  'tree.menu.revealInFinder': 'Reveal in Finder',
  'tree.noData': 'No data. Run a scan first.',
  'tree.title': 'Tree',
  'workspace.addFirst': 'Add a folder to start analyzing code.',
  'workspace.openFolder': 'Open',
  'workspace.subtitle': 'Pick a folder to view its dashboard, or add another project here.',
  'workspace.title': 'Workspace',
} as const;

type TranslationKey = keyof typeof en;

const zhCN: Record<TranslationKey, string> = {
  'app.addFolder': '+ 添加文件夹',
  'app.baselineAt': '基线 @ {date}',
  'app.cacheHits': '缓存命中：{count}',
  'app.currentFolder': '当前文件夹',
  'app.folders': '文件夹',
  'app.language': '语言',
  'app.noBaseline': '未设置基线',
  'app.openSettings': '打开设置',
  'app.selectFolder': '选择文件夹',
  'app.settings': '设置',
  'app.views': '视图',
  'common.close': '关闭',
  'common.all': '全部',
  'common.blank': '空行',
  'common.code': '代码',
  'common.comment': '注释',
  'common.comments': '注释',
  'common.date': '日期',
  'common.file': '文件',
  'common.files': '文件',
  'common.kind': '类型',
  'common.lang': '语言',
  'common.language': '语言',
  'common.lines': '行',
  'common.path': '路径',
  'common.selectFolder': '请选择一个文件夹。',
  'common.size': '大小',
  'common.text': '文本',
  'common.total': '总计',
  'dashboard.addOrSelectFolder': '添加或选择一个文件夹以开始。',
  'dashboard.blockCommentLines': '块注释行',
  'dashboard.byLanguage': '按语言统计',
  'dashboard.fullRescan': '完整重扫',
  'dashboard.languagesDetail': '语言明细',
  'dashboard.moreActions': '更多操作',
  'dashboard.noData': '暂无数据。请先运行扫描。',
  'dashboard.resetBaseline': '重置基线',
  'dashboard.scan': '扫描',
  'dashboard.scanIncremental': '增量扫描',
  'dashboard.setBaseline': '设置基线',
  'dashboard.sinceBaseline': '较基线',
  'dashboard.totalLines': '总行数',
  'duplicates.empty': '暂无重复代码。请先运行扫描。',
  'duplicates.hash': '哈希',
  'duplicates.help': '运行启用重复检测的扫描后会填充此列表。最多显示前 200 个重复簇。',
  'duplicates.occurrences': '处出现',
  'duplicates.title': '重复代码（>=6 行）',
  'editor.back': '返回',
  'editor.editMode': '编辑模式',
  'editor.git': 'Git',
  'editor.gitBy': '作者',
  'editor.gitOn': '日期',
  'editor.gitTop': '主要作者',
  'editor.loadingAssets': '正在加载编辑器资源...',
  'editor.monacoLoading': '编辑器资源加载中。如果这里长时间不消失，说明 Monaco 初始化失败。',
  'editor.mtime': '修改时间',
  'editor.save': '保存',
  'editor.saving': '保存中...',
  'files.allExtensions': '全部扩展名',
  'files.allLanguages': '全部语言',
  'files.clearFilters': '清除筛选',
  'files.count': '{shown} / {total} 个文件',
  'files.ext': '扩展名',
  'files.maxLines': '最大行数',
  'files.minLines': '最小行数',
  'files.noExtension': '（无扩展名）',
  'files.searchPlaceholder': '搜索路径 / 语言 / 扩展名...',
  'files.showingFirst': '显示 {count} 条中的前 1000 条',
  'files.title': '文件',
  'folderManager.activeRules': '当前：白名单={whitelist}，黑名单={blacklist}',
  'folderManager.blacklist': '黑名单（额外）',
  'folderManager.remove': '移除文件夹',
  'folderManager.removeConfirm': '确定移除文件夹“{name}”吗？缓存数据会被删除。',
  'folderManager.rules': '规则',
  'folderManager.rulesHelp': 'Glob 模式（每行一个）。白名单：仅扫描列出的文件（留空 = 全部）。黑名单：从扫描范围中排除。默认黑名单始终生效：',
  'folderManager.save': '保存规则',
  'folderManager.title': '文件夹：{name}',
  'folderManager.whitelist': '白名单',
  'heatmap.days': '{count} 天',
  'heatmap.filesChanged': '变更文件数',
  'heatmap.title': '近期活动（基于修改时间）',
  'heatmap.totalLinesSinceDate': '总行数（修改时间 >= 日期）',
  'heatmap.window': '窗口：',
  'language.english': '英语',
  'language.simplifiedChinese': '简体中文',
  'nav.dashboard': '仪表盘',
  'nav.duplicates': '重复代码',
  'nav.files': '文件',
  'nav.folderManager': '文件夹管理',
  'nav.heatmap': '热力图',
  'nav.tags': '标签（TODO/FIXME）',
  'nav.top': '最大文件 / 函数',
  'nav.tree': '目录树',
  'nav.workspace': '工作区',
  'progress.done': '完成',
  'progress.parsing': '解析中',
  'progress.persisting': '保存中',
  'progress.walking': '遍历中',
  'tags.count': '{tags} 个标签，分布于 {files} 个文件',
  'tags.jump': '跳转',
  'tags.jumpToLine': '跳转到第 {line} 行',
  'tags.title': '标签',
  'top.end': '结束',
  'top.function': '函数',
  'top.largestFiles': '按行数最大文件',
  'top.largestFilesBySize': '按大小最大文件',
  'top.length': '长度',
  'top.longestFunctions': '最长函数',
  'top.start': '起始',
  'top.title': '最大文件和函数',
  'tree.loading': '正在加载目录树...',
  'tree.menu.copyAbsolutePath': '复制绝对路径',
  'tree.menu.copyName': '复制名称',
  'tree.menu.copyRelativePath': '复制相对路径',
  'tree.menu.openPath': '打开',
  'tree.menu.revealInFinder': '在 Finder 中显示',
  'tree.noData': '暂无数据。请先运行扫描。',
  'tree.title': '目录树',
  'workspace.addFirst': '添加一个文件夹，开始分析代码。',
  'workspace.openFolder': '打开',
  'workspace.subtitle': '选择一个文件夹查看仪表盘，也可以在这里继续添加项目。',
  'workspace.title': '工作区',
};

const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  'zh-CN': zhCN,
};

const languageOptions: Array<{ code: Language; labelKey: TranslationKey }> = [
  { code: 'en', labelKey: 'language.english' },
  { code: 'zh-CN', labelKey: 'language.simplifiedChinese' },
];

interface I18nContextValue {
  language: Language;
  languageOptions: Array<{ code: Language; label: string }>;
  locale: string;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isLanguage(value: string | null | undefined): value is Language {
  return value === 'en' || value === 'zh-CN';
}

function languageFromLocale(value: string | null | undefined): Language {
  return value?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function getInitialLanguage(): Language {
  try {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(storedLanguage)) return storedLanguage;
  } catch {
    return languageFromLocale(window.navigator.language);
  }

  return languageFromLocale(window.navigator.language);
}

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template;

  return Object.entries(params).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore storage failures; the current in-memory language still works.
    }
  }, [language]);

  const t = useCallback<I18nContextValue['t']>(
    (key, params) => interpolate(translations[language][key], params),
    [language],
  );

  const labeledLanguageOptions = useMemo(
    () => languageOptions.map(option => ({ code: option.code, label: t(option.labelKey) })),
    [t],
  );

  const value = useMemo<I18nContextValue>(() => ({
    language,
    languageOptions: labeledLanguageOptions,
    locale,
    setLanguage,
    t,
  }), [language, labeledLanguageOptions, locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}