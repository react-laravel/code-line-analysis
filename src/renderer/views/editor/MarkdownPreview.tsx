import { createContext, createElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, ImageOff } from 'lucide-react';
import { toast } from '../../components/ui';
import { useI18n } from '../../i18n';
import { EDITOR_PREFIX, tabRoute, useTabsStore } from '../../store/tabs-store';
import './markdown-preview.css';

interface Props {
  content: string;
  folderId: number;
  relPath: string;
  ariaLabel?: string;
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/** Heading anchors are attached to the parsed tree, so rerenders never change their IDs. */
function remarkHeadingAnchors() {
  return (tree: MarkdownNode) => {
    const used = new Set<string>();
    const textOf = (node: MarkdownNode): string => node.value ?? (node.children ?? []).map(textOf).join('');
    const visit = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        const base = textOf(node).toLowerCase().trim()
          .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
          .replace(/\s+/g, '-') || 'section';
        let slug = base;
        let suffix = 0;
        while (used.has(slug)) slug = `${base}-${++suffix}`;
        used.add(slug);
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, id: slug },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

interface LocalTarget {
  relPath: string;
  anchor: string;
}

/** Resolve repository links without accepting absolute paths or escaping the root. */
function localTarget(fromPath: string, href: string): LocalTarget | null {
  const hashIndex = href.indexOf('#');
  const pathAndQuery = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const queryIndex = pathAndQuery.indexOf('?');
  const encodedPath = queryIndex < 0 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  let path: string;
  let anchor: string;
  try {
    path = decodeURIComponent(encodedPath);
    anchor = hashIndex < 0 ? '' : decodeURIComponent(href.slice(hashIndex + 1));
  } catch {
    return null;
  }
  if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)
    || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  const parts = fromPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length > 0 ? { relPath: parts.join('/'), anchor } : null;
}

function externalUrl(href: string): string | null {
  const candidate = href.startsWith('//') ? `https:${href}` : href;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function anchorSearch(anchor: string): string {
  return anchor ? `?markdownAnchor=${encodeURIComponent(anchor)}` : '';
}

interface ImageProps {
  src?: string;
  alt?: string;
  title?: string;
  folderId: number;
  relPath: string;
  onOpenExternal: (url: string) => void;
}

const ImageLinkContext = createContext(false);

function MarkdownImage({ src = '', alt = '', title, folderId, relPath, onOpenExternal }: ImageProps) {
  const { t } = useI18n();
  const insideLink = useContext(ImageLinkContext);
  const remote = externalUrl(src);
  const local = remote ? null : localTarget(relPath, src);
  const requestKey = `${folderId}:${local?.relPath ?? ''}`;
  const [image, setImage] = useState<{ key: string; dataUrl: string | null }>({ key: '', dataUrl: null });

  useEffect(() => {
    if (!local) return;
    let active = true;
    void window.api.file.readImage(folderId, local.relPath).then(dataUrl => {
      // Only the supported raster formats can cross the image API boundary.
      const safeUrl = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(dataUrl) ? dataUrl : null;
      if (active) setImage({ key: requestKey, dataUrl: safeUrl });
    }).catch(() => {
      if (active) setImage({ key: requestKey, dataUrl: null });
    });
    return () => { active = false; };
  }, [folderId, local?.relPath, requestKey]);

  if (local && image.key === requestKey && image.dataUrl) {
    return (
      <img
        src={image.dataUrl}
        alt={alt}
        title={title}
        loading="lazy"
        decoding="async"
        onError={() => setImage({ key: requestKey, dataUrl: null })}
      />
    );
  }

  const loading = Boolean(local) && image.key !== requestKey;
  const label = alt || (remote ? t('editor.markdownExternalImage') : t('editor.markdownImageUnavailable'));
  return (
    <span className="markdown-image-placeholder" title={title || src} aria-busy={loading || undefined}>
      <ImageOff size={16} aria-hidden="true" />
      <span role="img" aria-label={label}>{label}</span>
      {remote && !insideLink ? (
        <button type="button" onClick={() => onOpenExternal(remote)} title={t('editor.markdownOpenImage')}>
          <ExternalLink size={13} aria-hidden="true" />
          {t('editor.markdownOpenImage')}
        </button>
      ) : null}
    </span>
  );
}

export default function MarkdownPreview({ content, folderId, relPath, ariaLabel = 'Markdown preview' }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();
  const headingPrefix = `markdown-${useId()}-`;
  const articleRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetAnchor = searchParams.get('markdownAnchor');

  const scrollToAnchor = useCallback((anchor: string) => {
    const heading = Array.from(articleRef.current?.querySelectorAll<HTMLElement>('[data-markdown-heading]') ?? [])
      .find(element => element.dataset.markdownHeading === anchor);
    heading?.scrollIntoView({ block: 'start' });
  }, []);

  const openExternal = useCallback((url: string) => {
    void window.api.system.openExternal(url).catch(error => {
      toast.show({ tone: 'danger', title: t('editor.markdownOpenLinkFailed'), details: String(error) });
    });
  }, [t]);

  const components = useMemo<Components>(() => {
    const heading = (tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
      ({ node: _node, id, children, ...props }: ComponentProps<'h1'> & ExtraProps) =>
        createElement(tag, { ...props, id: `${headingPrefix}${id}`, 'data-markdown-heading': id }, children);
    return {
      h1: heading('h1'), h2: heading('h2'), h3: heading('h3'),
      h4: heading('h4'), h5: heading('h5'), h6: heading('h6'),
      a: ({ node: _node, href, children, ...props }) => {
        if (!href) return <span title={props.title}>{children}</span>;
        if (href.startsWith('#')) {
          let anchor: string;
          try { anchor = decodeURIComponent(href.slice(1)); } catch { return <span>{children}</span>; }
          return <a {...props} href={`#${headingPrefix}${anchor}`} onClick={event => {
            event.preventDefault();
            scrollToAnchor(anchor);
          }}><ImageLinkContext.Provider value>{children}</ImageLinkContext.Provider></a>;
        }
        const external = externalUrl(href);
        if (external) {
          return <a {...props} href={external} onClick={event => {
            event.preventDefault();
            openExternal(external);
          }}><ImageLinkContext.Provider value>{children}</ImageLinkContext.Provider></a>;
        }
        const target = localTarget(relPath, href);
        if (!target) return <span title={props.title}>{children}</span>;
        const search = anchorSearch(target.anchor);
        return <a {...props} href={`${EDITOR_PREFIX}${encodeURIComponent(target.relPath)}${search}`} onClick={event => {
          event.preventDefault();
          const tab = useTabsStore.getState().openFile(folderId, target.relPath, search);
          navigate(tabRoute(tab));
        }}><ImageLinkContext.Provider value>{children}</ImageLinkContext.Provider></a>;
      },
      img: ({ src, alt, title }) => <MarkdownImage
        src={typeof src === 'string' ? src : undefined}
        alt={alt}
        title={title}
        folderId={folderId}
        relPath={relPath}
        onOpenExternal={openExternal}
      />,
      table: ({ node: _node, ...props }) => <div className="markdown-table-scroll"><table {...props} /></div>,
    };
  }, [folderId, headingPrefix, navigate, openExternal, relPath, scrollToAnchor]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [folderId, relPath]);

  useEffect(() => {
    if (targetAnchor) scrollToAnchor(targetAnchor);
  }, [content, folderId, relPath, scrollToAnchor, targetAnchor]);

  return (
    <div ref={scrollRef} className="markdown-preview-scroll" role="region" aria-label={ariaLabel} tabIndex={0}>
      <article ref={articleRef} className="markdown-preview-prose">
        <Markdown remarkPlugins={[remarkGfm, remarkHeadingAnchors]} components={components} skipHtml>
          {content}
        </Markdown>
      </article>
    </div>
  );
}
