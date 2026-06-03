import { useEffect, useMemo, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { copyTextToClipboard } from '../../utils/clipboard';

interface MarkdownRendererProps {
  content: string;
}

interface MarkdownSection {
  body: string;
  depth: number;
  id: string;
  title: string;
}

type MarkdownAdmonitionKind =
  | 'error'
  | 'example'
  | 'important'
  | 'info'
  | 'note'
  | 'tip'
  | 'warning';

type MarkdownContentBlock =
  | { content: string; type: 'markdown' }
  | {
      content: string;
      kind: MarkdownAdmonitionKind;
      type: 'admonition';
    };

interface ZoomedImageState {
  alt: string;
  src: string;
}

function MarkdownImage({
  alt = '',
  onImageClick,
  src = '',
}: {
  alt?: string;
  onImageClick: (image: ZoomedImageState) => void;
  src?: string;
}) {
  const [hasLoadError, setHasLoadError] = useState(false);

  if (!src || hasLoadError) {
    return (
      <div className="my-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/90 px-4 py-6 text-center dark:border-slate-700 dark:bg-slate-900/60">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Imagen no encontrada
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {src || 'La referencia de la imagen está vacía o el archivo ya no existe.'}
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        onImageClick({
          alt,
          src,
        })
      }
      className="my-4 block w-full rounded-2xl text-left transition-all duration-300 ease-in-out"
    >
      <img
        src={src}
        alt={alt}
        onError={() => setHasLoadError(true)}
        className="max-h-[300px] max-w-full rounded-2xl object-contain shadow-sm transition-all duration-300 ease-in-out hover:shadow-md"
        loading="lazy"
        style={{ cursor: 'zoom-in' }}
      />
    </button>
  );
}

// Si en el futuro se implementa un microservicio en Java para procesar,
// redimensionar o servir estas imagenes desde un servidor centralizado, es
// obligatorio usar try-catch-resources para el manejo de excepciones y flujos
// de datos (Streams) [cite: 2026-02-12].

const parseMarkdownSections = (content: string) => {
  const headingPattern = /^(#{1,6})\s+(.+)$/;
  const lines = content.split('\n');
  const preamble: string[] = [];
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection | null = null;

  const pushCurrentSection = () => {
    if (!currentSection) {
      return;
    }

    sections.push({
      body: currentSection.body.trim(),
      depth: currentSection.depth,
      id: currentSection.id,
      title: currentSection.title,
    });
  };

  for (const line of lines) {
    const match = line.match(headingPattern);

    if (match) {
      pushCurrentSection();
      currentSection = {
        body: '',
        depth: match[1].length,
        id: `${match[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${sections.length}`,
        title: match[2].trim(),
      };
      continue;
    }

    if (currentSection) {
      currentSection.body = currentSection.body
        ? `${currentSection.body}\n${line}`
        : line;
      continue;
    }

    preamble.push(line);
  }

  pushCurrentSection();

  return {
    preamble: preamble.join('\n').trim(),
    sections,
  };
};

const admonitionLabels: Record<MarkdownAdmonitionKind, string> = {
  error: 'Error',
  example: 'Ejemplo',
  important: 'Importante',
  info: 'Info',
  note: 'Nota',
  tip: 'Tip',
  warning: 'Aviso',
};

const admonitionToneClasses: Record<
  MarkdownAdmonitionKind,
  {
    accent: string;
    body: string;
    icon: string;
    title: string;
  }
> = {
  error: {
    accent: 'border-red-300 dark:border-red-500/45',
    body: 'bg-red-50/90 text-red-950 dark:bg-red-950/45 dark:text-red-100',
    icon: 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-200',
    title: 'text-red-900 dark:text-red-100',
  },
  example: {
    accent: 'border-slate-300 dark:border-slate-600',
    body: 'bg-slate-50/90 text-slate-900 dark:bg-slate-900/85 dark:text-slate-100',
    icon: 'bg-slate-200 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200',
    title: 'text-slate-900 dark:text-slate-100',
  },
  important: {
    accent: 'border-indigo-300 dark:border-indigo-500/45',
    body: 'bg-indigo-50/90 text-indigo-950 dark:bg-indigo-950/55 dark:text-indigo-100',
    icon: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200',
    title: 'text-indigo-900 dark:text-indigo-100',
  },
  info: {
    accent: 'border-sky-300 dark:border-sky-500/45',
    body: 'bg-sky-50/90 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100',
    icon: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200',
    title: 'text-sky-900 dark:text-sky-100',
  },
  note: {
    accent: 'border-slate-300 dark:border-slate-600',
    body: 'bg-slate-100/90 text-slate-900 dark:bg-slate-900/80 dark:text-slate-100',
    icon: 'bg-slate-200 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200',
    title: 'text-slate-900 dark:text-slate-100',
  },
  tip: {
    accent: 'border-emerald-300 dark:border-emerald-500/45',
    body: 'bg-emerald-50/90 text-emerald-950 dark:bg-emerald-950/45 dark:text-emerald-100',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200',
    title: 'text-emerald-900 dark:text-emerald-100',
  },
  warning: {
    accent: 'border-amber-300 dark:border-amber-500/45',
    body: 'bg-amber-50/90 text-amber-950 dark:bg-amber-950/45 dark:text-amber-100',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
    title: 'text-amber-900 dark:text-amber-100',
  },
};

function AdmonitionIcon({ kind }: { kind: MarkdownAdmonitionKind }) {
  if (kind === 'info') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 8v5M10 5.7h.01" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'warning') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
        <path d="M10 3.5 17 16H3L10 3.5Z" strokeLinejoin="round" />
        <path d="M10 7.4v4.8M10 14.5h.01" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'important') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
        <path d="M10 3.5v8.5M10 15.1h.01" strokeLinecap="round" />
        <path d="M5.5 3.5h9l-1 9H6.5l-1-9Z" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'tip') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
        <path d="M7.5 11.8c-1.1-.8-1.8-2.1-1.8-3.6a4.3 4.3 0 1 1 8.6 0c0 1.5-.7 2.8-1.8 3.6-.7.5-1 1-1.1 1.7H8.6c-.1-.7-.4-1.2-1.1-1.7Z" strokeLinejoin="round" />
        <path d="M8.4 15.2h3.2M8.9 17h2.2" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'error') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
        <circle cx="10" cy="10" r="7" />
        <path d="m7.5 7.5 5 5m0-5-5 5" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'example') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
        <path d="M6 4.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
        <path d="M7.8 8h4.4M7.8 10.5h4.4M7.8 13h2.8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
      <path d="M5.5 4.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M7.8 8h4.4M7.8 11h4.4" strokeLinecap="round" />
    </svg>
  );
}

const parseMarkdownContentBlocks = (content: string): MarkdownContentBlock[] => {
  const lines = content.split('\n');
  const blocks: MarkdownContentBlock[] = [];
  const admonitionPattern =
    /^:::(note|info|warning|important|tip|error|example)\s*$/i;
  const buffer: string[] = [];
  let currentAdmonitionKind: MarkdownAdmonitionKind | null = null;
  let admonitionBuffer: string[] = [];

  const flushMarkdownBuffer = () => {
    const markdownContent = buffer.join('\n').trim();
    if (markdownContent) {
      blocks.push({
        content: markdownContent,
        type: 'markdown',
      });
    }
    buffer.length = 0;
  };

  const flushAdmonitionBuffer = () => {
    if (currentAdmonitionKind && admonitionBuffer.join('\n').trim()) {
      blocks.push({
        content: admonitionBuffer.join('\n').trim(),
        kind: currentAdmonitionKind,
        type: 'admonition',
      });
    }
    admonitionBuffer = [];
    currentAdmonitionKind = null;
  };

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (currentAdmonitionKind) {
      if (trimmedLine === ':::') {
        flushAdmonitionBuffer();
      } else {
        admonitionBuffer.push(line);
      }
      return;
    }

    const admonitionMatch = trimmedLine.match(admonitionPattern);
    if (admonitionMatch) {
      flushMarkdownBuffer();
      currentAdmonitionKind = admonitionMatch[1].toLowerCase() as MarkdownAdmonitionKind;
      admonitionBuffer = [];
      return;
    }

    buffer.push(line);
  });

  if (currentAdmonitionKind) {
    buffer.push(`:::${currentAdmonitionKind}`, ...admonitionBuffer);
  }

  flushMarkdownBuffer();

  return blocks;
};

function ImageZoomModal({
  image,
  onClose,
}: {
  image: ZoomedImageState;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm transition-all duration-300 ease-in-out"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || 'Vista ampliada de imagen'}
      onClick={onClose}
    >
      <div className="absolute right-4 top-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-lg text-white transition-all duration-300 ease-in-out hover:bg-white/20"
          aria-label="Cerrar imagen ampliada"
          title="Cerrar"
        >
          ×
        </button>
      </div>

      <img
        src={image.src}
        alt={image.alt}
        className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl transition-all duration-300 ease-in-out"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function CodeBlock({
  children,
  className,
  inline,
}: {
  children?: ReactNode;
  className?: string;
  inline?: boolean;
}) {
  const codeValue = String(children ?? '').replace(/\n$/, '');

  if (inline) {
    return (
      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800 dark:bg-slate-900 dark:text-slate-100">
        {children}
      </code>
    );
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-lg dark:border-slate-700 dark:bg-slate-950">
      <button
        type="button"
        onClick={() => copyTextToClipboard(codeValue)}
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-blue-500/50 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-300 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-500/20 hover:text-blue-100"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-5 w-5"
        >
          <rect
            x="7"
            y="3"
            width="9"
            height="11"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M5 7H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
        Copiar Codigo
      </button>
      <pre className="overflow-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-slate-950 px-4 py-4 text-sm text-slate-100">
        <code className={`block whitespace-pre-wrap [overflow-wrap:anywhere] ${className ?? ''}`}>{children}</code>
      </pre>
    </div>
  );
}

const createMarkdownComponents = (
  onImageClick: (image: ZoomedImageState) => void,
) => ({
  a: (props: ComponentProps<'a'>) => (
    <a
      {...props}
      className="font-medium text-sky-700 underline decoration-sky-200 underline-offset-4 transition-colors hover:text-sky-800 dark:text-blue-400 dark:decoration-blue-500"
      target={props.href?.startsWith('http') ? '_blank' : undefined}
      rel={props.href?.startsWith('http') ? 'noreferrer' : undefined}
    />
  ),
  blockquote: (props: ComponentProps<'blockquote'>) => (
    <blockquote
      {...props}
      className="my-4 border-l-4 border-slate-300 bg-slate-50 px-4 py-3 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200"
    />
  ),
  code: CodeBlock,
  h1: (props: ComponentProps<'h1'>) => (
    <h1 {...props} className="mt-6 text-2xl font-bold text-slate-900 dark:text-slate-100" />
  ),
  h2: (props: ComponentProps<'h2'>) => (
    <h2 {...props} className="mt-6 text-xl font-bold text-slate-900 dark:text-slate-100" />
  ),
  h3: (props: ComponentProps<'h3'>) => (
    <h3 {...props} className="mt-5 text-lg font-semibold text-slate-900 dark:text-slate-100" />
  ),
  h4: (props: ComponentProps<'h4'>) => (
    <h4 {...props} className="mt-5 text-base font-semibold text-slate-900 dark:text-slate-100" />
  ),
  img: (props: ComponentProps<'img'>) => (
    <MarkdownImage
      alt={props.alt ?? ''}
      src={props.src ?? ''}
      onImageClick={onImageClick}
    />
  ),
  li: (props: ComponentProps<'li'>) => (
    <li
      {...props}
      className="break-words whitespace-pre-wrap [overflow-wrap:anywhere] leading-7 text-slate-700 marker:text-slate-500 [&>p]:my-0 [&>p]:inline [&>p]:whitespace-pre-wrap [&>ul]:mt-2 [&>ol]:mt-2 dark:text-slate-200 dark:marker:text-slate-300"
    />
  ),
  ol: (props: ComponentProps<'ol'>) => (
    <ol {...props} className="my-4 list-decimal space-y-2 pl-5 [&_ol]:mt-2 [&_ul]:mt-2" />
  ),
  p: (props: ComponentProps<'p'>) => (
    <p {...props} className="my-3 break-words whitespace-pre-wrap [overflow-wrap:anywhere] leading-7 text-slate-700 first:mt-0 last:mb-0 dark:text-slate-200" />
  ),
  strong: (props: ComponentProps<'strong'>) => (
    <strong {...props} className="font-semibold text-slate-900 dark:text-white" />
  ),
  table: (props: ComponentProps<'table'>) => (
    <div className="my-4 overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
      <table
        {...props}
        className="min-w-full divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-900"
      />
    </div>
  ),
  td: (props: ComponentProps<'td'>) => (
    <td
      {...props}
      className="border-t border-slate-100 px-3 py-2 text-sm break-words [overflow-wrap:anywhere] text-slate-700 dark:border-slate-700 dark:text-slate-200"
    />
  ),
  th: (props: ComponentProps<'th'>) => (
    <th
      {...props}
      className="bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:bg-slate-950 dark:text-slate-300"
    />
  ),
  ul: (props: ComponentProps<'ul'>) => (
    <ul {...props} className="my-4 list-disc space-y-2 pl-5 [&_ol]:mt-2 [&_ul]:mt-2" />
  ),
});

function MarkdownSectionAccordion({
  components,
  section,
}: {
  components: ReturnType<typeof createMarkdownComponents>;
  section: MarkdownSection;
}) {
  return (
    <details
      open
      className="group rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/50"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span
          className={`break-words [overflow-wrap:anywhere] font-semibold text-slate-900 dark:text-slate-100 ${
            section.depth <= 2 ? 'text-lg' : 'text-base'
          }`}
        >
          {section.title}
        </span>
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400 transition-transform group-open:rotate-45 dark:text-slate-400">
          +
        </span>
      </summary>

      <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
        <MarkdownContent blocks={parseMarkdownContentBlocks(section.body)} components={components} />
      </div>
    </details>
  );
}

function MarkdownAdmonition({
  block,
  components,
}: {
  block: Extract<MarkdownContentBlock, { type: 'admonition' }>;
  components: ReturnType<typeof createMarkdownComponents>;
}) {
  const tone = admonitionToneClasses[block.kind];

  return (
    <div
      className={`my-4 overflow-hidden rounded-2xl border ${tone.accent} ${tone.body}`}
    >
      <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3 dark:border-white/10">
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${tone.icon}`}
          aria-hidden="true"
        >
          <AdmonitionIcon kind={block.kind} />
        </span>
        <span className={`text-sm font-semibold uppercase tracking-[0.16em] ${tone.title}`}>
          {admonitionLabels[block.kind]}
        </span>
      </div>
      <div className="px-4 py-3">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={components}
        >
          {block.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function MarkdownContent({
  blocks,
  components,
}: {
  blocks: MarkdownContentBlock[];
  components: ReturnType<typeof createMarkdownComponents>;
}) {
  return (
    <>
      {blocks.map((block, index) =>
        block.type === 'markdown' ? (
          <ReactMarkdown
            key={`markdown-${index}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={components}
          >
            {block.content}
          </ReactMarkdown>
        ) : (
          <MarkdownAdmonition
            key={`admonition-${block.kind}-${index}`}
            block={block}
            components={components}
          />
        ),
      )}
    </>
  );
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const [zoomedImage, setZoomedImage] = useState<ZoomedImageState | null>(null);
  const { preamble, sections } = useMemo(
    () => parseMarkdownSections(content),
    [content],
  );
  const markdownComponents = useMemo(
    () =>
      createMarkdownComponents((image) => {
        if (!image.src) {
          return;
        }

        setZoomedImage(image);
      }),
    [],
  );

  return (
    <>
      <div className="markdown-body min-w-0 break-words [overflow-wrap:anywhere]">
      {preamble ? (
        <MarkdownContent
          blocks={parseMarkdownContentBlocks(preamble)}
          components={markdownComponents}
        />
      ) : null}

      {sections.length ? (
        <div className="space-y-3">
          {sections.map((section) => (
            <MarkdownSectionAccordion
              key={section.id}
              section={section}
              components={markdownComponents}
            />
          ))}
        </div>
      ) : null}
      </div>

      {zoomedImage ? (
        <ImageZoomModal
          image={zoomedImage}
          onClose={() => setZoomedImage(null)}
        />
      ) : null}
    </>
  );
}
