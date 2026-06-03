import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClipboardEvent as ReactClipboardEvent,
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useDeferredValue } from 'react';
import { AppCustomizationPanel } from './components/settings/AppCustomizationPanel';
import { MainLayout } from './components/layout/MainLayout';
import { AppLogo } from './components/ui/AppLogo';
import { MarkdownRenderer } from './components/ui/MarkdownRenderer';
import { ResultCard } from './components/ui/ResultCard';
import { SearchHelpButton } from './components/ui/SearchHelpButton';
import { SidebarUtilities } from './components/ui/SidebarUtilities';
import { ToggleSwitch } from './components/ui/ToggleSwitch';
import {
  DEFAULT_APP_ICON_PATH,
  defaultAppCustomization,
  normalizeCustomization,
} from './constants/appCustomization';
import {
  categoryColorOptions,
  getCategoryColorHex,
  getCategoryTheme,
} from './constants/categoryColors';
import manualEntries from './data/manual.json';
import { useSearch } from './hooks/useSearch';
import {
  clipboardCopyEventName,
  type ClipboardCopyEventDetail,
} from './utils/clipboard';
import type {
  AppDiagnosticsSnapshot,
  AppSettings,
  AppCustomizationSettings,
  CategoryColorKey,
  CategoryDefinition,
  CommandOption,
  CommandOverridesByEntry,
  EntryTemplate,
  KnowledgeEntry,
  ManualBackupPayload,
  ManualData,
  QuickViewSettings,
} from './types';

const STORAGE_KEY = 'knowledge-manual-state-v2';
const LEGACY_COMMAND_STORAGE_KEY = 'result-card-command-overrides';
const ASSISTANT_VERSION = '1.0.0';
const HOME_PINNED_ENTRY_PREVIEW_LIMIT = 4;
const defaultCategoryMetadata: Record<
  string,
  { color: CategoryColorKey; description: string }
> = {
  Entorno: {
    color: 'blue',
    description: 'Accesos remotos, puertos y rutas de configuracion local.',
  },
  Accesos: {
    color: 'violet',
    description: 'Credenciales de correo, SSH, Oracle y portales corporativos.',
  },
  Batch: {
    color: 'emerald',
    description: 'Procesos, tablas de configuracion y comandos SQL.',
  },
  UML: {
    color: 'amber',
    description: 'Protocolos de diseno, MagicDraw y bloqueos en SVN.',
  },
  UI: {
    color: 'indigo',
    description: 'Arquitectura de capas NPA, literales y componentes.',
  },
  General: {
    color: 'teal',
    description: 'Guias de iTeams, gestion de tags y despliegues.',
  },
  Seguros: {
    color: 'rose',
    description: 'Glosario de negocio y conceptos especificos del ecosistema Prysma.',
  },
};

const getCurrentIsoDate = () => new Date().toISOString();
const defaultPrysmaIconDataUrl = DEFAULT_APP_ICON_PATH;

interface EntryFormState {
  categoryColor: CategoryColorKey;
  categoryDescription: string;
  categoryLocked: boolean;
  categoria: string;
  comandos: CommandOption[];
  contenido: string;
  id: string;
  pasos: string;
  tags: string;
  titulo: string;
}

interface CategoryFormState {
  color: CategoryColorKey;
  description: string;
  name: string;
}

interface TemplateFormState {
  categoria: string;
  comandos: CommandOption[];
  contenido: string;
  id: string;
  name: string;
  pasos: string;
  tags: string;
  titulo: string;
}

interface ToolbarAction {
  buttonLabel: string;
  icon: string;
  label: string;
  onClick: () => void;
  shortcut?: string;
}

interface EditorSelectionState {
  hasSelection: boolean;
  selectedCharacters: number;
  selectedLines: number;
}

interface SaveToastState {
  message: string;
  tone: 'error' | 'success';
}

type SaveSyncState = 'error' | 'idle' | 'pending' | 'saved' | 'saving';

type ManualOriginState = 'bundled' | 'local-storage' | 'server';
type ServerHealthState = 'checking' | 'offline' | 'online';
type ImportMode = 'merge' | 'replace';
type ResultSortMode = 'custom' | 'pinned-latest' | 'latest' | 'oldest' | 'title';
type EntryEditorViewMode = 'editor' | 'preview' | 'split';

interface CategoryDeleteConfirmationState {
  categoryName: string;
  entryCount: number;
}

interface BackupImportState {
  fileName: string;
  importedManualData: ManualData;
}

interface SectionPdfExportState {
  categoryName: string;
  includeBrandingFooter: boolean;
  selectedEntryIds: string[];
}

interface EntryPdfExportState {
  entryId: string;
  includeBrandingFooter: boolean;
}

interface BackupImportSummary {
  conflictingEntryIds: number;
  conflictingEntryTitles: number;
  conflictingTemplateIds: number;
  conflictingTemplateNames: number;
  conflictingTemplateTitles: number;
  matchingCategories: number;
  newCategories: number;
  newEntries: number;
  newTemplates: number;
  newTrashEntries: number;
}

interface StoredManualSnapshot {
  manualData: ManualData;
  source: Exclude<ManualOriginState, 'server'>;
}

interface UndoSnapshot {
  manualData: ManualData;
}

interface TrashCategorySummary {
  entryCount: number;
  name: string;
}

type QuickViewDefinition = QuickViewSettings;

const defaultQuickViews: QuickViewDefinition[] = [
  {
    categoryName: 'Entorno',
    id: 'quick-entorno',
    label: 'Entorno',
    tone: 'sky',
  },
  {
    categoryName: 'Accesos',
    id: 'quick-credenciales',
    label: 'Credenciales',
    tone: 'violet',
  },
  {
    id: 'quick-incidencias',
    label: 'Incidencias',
    searchTerm: 'incidencia',
    tone: 'amber',
  },
  {
    id: 'quick-ancladas',
    label: 'Ancladas',
    showPinnedOnly: true,
    tone: 'emerald',
  },
];

const defaultSettings: AppSettings = {
  compactMode: false,
  customization: defaultAppCustomization,
  customEntryOrderByCategory: {},
  darkMode: false,
  quickViews: defaultQuickViews,
};

const normalizeCustomEntryOrderByCategory = (
  source: unknown,
): Record<string, string[]> => {
  if (!source || typeof source !== 'object') {
    return {};
  }

  return Object.entries(source as Record<string, unknown>).reduce<
    Record<string, string[]>
  >((accumulator, [categoryName, entryIds]) => {
    const normalizedCategoryName = categoryName.trim().toLowerCase();

    if (!normalizedCategoryName || !Array.isArray(entryIds)) {
      return accumulator;
    }

    const normalizedEntryIds = Array.from(
      new Set(
        entryIds
          .filter((entryId): entryId is string => typeof entryId === 'string')
          .map((entryId) => entryId.trim())
          .filter(Boolean),
      ),
    );

    if (normalizedEntryIds.length) {
      accumulator[normalizedCategoryName] = normalizedEntryIds;
    }

    return accumulator;
  }, {});
};

type AdmonitionBlockKind =
  | 'error'
  | 'example'
  | 'important'
  | 'info'
  | 'note'
  | 'tip'
  | 'warning';

const admonitionBlockOptions: Array<{
  colorClassName: string;
  kind: AdmonitionBlockKind;
  label: string;
}> = [
  { colorClassName: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-200', kind: 'note', label: 'Nota' },
  { colorClassName: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200', kind: 'info', label: 'Info' },
  { colorClassName: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200', kind: 'warning', label: 'Aviso' },
  { colorClassName: 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200', kind: 'important', label: 'Importante' },
  { colorClassName: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200', kind: 'tip', label: 'Tip' },
  { colorClassName: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200', kind: 'error', label: 'Error' },
  { colorClassName: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200', kind: 'example', label: 'Ejemplo' },
];

const admonitionPdfStyles: Record<
  AdmonitionBlockKind,
  {
    border: [number, number, number];
    fill: [number, number, number];
    label: string;
    text: [number, number, number];
  }
> = {
  error: {
    border: [244, 63, 94],
    fill: [255, 241, 242],
    label: 'Error',
    text: [136, 19, 55],
  },
  example: {
    border: [100, 116, 139],
    fill: [248, 250, 252],
    label: 'Ejemplo',
    text: [30, 41, 59],
  },
  important: {
    border: [99, 102, 241],
    fill: [238, 242, 255],
    label: 'Importante',
    text: [49, 46, 129],
  },
  info: {
    border: [14, 165, 233],
    fill: [240, 249, 255],
    label: 'Info',
    text: [12, 74, 110],
  },
  note: {
    border: [148, 163, 184],
    fill: [248, 250, 252],
    label: 'Nota',
    text: [51, 65, 85],
  },
  tip: {
    border: [16, 185, 129],
    fill: [236, 253, 245],
    label: 'Tip',
    text: [6, 95, 70],
  },
  warning: {
    border: [245, 158, 11],
    fill: [255, 251, 235],
    label: 'Aviso',
    text: [146, 64, 14],
  },
};

interface PdfCodeSegment {
  color: [number, number, number];
  fontStyle: 'bold' | 'normal';
  text: string;
}

interface PdfInlineSegment {
  fontStyle: 'bold' | 'bolditalic' | 'italic' | 'normal';
  href?: string;
  text: string;
  type: 'code' | 'link' | 'text';
}

interface PdfListItem {
  indentLevel: number;
  marker: string;
  text: string;
}

interface PdfTableRow {
  cells: string[];
}

type PdfContentBlock =
  | { content: string; type: 'text' }
  | { content: string; kind: AdmonitionBlockKind; type: 'admonition' }
  | { content: string; language?: string; type: 'code' }
  | { content: string; depth: number; type: 'heading' }
  | { items: PdfListItem[]; type: 'list' }
  | { size: 'paragraph'; type: 'spacer' }
  | { rows: PdfTableRow[]; type: 'table' };

type ModalState =
  | {
      entryId?: string;
      lockedCategory?: string;
      mode: 'create' | 'edit';
      type: 'entry';
    }
  | { categoryName?: string; mode: 'create' | 'edit'; type: 'category' }
  | { mode: 'create' | 'edit'; templateId?: string; type: 'template' }
  | null;

const getDefaultCategoryDefinition = (name: string): CategoryDefinition => {
  const trimmedName = name.trim();
  const fallbackMetadata = defaultCategoryMetadata[trimmedName];

  return {
    name: trimmedName,
    description:
      fallbackMetadata?.description ||
      `Documentacion y procedimientos relacionados con ${trimmedName}.`,
    color: fallbackMetadata?.color ?? 'slate',
  };
};

const normalizeEntry = (entry: KnowledgeEntry): KnowledgeEntry => ({
  ...entry,
  categoria: entry.categoria.trim(),
  comandos:
    entry.comandos
      ?.map((command) => ({
        label: command.label.trim(),
        value: command.value,
      }))
      .filter((command) => command.label.length > 0) ?? [],
  isPinned: Boolean(entry.isPinned),
  pasos: entry.pasos?.map((step) => step.trim()).filter(Boolean) ?? [],
  tags: entry.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
  updatedAt: entry.updatedAt || getCurrentIsoDate(),
});

const normalizeTemplate = (template: EntryTemplate): EntryTemplate => ({
  ...template,
  categoria: template.categoria?.trim() || undefined,
  comandos:
    template.comandos
      ?.map((command) => ({
        label: command.label.trim(),
        value: command.value,
      }))
      .filter((command) => command.label.length > 0) ?? [],
  isFavorite: Boolean(template.isFavorite),
  name: template.name.trim(),
  pasos: template.pasos?.map((step) => step.trim()).filter(Boolean) ?? [],
  tags: template.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [],
  titulo: template.titulo.trim(),
  updatedAt: template.updatedAt || getCurrentIsoDate(),
});

const deriveCategories = (
  entries: KnowledgeEntry[],
  categorySeed: CategoryDefinition[] = [],
) => {
  const categoryMap = new Map<string, CategoryDefinition>();

  categorySeed.forEach((category) => {
    const trimmedName = category.name.trim();
    if (!trimmedName) {
      return;
    }

    categoryMap.set(trimmedName.toLowerCase(), {
      ...getDefaultCategoryDefinition(trimmedName),
      ...category,
      name: trimmedName,
      description:
        category.description?.trim() ||
        getDefaultCategoryDefinition(trimmedName).description,
    });
  });

  entries.forEach((entry) => {
    const trimmedName = entry.categoria.trim();
    const key = trimmedName.toLowerCase();

    if (!categoryMap.has(key)) {
      categoryMap.set(key, getDefaultCategoryDefinition(trimmedName));
    }
  });

  return Array.from(categoryMap.values());
};

const applyLegacyCommandOverrides = (
  entries: KnowledgeEntry[],
  overrides: CommandOverridesByEntry,
) =>
  entries.map((entry) => {
    const entryOverrides = overrides[entry.id];

    if (!entryOverrides?.length || !entry.comandos?.length) {
      return entry;
    }

    const overrideMap = new Map(
      entryOverrides.map((commandOverride) => [
        commandOverride.label,
        commandOverride.value,
      ]),
    );

    return {
      ...entry,
      comandos: entry.comandos.map((command) => ({
        ...command,
        value: overrideMap.get(command.label) ?? command.value,
      })),
    };
  });

const normalizeQuickViews = (source: unknown): QuickViewDefinition[] => {
  if (!Array.isArray(source)) {
    return defaultQuickViews;
  }

  const normalizedQuickViews = source.reduce<QuickViewDefinition[]>(
    (accumulator, item, index) => {
      if (!item || typeof item !== 'object') {
        return accumulator;
      }

      const candidate = item as Partial<QuickViewDefinition>;
      const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
      const tone = candidate.tone;
      const categoryName =
        typeof candidate.categoryName === 'string'
          ? candidate.categoryName.trim()
          : '';
      const searchTerm =
        typeof candidate.searchTerm === 'string'
          ? candidate.searchTerm.trim()
          : '';
      const showPinnedOnly = Boolean(candidate.showPinnedOnly);

      if (!label || (!categoryName && !searchTerm && !showPinnedOnly)) {
        return accumulator;
      }

      accumulator.push({
        categoryName: categoryName || undefined,
        id:
          typeof candidate.id === 'string' && candidate.id.trim()
            ? candidate.id.trim()
            : `quick-view-${index + 1}`,
        label,
        searchTerm: searchTerm || undefined,
        showPinnedOnly,
        tone:
          tone === 'amber' || tone === 'emerald' || tone === 'sky' || tone === 'violet'
            ? tone
            : 'sky',
      });

      return accumulator;
    },
    [],
  );

  return normalizedQuickViews.length ? normalizedQuickViews : defaultQuickViews;
};

const normalizeManualData = (source: unknown): ManualData => {
  if (Array.isArray(source)) {
    const entries = source.map((entry) => normalizeEntry(entry as KnowledgeEntry));

    return {
      categories: deriveCategories(entries),
      deletedCategories: [],
      entries,
      settings: defaultSettings,
      templates: [],
      trash: [],
    };
  }

  if (source && typeof source === 'object') {
    const candidate = source as Partial<ManualData>;
    const entries = Array.isArray(candidate.entries)
      ? candidate.entries.map((entry) => normalizeEntry(entry))
      : [];
    const categories = Array.isArray(candidate.categories)
      ? deriveCategories(entries, candidate.categories)
      : deriveCategories(entries);
    const templates = Array.isArray(candidate.templates)
      ? candidate.templates.map((template) => normalizeTemplate(template))
      : [];

    return {
      categories,
      deletedCategories: Array.isArray(candidate.deletedCategories)
        ? dedupeCategoriesByName(candidate.deletedCategories).filter(
            (deletedCategory) =>
              !categories.some(
                (activeCategory) =>
                  activeCategory.name.toLowerCase() ===
                  deletedCategory.name.toLowerCase(),
              ),
          )
        : [],
      entries,
      settings: {
        ...defaultSettings,
        ...(candidate.settings ?? {}),
        customization: normalizeCustomization(candidate.settings?.customization),
        customEntryOrderByCategory: normalizeCustomEntryOrderByCategory(
          candidate.settings?.customEntryOrderByCategory,
        ),
        quickViews: normalizeQuickViews(candidate.settings?.quickViews),
      },
      templates,
      trash: Array.isArray(candidate.trash)
        ? candidate.trash.map((entry) => normalizeEntry(entry))
        : [],
    };
  }

  return {
    categories: [],
    deletedCategories: [],
    entries: [],
    settings: defaultSettings,
    templates: [],
    trash: [],
  };
};

const extractManualImportSource = (source: unknown) => {
  if (source && typeof source === 'object' && 'data' in source) {
    const backupCandidate = source as Partial<ManualBackupPayload>;

    if (backupCandidate.data) {
      return backupCandidate.data;
    }
  }

  return source;
};

const readStoredManualSnapshot = (): StoredManualSnapshot => {
  const baseManual = normalizeManualData(manualEntries);

  if (typeof window === 'undefined') {
    return {
      manualData: baseManual,
      source: 'bundled',
    };
  }

  try {
    const rawManual = window.localStorage.getItem(STORAGE_KEY);
    if (rawManual) {
      return {
        manualData: normalizeManualData(JSON.parse(rawManual)),
        source: 'local-storage',
      };
    }

    const rawLegacyOverrides = window.localStorage.getItem(
      LEGACY_COMMAND_STORAGE_KEY,
    );
    if (!rawLegacyOverrides) {
      return {
        manualData: baseManual,
        source: 'bundled',
      };
    }

    const legacyOverrides = JSON.parse(rawLegacyOverrides) as CommandOverridesByEntry;

    return {
      manualData: {
        ...baseManual,
        deletedCategories: [],
        entries: applyLegacyCommandOverrides(baseManual.entries, legacyOverrides),
        settings: baseManual.settings,
        trash: baseManual.trash,
      },
      source: 'local-storage',
    };
  } catch {
    return {
      manualData: baseManual,
      source: 'bundled',
    };
  }
};

const getFallbackManualSnapshot = (): StoredManualSnapshot => readStoredManualSnapshot();
const MAX_UNDO_HISTORY = 20;

const dedupeCategoriesByName = (categories: CategoryDefinition[]) => {
  const categoriesMap = new Map<string, CategoryDefinition>();

  categories.forEach((category) => {
    const trimmedName = category.name.trim();
    if (!trimmedName) {
      return;
    }

    categoriesMap.set(trimmedName.toLowerCase(), {
      ...getDefaultCategoryDefinition(trimmedName),
      ...category,
      name: trimmedName,
      description:
        category.description?.trim() ||
        getDefaultCategoryDefinition(trimmedName).description,
    });
  });

  return Array.from(categoriesMap.values());
};

const areManualDataEqual = (
  firstManualData: ManualData,
  secondManualData: ManualData,
) => JSON.stringify(firstManualData) === JSON.stringify(secondManualData);

const persistManualData = (manualData: ManualData) => {
  if (typeof window === 'undefined') {
    return;
  }

  // Recordatorio: Si se desarrolla un microservicio Java para centralizar estos Health Checks o gestionar la persistencia de la papelera, utilizar estrictamente try-catch-resources para el cierre seguro de flujos y sockets.
  // Recordatorio: Para cualquier proceso en Java que gestione la lectura o escritura de estos archivos de backup o metadatos de fichas, es obligatorio utilizar try-catch-resources para el cierre seguro de flujos de datos.
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(manualData));
};

const formatSavedAtTime = (date = new Date()) =>
  new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

const mergeByKey = <T,>(
  currentItems: T[],
  importedItems: T[],
  getKey: (item: T) => string,
) => {
  const mergedMap = new Map<string, T>();

  currentItems.forEach((item) => {
    mergedMap.set(getKey(item), item);
  });

  importedItems.forEach((item) => {
    mergedMap.set(getKey(item), item);
  });

  return Array.from(mergedMap.values());
};

const mergeManualData = (
  currentManualData: ManualData,
  importedManualData: ManualData,
): ManualData => {
  const mergedEntries = mergeByKey(
    currentManualData.entries,
    importedManualData.entries,
    (entry) => entry.id,
  );
  const mergedTemplates = mergeByKey(
    currentManualData.templates,
    importedManualData.templates,
    (template) => template.id,
  );
  const mergedCategories = deriveCategories(
    mergedEntries,
    mergeByKey(
      currentManualData.categories,
      importedManualData.categories,
      (category) => category.name.toLowerCase(),
    ),
  );
  const mergedTrash = mergeByKey(
    currentManualData.trash.filter(
      (trashEntry) => !mergedEntries.some((entry) => entry.id === trashEntry.id),
    ),
    importedManualData.trash.filter(
      (trashEntry) => !mergedEntries.some((entry) => entry.id === trashEntry.id),
    ),
    (entry) => entry.id,
  );
  const mergedDeletedCategories = dedupeCategoriesByName([
    ...(currentManualData.deletedCategories ?? []),
    ...(importedManualData.deletedCategories ?? []),
  ]).filter(
    (deletedCategory) =>
      !mergedCategories.some(
        (activeCategory) =>
          activeCategory.name.toLowerCase() === deletedCategory.name.toLowerCase(),
      ),
  );

  return normalizeManualData({
    categories: mergedCategories,
    deletedCategories: mergedDeletedCategories,
    entries: mergedEntries,
    settings: {
      ...currentManualData.settings,
      ...importedManualData.settings,
      customization: importedManualData.settings.customization,
    },
    templates: mergedTemplates,
    trash: mergedTrash,
  });
};

const buildBackupImportSummary = (
  currentManualData: ManualData,
  importedManualData: ManualData,
): BackupImportSummary => {
  const currentEntryIds = new Set(currentManualData.entries.map((entry) => entry.id));
  const currentEntryTitles = new Set(
    currentManualData.entries.map((entry) => normalizeComparableText(entry.titulo)),
  );
  const currentTemplateIds = new Set(
    currentManualData.templates.map((template) => template.id),
  );
  const currentTemplateNames = new Set(
    currentManualData.templates.map((template) =>
      normalizeComparableText(template.name),
    ),
  );
  const currentTemplateTitles = new Set(
    currentManualData.templates.map((template) =>
      normalizeComparableText(template.titulo),
    ),
  );
  const currentCategories = new Set(
    currentManualData.categories.map((category) =>
      normalizeComparableText(category.name),
    ),
  );
  const currentTrashIds = new Set(currentManualData.trash.map((entry) => entry.id));

  return {
    conflictingEntryIds: importedManualData.entries.filter((entry) =>
      currentEntryIds.has(entry.id),
    ).length,
    conflictingEntryTitles: importedManualData.entries.filter((entry) =>
      currentEntryTitles.has(normalizeComparableText(entry.titulo)),
    ).length,
    conflictingTemplateIds: importedManualData.templates.filter((template) =>
      currentTemplateIds.has(template.id),
    ).length,
    conflictingTemplateNames: importedManualData.templates.filter((template) =>
      currentTemplateNames.has(normalizeComparableText(template.name)),
    ).length,
    conflictingTemplateTitles: importedManualData.templates.filter((template) =>
      currentTemplateTitles.has(normalizeComparableText(template.titulo)),
    ).length,
    matchingCategories: importedManualData.categories.filter((category) =>
      currentCategories.has(normalizeComparableText(category.name)),
    ).length,
    newCategories: importedManualData.categories.filter(
      (category) => !currentCategories.has(normalizeComparableText(category.name)),
    ).length,
    newEntries: importedManualData.entries.filter(
      (entry) => !currentEntryIds.has(entry.id),
    ).length,
    newTemplates: importedManualData.templates.filter(
      (template) => !currentTemplateIds.has(template.id),
    ).length,
    newTrashEntries: importedManualData.trash.filter(
      (entry) =>
        !currentTrashIds.has(entry.id) && !currentEntryIds.has(entry.id),
    ).length,
  };
};

const splitLines = (value: string) =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeTags = (value: string) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const automaticTagStopWords = new Set([
  'a',
  'al',
  'ante',
  'bajo',
  'cabe',
  'con',
  'contra',
  'de',
  'del',
  'desde',
  'durante',
  'el',
  'en',
  'entre',
  'es',
  'esta',
  'este',
  'hacia',
  'hasta',
  'la',
  'las',
  'lo',
  'los',
  'mediante',
  'o',
  'para',
  'por',
  'segun',
  'sin',
  'sobre',
  'su',
  'sus',
  'tras',
  'un',
  'una',
  'uno',
  'unos',
  'unas',
  'y',
]);

const normalizeTagWords = (value: string) =>
  normalizeComparableText(value)
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .split(/[\s/-]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter(
      (word) =>
        !automaticTagStopWords.has(word) &&
        (word.length >= 4 ||
          ['api', 'aws', 'bdd', 'git', 'mdd', 'pdf', 'sql', 'svn', 'ui', 'url', 'vpn'].includes(
            word,
          )),
    );

const buildSearchableTag = (value: string) => {
  const words = normalizeTagWords(value).slice(0, 3);

  if (!words.length) {
    return '';
  }

  return words.join('-');
};

const generateAutomaticEntryTags = (entry: {
  categoria: string;
  comandos: CommandOption[];
  contenido: string;
  pasos: string[];
  titulo: string;
}) => {
  const rankedKeywords = new Map<string, number>();
  const nextTags: string[] = [];
  const pushTag = (value: string) => {
    if (!value || nextTags.includes(value)) {
      return;
    }

    nextTags.push(value);
  };
  const addWeightedWords = (value: string, weight: number) => {
    normalizeTagWords(value).forEach((word) => {
      rankedKeywords.set(word, (rankedKeywords.get(word) ?? 0) + weight);
    });
  };

  pushTag(buildSearchableTag(entry.categoria));

  entry.titulo
    .split(/[:|,;()]+/)
    .map((segment) => buildSearchableTag(segment))
    .filter(Boolean)
    .forEach(pushTag);

  addWeightedWords(entry.titulo, 4);
  addWeightedWords(entry.categoria, 3);
  entry.pasos.forEach((step) => addWeightedWords(step, 2));
  entry.comandos.forEach((command) => {
    addWeightedWords(command.label, 2);
    addWeightedWords(command.value, 1);
  });
  addWeightedWords(entry.contenido, 1);

  Array.from(rankedKeywords.entries())
    .sort((firstEntry, secondEntry) => {
      if (secondEntry[1] !== firstEntry[1]) {
        return secondEntry[1] - firstEntry[1];
      }

      return firstEntry[0].localeCompare(secondEntry[0], 'es');
    })
    .map(([word]) => word)
    .forEach(pushTag);

  return nextTags.slice(0, 5);
};

const normalizeComparableText = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const getQuickViewToneClass = (tone: QuickViewDefinition['tone']) => {
  if (tone === 'emerald') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200';
  }

  if (tone === 'violet') {
    return 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-200';
  }

  if (tone === 'amber') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200';
  }

  return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200';
};

const hexToRgba = (hex: string, alpha: number) => {
  const normalizedHex = hex.replace('#', '');
  const expandedHex =
    normalizedHex.length === 3
      ? normalizedHex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalizedHex;

  const red = Number.parseInt(expandedHex.slice(0, 2), 16);
  const green = Number.parseInt(expandedHex.slice(2, 4), 16);
  const blue = Number.parseInt(expandedHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const buildThemeVars = (colorKey: CategoryColorKey): CSSProperties => {
  const hex = getCategoryColorHex(colorKey);

  return {
    '--card-glow': hexToRgba(hex, 0.14),
    '--card-ring': hexToRgba(hex, 0.22),
    '--section-gradient-accent': hexToRgba(hex, 0.14),
    '--section-gradient-soft': hexToRgba(hex, 0.06),
    '--section-gradient-border': hexToRgba(hex, 0.4),
    '--section-gradient-highlight': hexToRgba(hex, 0.2),
    '--section-pill-accent': hexToRgba(hex, 0.16),
    '--section-pill-border': hexToRgba(hex, 0.34),
    '--field-focus': hex,
    '--field-focus-glow': hexToRgba(hex, 0.16),
  } as CSSProperties;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const ensureUniqueEntryId = (
  candidateId: string,
  entries: KnowledgeEntry[],
  originalId?: string,
) => {
  const normalizedBase = slugify(candidateId) || 'nueva-entrada';
  let nextId = normalizedBase;
  let suffix = 2;

  while (
    entries.some((entry) => entry.id === nextId && entry.id !== originalId)
  ) {
    nextId = `${normalizedBase}-${suffix}`;
    suffix += 1;
  }

  return nextId;
};

const buildEntryFormState = (
  entry?: KnowledgeEntry,
  category?: CategoryDefinition,
  categoryLocked = false,
): EntryFormState => ({
  categoryColor: category?.color ?? 'blue',
  categoryDescription: category?.description ?? '',
  categoryLocked,
  categoria: entry?.categoria ?? category?.name ?? '',
  comandos:
    entry?.comandos?.length
      ? entry.comandos.map((command) => ({ ...command }))
      : [{ label: '', value: '' }],
  contenido: entry?.contenido ?? '',
  id: entry?.id ?? '',
  pasos: entry?.pasos?.join('\n') ?? '',
  tags: entry?.tags?.join(', ') ?? '',
  titulo: entry?.titulo ?? '',
});

const buildCategoryFormState = (
  category?: CategoryDefinition,
): CategoryFormState => ({
  color: category?.color ?? 'blue',
  description: category?.description ?? '',
  name: category?.name ?? '',
});

const buildTemplateFormState = (
  template?: EntryTemplate,
  fallbackCategory = '',
): TemplateFormState => ({
  categoria: template?.categoria ?? fallbackCategory,
  comandos:
    template?.comandos?.length
      ? template.comandos.map((command) => ({ ...command }))
      : [{ label: '', value: '' }],
  contenido: template?.contenido ?? '',
  id: template?.id ?? '',
  name: template?.name ?? '',
  pasos: template?.pasos?.join('\n') ?? '',
  tags: template?.tags?.join(', ') ?? '',
  titulo: template?.titulo ?? '',
});

const buildDuplicatedTemplateFormState = (
  template: EntryTemplate,
): TemplateFormState => ({
  ...buildTemplateFormState(template),
  id: '',
  name: `Copia de ${template.name}`,
  titulo: template.titulo ? `Copia de ${template.titulo}` : '',
});

const applyTemplateToEntryForm = (
  currentForm: EntryFormState,
  template: EntryTemplate,
): EntryFormState => ({
  ...currentForm,
  categoria:
    currentForm.categoryLocked || currentForm.categoria.trim().length > 0
      ? currentForm.categoria
      : (template.categoria ?? currentForm.categoria),
  comandos:
    template.comandos?.length
      ? template.comandos.map((command) => ({ ...command }))
      : [{ label: '', value: '' }],
  contenido: template.contenido,
  pasos: template.pasos?.join('\n') ?? '',
  tags: template.tags.join(', '),
  titulo: template.titulo,
});

const updateContentSelection = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  before: string,
  after = '',
  placeholder = '',
) => {
  if (!textarea) {
    setValue(`${currentValue}${before}${placeholder}${after}`);
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = currentValue.slice(start, end);
  const nextText = selectedText || placeholder;
  const nextValue = `${currentValue.slice(0, start)}${before}${nextText}${after}${currentValue.slice(end)}`;
  const selectionStart = start + before.length;
  const selectionEnd = selectionStart + nextText.length;

  updateTextareaValueWithSelection(
    textarea,
    setValue,
    nextValue,
    selectionStart,
    selectionEnd,
  );
};

const insertTextAtCursor = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  textToInsert: string,
) => {
  if (!textarea) {
    setValue(`${currentValue}${textToInsert}`);
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const nextValue = `${currentValue.slice(0, start)}${textToInsert}${currentValue.slice(end)}`;
  const nextCursorPosition = start + textToInsert.length;
  const nextScrollTop = textarea.scrollTop;

  setValue(nextValue);

  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    textarea.scrollTop = nextScrollTop;
  });
};

const insertSnippetAtCursor = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  snippet: string,
  cursorOffset: number,
  selectionLength = 0,
) => {
  if (!textarea) {
    setValue(`${currentValue}${snippet}`);
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const nextValue = `${currentValue.slice(0, start)}${snippet}${currentValue.slice(end)}`;
  const selectionStart = start + cursorOffset;
  const selectionEnd = selectionStart + selectionLength;
  const nextScrollTop = textarea.scrollTop;

  updateTextareaValueWithSelection(
    textarea,
    setValue,
    nextValue,
    selectionStart,
    selectionEnd,
    nextScrollTop,
  );
};

const insertAdmonitionBlockAtCursor = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  kind: AdmonitionBlockKind,
) => {
  const snippet = `:::${kind}\n\n:::\n`;
  const cursorOffset = `:::${kind}\n`.length;

  insertSnippetAtCursor(
    textarea,
    currentValue,
    setValue,
    snippet,
    cursorOffset,
    0,
  );
};

const updateTextareaValueWithSelection = (
  textarea: HTMLTextAreaElement | null,
  setValue: (nextValue: string) => void,
  nextValue: string,
  selectionStart: number,
  selectionEnd = selectionStart,
  scrollTop?: number,
) => {
  setValue(nextValue);

  if (!textarea) {
    return;
  }

  const nextScrollTop = scrollTop ?? textarea.scrollTop;

  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
    textarea.scrollTop = nextScrollTop;
  });
};

const getEditorSelectionState = (
  textarea: HTMLTextAreaElement | null,
): EditorSelectionState => {
  if (!textarea) {
    return {
      hasSelection: false,
      selectedCharacters: 0,
      selectedLines: 1,
    };
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.slice(start, end);

  return {
    hasSelection: start !== end,
    selectedCharacters: Math.max(0, end - start),
    selectedLines: Math.max(1, selectedText.split('\n').length),
  };
};

const prefixCurrentOrSelectedLines = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  prefixBuilder: (lineIndex: number) => string,
) => {
  if (!textarea) {
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const hasSelection = start !== end;
  const lineStart = currentValue.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = currentValue.indexOf('\n', end);
  const safeLineEnd = lineEnd === -1 ? currentValue.length : lineEnd;

  if (!hasSelection) {
    const currentLine = currentValue.slice(lineStart, safeLineEnd);
    const prefixedLine = `${prefixBuilder(0)}${currentLine}`;
    const nextValue = `${currentValue.slice(0, lineStart)}${prefixedLine}${currentValue.slice(safeLineEnd)}`;
    const cursorOffset = start - lineStart;
    const nextCursorPosition = lineStart + prefixBuilder(0).length + cursorOffset;

    updateTextareaValueWithSelection(
      textarea,
      setValue,
      nextValue,
      nextCursorPosition,
      nextCursorPosition,
    );
    return;
  }

  const selectedBlock = currentValue.slice(lineStart, safeLineEnd);
  const prefixedBlock = selectedBlock
    .split('\n')
    .map((line, lineIndex) => `${prefixBuilder(lineIndex)}${line}`)
    .join('\n');
  const nextValue = `${currentValue.slice(0, lineStart)}${prefixedBlock}${currentValue.slice(safeLineEnd)}`;
  const firstPrefixLength = prefixBuilder(0).length;
  const totalAddedCharacters = selectedBlock
    .split('\n')
    .reduce((sum, _line, lineIndex) => sum + prefixBuilder(lineIndex).length, 0);

  updateTextareaValueWithSelection(
    textarea,
    setValue,
    nextValue,
    start + firstPrefixLength,
    end + totalAddedCharacters,
  );
};

const indentSelectedLines = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  indent = '    ',
) => {
  if (!textarea) {
    setValue(`${currentValue}${indent}`);
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const lineStart = currentValue.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = currentValue.indexOf('\n', end);
  const safeLineEnd = lineEnd === -1 ? currentValue.length : lineEnd;
  const selectedBlock = currentValue.slice(lineStart, safeLineEnd);
  const indentedBlock = selectedBlock
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
  const nextValue = `${currentValue.slice(0, lineStart)}${indentedBlock}${currentValue.slice(safeLineEnd)}`;
  updateTextareaValueWithSelection(
    textarea,
    setValue,
    nextValue,
    start + indent.length,
    end + indent.length * selectedBlock.split('\n').length,
  );
};

const outdentSelectedLines = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  indent = '    ',
) => {
  if (!textarea) {
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const lineStart = currentValue.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = currentValue.indexOf('\n', end);
  const safeLineEnd = lineEnd === -1 ? currentValue.length : lineEnd;
  const selectedBlock = currentValue.slice(lineStart, safeLineEnd);
  let removedBeforeStart = 0;
  let removedTotal = 0;

  const outdentedBlock = selectedBlock
    .split('\n')
    .map((line, index) => {
      let nextLine = line;
      let removedFromLine = 0;

      if (nextLine.startsWith(indent)) {
        nextLine = nextLine.slice(indent.length);
        removedFromLine = indent.length;
      } else {
        const leadingWhitespace = nextLine.match(/^\s+/)?.[0] ?? '';
        if (leadingWhitespace.length) {
          removedFromLine = Math.min(indent.length, leadingWhitespace.length);
          nextLine = nextLine.slice(removedFromLine);
        }
      }

      if (index === 0) {
        removedBeforeStart = removedFromLine;
      }
      removedTotal += removedFromLine;

      return nextLine;
    })
    .join('\n');

  const nextValue = `${currentValue.slice(0, lineStart)}${outdentedBlock}${currentValue.slice(safeLineEnd)}`;
  updateTextareaValueWithSelection(
    textarea,
    setValue,
    nextValue,
    Math.max(lineStart, start - removedBeforeStart),
    Math.max(lineStart, end - removedTotal),
  );
};

const wrapTextWords = (
  text: string,
  maxWidth: number,
  firstPrefix = '',
  continuationPrefix = firstPrefix,
): string[] => {
  const normalizedWords = text.trim().split(/\s+/).filter(Boolean);

  if (!normalizedWords.length) {
    return [firstPrefix.trimEnd()];
  }

  const lines: string[] = [];
  let currentLine = firstPrefix;

  normalizedWords.forEach((word) => {
    const candidate = `${currentLine}${currentLine.trim().length ? ' ' : ''}${word}`;
    if (candidate.length <= maxWidth || currentLine === firstPrefix) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine.trimEnd());
    currentLine = `${continuationPrefix}${word}`;
  });

  if (currentLine.trim().length) {
    lines.push(currentLine.trimEnd());
  }

  return lines;
};

const wrapCodeLikeLine = (line: string, maxWidth: number): string[] => {
  if (line.length <= maxWidth) {
    return [line];
  }

  const leadingIndent = line.match(/^\s*/)?.[0] ?? '';
  const trimmedLine = line.trim();
  const continuationIndent = `${leadingIndent}    `;
  const commentMatch = trimmedLine.match(/^(\/\/+\s*|#\s*|\*\s*)(.*)$/);

  if (commentMatch) {
    const [, marker, commentBody] = commentMatch;
    return wrapTextWords(
      commentBody,
      maxWidth,
      `${leadingIndent}${marker}`,
      `${leadingIndent}${marker}`,
    );
  }

  const codeAndCommentMatch = line.match(/^(.*?)(\s+\/\/\s*.+)$/);
  if (codeAndCommentMatch) {
    const codePart = codeAndCommentMatch[1].trimEnd();
    const commentPart = codeAndCommentMatch[2].trimStart();
    const wrappedCode = wrapCodeLikeLine(codePart, maxWidth);
    const wrappedComment = wrapCodeLikeLine(`${continuationIndent}${commentPart}`, maxWidth);
    return [...wrappedCode, ...wrappedComment];
  }

  const openParenIndex = trimmedLine.indexOf('(');
  const closeParenIndex = trimmedLine.lastIndexOf(')');
  if (openParenIndex !== -1 && closeParenIndex > openParenIndex && trimmedLine.includes(',')) {
    const prefix = `${leadingIndent}${trimmedLine.slice(0, openParenIndex + 1).trim()}`;
    const innerContent = trimmedLine.slice(openParenIndex + 1, closeParenIndex).trim();
    const suffix = trimmedLine.slice(closeParenIndex).trim();
    const parameters = innerContent.length
      ? innerContent.split(',').map((segment) => segment.trim()).filter(Boolean)
      : [];

    if (parameters.length > 1) {
      const wrappedLines = [prefix];
      parameters.forEach((parameter, parameterIndex) => {
        const suffixComma = parameterIndex < parameters.length - 1 ? ',' : '';
        const wrappedParameterLines = wrapTextWords(
          `${parameter}${suffixComma}`,
          maxWidth,
          continuationIndent,
          `${continuationIndent}    `,
        );
        wrappedLines.push(...wrappedParameterLines);
      });
      wrappedLines.push(`${leadingIndent}${suffix}`);
      return wrappedLines;
    }
  }

  if (trimmedLine.includes(',')) {
    const segments = trimmedLine.split(',').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length > 1) {
      const wrappedLines: string[] = [];
      let currentLine = `${leadingIndent}${segments[0]}`;

      segments.slice(1).forEach((segment) => {
        const candidate = `${currentLine}, ${segment}`;
        if (candidate.length <= maxWidth) {
          currentLine = candidate;
          return;
        }

        wrappedLines.push(`${currentLine},`);
        currentLine = `${continuationIndent}${segment}`;
      });

      wrappedLines.push(currentLine);
      return wrappedLines;
    }
  }

  const operatorWrapMatch = trimmedLine.match(/^(.*?)(\s*(?:=>|=|\+|\-|\*|\/|\|\||&&)\s+.*)$/);
  if (operatorWrapMatch) {
    const [, leftPart, rightPart] = operatorWrapMatch;
    const wrappedRight = wrapTextWords(
      rightPart.trim(),
      maxWidth,
      continuationIndent,
      continuationIndent,
    );
    return [`${leadingIndent}${leftPart.trimEnd()}`, ...wrappedRight];
  }

  return wrapTextWords(trimmedLine, maxWidth, leadingIndent, continuationIndent);
};

const wrapMarkdownSelection = (
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
  maxWidth = 96,
) => {
  if (!textarea) {
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const hasSelection = start !== end;
  const blockStart = hasSelection
    ? currentValue.lastIndexOf('\n', start - 1) + 1
    : currentValue.lastIndexOf('\n', start - 1) + 1;
  const blockEndIndex = hasSelection
    ? currentValue.indexOf('\n', end)
    : currentValue.indexOf('\n', start);
  const blockEnd = blockEndIndex === -1 ? currentValue.length : blockEndIndex;
  const targetBlock = currentValue.slice(blockStart, blockEnd);

  const wrappedBlock = targetBlock
    .split('\n')
    .map((line) => {
      if (!line.trim().length) {
        return '';
      }

      const looksLikeCode =
        /^\s*```/.test(line) ||
        /^\s*(public|private|protected|class|if|else|for|while|return|const|let|var|function)\b/.test(line) ||
        /[;{}()[\]=<>]/.test(line) ||
        /^\s*(\/\/|#|\*)/.test(line);

      return (looksLikeCode ? wrapCodeLikeLine(line, maxWidth) : wrapTextWords(line, maxWidth)).join('\n');
    })
    .join('\n');

  const nextValue = `${currentValue.slice(0, blockStart)}${wrappedBlock}${currentValue.slice(blockEnd)}`;
  updateTextareaValueWithSelection(
    textarea,
    setValue,
    nextValue,
    blockStart,
    blockStart + wrappedBlock.length,
    textarea.scrollTop,
  );
};

const markdownListPattern = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

const orderedMarkdownListPattern = /^(\s*)(\d+)\.\s+(.*)$/;

const renumberOrderedMarkdownLists = (value: string) => {
  const lines = value.split('\n');
  const counters = new Map<number, number>();
  const activeOrderedLevels = new Set<number>();
  const unorderedLevels = new Set<number>();

  const clearDeeperLevels = (level: number) => {
    Array.from(counters.keys()).forEach((key) => {
      if (key > level) {
        counters.delete(key);
      }
    });

    Array.from(activeOrderedLevels).forEach((key) => {
      if (key > level) {
        activeOrderedLevels.delete(key);
      }
    });

    Array.from(unorderedLevels).forEach((key) => {
      if (key > level) {
        unorderedLevels.delete(key);
      }
    });
  };

  return lines
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        counters.clear();
        activeOrderedLevels.clear();
        unorderedLevels.clear();
        return line;
      }

      const orderedMatch = line.match(orderedMarkdownListPattern);
      if (orderedMatch) {
        const [, indentation, , content] = orderedMatch;
        const level = getIndentLevel(indentation);

        clearDeeperLevels(level);

        if (unorderedLevels.has(level)) {
          counters.set(level, 0);
        }

        const nextNumber = (counters.get(level) ?? 0) + 1;
        counters.set(level, nextNumber);
        activeOrderedLevels.add(level);
        unorderedLevels.delete(level);

        return `${indentation}${nextNumber}. ${content}`;
      }

      const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
      if (unorderedMatch) {
        const [, indentation] = unorderedMatch;
        const level = getIndentLevel(indentation);

        clearDeeperLevels(level);
        counters.delete(level);
        activeOrderedLevels.delete(level);
        unorderedLevels.add(level);

        return line;
      }

      const leadingIndentLevel = getIndentLevel(line);
      Array.from(counters.keys()).forEach((key) => {
        if (key >= leadingIndentLevel) {
          counters.delete(key);
          activeOrderedLevels.delete(key);
          unorderedLevels.delete(key);
        }
      });

      return line;
    })
    .join('\n');
};

const setEditorValueAndNormalizeLists = (
  textarea: HTMLTextAreaElement | null,
  _currentValue: string,
  setValue: (nextValue: string) => void,
  buildNextValue: (selectionStart: number, selectionEnd: number) => {
    nextValue: string;
    selectionEnd?: number;
    selectionStart?: number;
  },
  scrollTop?: number,
) => {
  if (!textarea) {
    return;
  }

  const initialSelectionStart = textarea.selectionStart;
  const initialSelectionEnd = textarea.selectionEnd;
  const initialScrollTop = scrollTop ?? textarea.scrollTop;
  const { nextValue, selectionStart, selectionEnd } = buildNextValue(
    initialSelectionStart,
    initialSelectionEnd,
  );

  const normalizedValue = renumberOrderedMarkdownLists(nextValue);
  const selectionAnchor = selectionStart ?? initialSelectionStart;
  const selectionFocus = selectionEnd ?? selectionAnchor;
  const selectionDelta = normalizedValue.length - nextValue.length;
  const adjustedSelectionEnd = Math.max(selectionAnchor, selectionFocus + selectionDelta);

  updateTextareaValueWithSelection(
    textarea,
    setValue,
    normalizedValue,
    selectionAnchor,
    adjustedSelectionEnd,
    initialScrollTop,
  );
};

const handleMarkdownEditorKeyDown = (
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  setValue: (nextValue: string) => void,
) => {
  if (!textarea) {
    return;
  }

  const hasModifier = event.ctrlKey || event.metaKey;

  if (hasModifier && !event.altKey) {
    const normalizedKey = event.key.toLowerCase();

    if (normalizedKey === 'b') {
      event.preventDefault();
      updateContentSelection(textarea, currentValue, setValue, '**', '**');
      return;
    }

    if (normalizedKey === 'i') {
      event.preventDefault();
      updateContentSelection(textarea, currentValue, setValue, '*', '*');
      return;
    }

    if (normalizedKey === 'k') {
      event.preventDefault();
      updateContentSelection(textarea, currentValue, setValue, '[', ']()');
      return;
    }

    if (event.shiftKey && normalizedKey === '7') {
      event.preventDefault();
      prefixCurrentOrSelectedLines(textarea, currentValue, setValue, (lineIndex) => `${lineIndex + 1}. `);
      return;
    }

    if (event.shiftKey && normalizedKey === '8') {
      event.preventDefault();
      prefixCurrentOrSelectedLines(textarea, currentValue, setValue, () => '- ');
      return;
    }
  }

  if (hasModifier && event.altKey) {
    if (event.key === '1') {
      event.preventDefault();
      prefixCurrentOrSelectedLines(textarea, currentValue, setValue, () => '# ');
      return;
    }

    if (event.key === '2') {
      event.preventDefault();
      prefixCurrentOrSelectedLines(textarea, currentValue, setValue, () => '## ');
      return;
    }

    if (event.key === '3') {
      event.preventDefault();
      prefixCurrentOrSelectedLines(textarea, currentValue, setValue, () => '### ');
      return;
    }
  }

  if (event.key === 'Tab') {
    event.preventDefault();

    if (event.shiftKey) {
      outdentSelectedLines(textarea, currentValue, setValue);
      return;
    }

    indentSelectedLines(textarea, currentValue, setValue);
    return;
  }

  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start !== end) {
    return;
  }

  const lineStart = currentValue.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = currentValue.indexOf('\n', start);
  const safeLineEnd = lineEnd === -1 ? currentValue.length : lineEnd;
  const currentLine = currentValue.slice(lineStart, safeLineEnd);
  const listMatch = currentLine.match(markdownListPattern);

  if (!listMatch) {
    return;
  }

  event.preventDefault();

  const [, indentation, marker, content] = listMatch;
  const trimmedContent = content.trim();
  const nextMarker = /^\d+\.$/.test(marker)
    ? `${Number.parseInt(marker, 10) + 1}.`
    : marker;

  if (!trimmedContent) {
    const nextIndentation = indentation.length >= 4
      ? indentation.slice(0, Math.max(0, indentation.length - 4))
      : '';
    const replacementLine = nextIndentation;
    const nextValue = `${currentValue.slice(0, lineStart)}${replacementLine}${currentValue.slice(safeLineEnd)}`;
    const nextCursorPosition = lineStart + replacementLine.length;

    updateTextareaValueWithSelection(
      textarea,
      setValue,
      nextValue,
      nextCursorPosition,
      nextCursorPosition,
    );
    return;
  }

  const insertedText = `\n${indentation}${nextMarker} `;
  const nextCursorPosition = start + insertedText.length;

  setEditorValueAndNormalizeLists(
    textarea,
    currentValue,
    setValue,
    () => ({
      nextValue: `${currentValue.slice(0, start)}${insertedText}${currentValue.slice(end)}`,
      selectionStart: nextCursorPosition,
      selectionEnd: nextCursorPosition,
    }),
  );
};

const normalizePastedMarkdownText = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\uFEFF]/g, '')
    .replace(/^\t+/gm, (tabs) => '    '.repeat(tabs.length))
    .replace(/^([ \t]*)([•◦▪▫●○◉‣⁃▪︎])\s+/gm, '$1- ')
    .replace(/^([ \t]*)(\d+)[\)\.]?\s+/gm, '$1$2. ')
    .replace(/[ \t]+\n/g, '\n');

const cleanMarkdownSpacing = (value: string) =>
  value
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const convertHtmlClipboardToMarkdown = (html: string) => {
  if (typeof DOMParser === 'undefined' || !html.trim()) {
    return '';
  }

  const parser = new DOMParser();
  const normalizedHtml = html
    .replace(/<!--StartFragment-->|<!--EndFragment-->/gi, '')
    .replace(/<o:p>\s*<\/o:p>/gi, '')
    .replace(/<o:p>.*?<\/o:p>/gi, ' ');
  const document = parser.parseFromString(normalizedHtml, 'text/html');

  document.querySelectorAll('script,style,meta,link,title').forEach((node) => {
    node.remove();
  });

  document.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const style = element.getAttribute('style')?.toLowerCase() ?? '';
    const marginLeftMatch = style.match(/margin-left:\s*([\d.]+)(px|pt)/);
    if (marginLeftMatch && !element.dataset.indentLevel) {
      const rawValue = Number.parseFloat(marginLeftMatch[1] ?? '0');
      const unit = marginLeftMatch[2] ?? 'px';
      const pixels = unit === 'pt' ? rawValue * 1.3333 : rawValue;
      element.dataset.indentLevel = `${Math.max(0, Math.round(pixels / 32))}`;
    }
  });

  const renderInlineNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.replace(/\s+/g, ' ') ?? '';
    }

    if (!(node instanceof HTMLElement)) {
      return '';
    }

    const content = Array.from(node.childNodes).map(renderInlineNode).join('');
    const normalizedContent = content.trim();

    switch (node.tagName.toLowerCase()) {
      case 'strong':
      case 'b':
        return normalizedContent ? `**${normalizedContent}**` : '';
      case 'em':
      case 'i':
        return normalizedContent ? `*${normalizedContent}*` : '';
      case 'code':
        return normalizedContent ? `\`${normalizedContent}\`` : '';
      case 'a': {
        const href = node.getAttribute('href')?.trim() ?? '';
        return href ? `[${normalizedContent || href}](${href})` : content;
      }
      case 'br':
        return '\n';
      default:
        if (!normalizedContent) {
          return content;
        }

        return content;
    }
  };

  const renderBlockNode = (node: Node, listDepth = 0): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }

    if (!(node instanceof HTMLElement)) {
      return '';
    }

    const tagName = node.tagName.toLowerCase();
    const inlineContent = cleanMarkdownSpacing(
      Array.from(node.childNodes).map(renderInlineNode).join(''),
    );

    switch (tagName) {
      case 'h1':
        return inlineContent ? `# ${inlineContent}` : '';
      case 'h2':
        return inlineContent ? `## ${inlineContent}` : '';
      case 'h3':
        return inlineContent ? `### ${inlineContent}` : '';
      case 'h4':
        return inlineContent ? `#### ${inlineContent}` : '';
      case 'h5':
        return inlineContent ? `##### ${inlineContent}` : '';
      case 'h6':
        return inlineContent ? `###### ${inlineContent}` : '';
      case 'p':
      case 'div':
        return inlineContent;
      case 'blockquote':
        return inlineContent
          .split('\n')
          .map((line) => (line.trim() ? `> ${line.trim()}` : '>'))
          .join('\n');
      case 'pre': {
        const codeText = node.textContent?.replace(/\r\n/g, '\n').trimEnd() ?? '';
        return codeText ? `\`\`\`\n${codeText}\n\`\`\`` : '';
      }
      case 'ul':
      case 'ol':
        return Array.from(node.children)
          .filter((child) => child.tagName.toLowerCase() === 'li')
          .map((child, index) =>
            renderListItem(
              child as HTMLElement,
              tagName === 'ol'
                ? `${Number.parseInt(node.getAttribute('start') ?? '1', 10) + index}.`
                : '-',
              listDepth,
            ),
          )
          .join('\n');
      case 'li':
        return renderListItem(node, '-', listDepth);
      case 'table': {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (!rows.length) {
          return '';
        }

        const tableRows = rows.map((row) =>
          Array.from(row.children)
            .map((cell) => cleanMarkdownSpacing(cell.textContent ?? ''))
            .join(' | '),
        );
        const headerCells = rows[0] ? Array.from(rows[0].children).length : 0;
        const separator = headerCells
          ? Array.from({ length: headerCells }, () => '---').join(' | ')
          : '';

        return [`| ${tableRows[0]} |`, separator ? `| ${separator} |` : '', ...tableRows.slice(1).map((row) => `| ${row} |`)]
          .filter(Boolean)
          .join('\n');
      }
      default: {
        const childBlocks = Array.from(node.childNodes)
          .map((child) => renderBlockNode(child, listDepth))
          .filter(Boolean);

        return childBlocks.length ? childBlocks.join('\n\n') : inlineContent;
      }
    }
  };

  const renderListItem = (
    element: HTMLElement,
    marker: string,
    listDepth: number,
  ) => {
    const explicitIndentLevel = Number.parseInt(element.dataset.indentLevel ?? '', 10);
    const computedDepth =
      Number.isFinite(explicitIndentLevel) && explicitIndentLevel > listDepth
        ? explicitIndentLevel
        : listDepth;
    const indent = '    '.repeat(computedDepth);
    const nestedBlocks: string[] = [];
    const contentParts: string[] = [];

    Array.from(element.childNodes).forEach((child) => {
      if (
        child instanceof HTMLElement &&
        (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol')
      ) {
        const nestedContent = renderBlockNode(child, listDepth + 1);
        if (nestedContent) {
          nestedBlocks.push(nestedContent);
        }
        return;
      }

      contentParts.push(renderInlineNode(child));
    });

    const itemLine = `${indent}${marker} ${cleanMarkdownSpacing(contentParts.join(''))}`.trimEnd();

    return [itemLine, ...nestedBlocks].filter(Boolean).join('\n');
  };

  const bodyContent = Array.from(document.body.childNodes)
    .map((node) => renderBlockNode(node))
    .filter(Boolean)
    .join('\n\n');

  return cleanMarkdownSpacing(normalizePastedMarkdownText(bodyContent));
};

const normalizeIndentation = (value: string) => value.replace(/\t/g, '    ');

const getIndentLevel = (value: string) => {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? '';
  const normalizedLength = normalizeIndentation(leadingWhitespace).length;

  return Math.floor(normalizedLength / 4);
};

const stripLeadingWhitespace = (value: string) => value.replace(/^\s+/, '');

const normalizePdfRichText = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const flattenPdfInlineMarkdown = (value: string) =>
  parsePdfInlineSegments(value)
    .map((segment) => segment.text)
    .join('');

const parsePdfInlineSegments = (value: string): PdfInlineSegment[] => {
  const segments: PdfInlineSegment[] = [];
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*\n]+)\*)|(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      segments.push({
        fontStyle: 'normal',
        text: value.slice(lastIndex, matchIndex),
        type: 'text',
      });
    }

    if (match[1] && match[2]) {
      segments.push({
        fontStyle: 'normal',
        href: match[2],
        text: match[1],
        type: 'link',
      });
    } else if (match[4]) {
      segments.push({
        fontStyle: 'bolditalic',
        text: match[4],
        type: 'text',
      });
    } else if (match[6]) {
      segments.push({
        fontStyle: 'bold',
        text: match[6],
        type: 'text',
      });
    } else if (match[8]) {
      segments.push({
        fontStyle: 'normal',
        text: match[8],
        type: 'code',
      });
    } else if (match[10]) {
      segments.push({
        fontStyle: 'italic',
        text: match[10],
        type: 'text',
      });
    } else if (match[11]) {
      segments.push({
        fontStyle: 'normal',
        href: match[11],
        text: match[11],
        type: 'link',
      });
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < value.length) {
    segments.push({
      fontStyle: 'normal',
      text: value.slice(lastIndex),
      type: 'text',
    });
  }

  return segments.length
    ? segments
    : [
        {
          fontStyle: 'normal',
          text: value,
          type: 'text',
        },
      ];
};

const parsePdfContentBlocks = (value: string): PdfContentBlock[] => {
  const blocks: PdfContentBlock[] = [];
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  let textBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let listBuffer: PdfListItem[] = [];
  let tableBuffer: string[] = [];
  let admonitionBuffer: string[] = [];
  let admonitionKind: AdmonitionBlockKind | null = null;
  let codeLanguage = '';
  let isInsideCodeBlock = false;
  const admonitionPattern =
    /^:::(note|info|warning|important|tip|error|example)\s*$/i;
  const isMarkdownTableLine = (line: string) => {
    const trimmedLine = line.trim();
    return trimmedLine.includes('|') && trimmedLine.split('|').length >= 3;
  };
  const isMarkdownTableSeparator = (line: string) =>
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
  const parseTableRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => normalizePdfRichText(cell.trim()));
  const parseListLine = (line: string) => {
    const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (bulletMatch) {
      return {
        indentLevel: getIndentLevel(bulletMatch[1]),
        marker: bulletMatch[2],
        text: normalizePdfRichText(bulletMatch[3]),
      };
    }

    const orderedMatch = line.match(/^(\s*)(\d+\.)\s+(.+)$/);
    if (orderedMatch) {
      return {
        indentLevel: getIndentLevel(orderedMatch[1]),
        marker: orderedMatch[2],
        text: normalizePdfRichText(orderedMatch[3]),
      };
    }

    return null;
  };
  const parseHeadingLine = (line: string) => {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch) {
      return null;
    }

    return {
      content: normalizePdfRichText(headingMatch[2]),
      depth: headingMatch[1].length,
      type: 'heading' as const,
    };
  };
  const pushParagraphSpacer = () => {
    const lastBlock = blocks[blocks.length - 1];

    if (!lastBlock || lastBlock.type === 'spacer') {
      return;
    }

    blocks.push({ size: 'paragraph', type: 'spacer' });
  };

  const flushTextBuffer = () => {
    if (!textBuffer.length) {
      return;
    }

    const normalizedText = normalizePdfRichText(textBuffer.join('\n'));
    if (normalizedText.trim()) {
      blocks.push({ content: normalizedText, type: 'text' });
    }

    textBuffer = [];
  };

  const flushListBuffer = () => {
    if (!listBuffer.length) {
      return;
    }

    blocks.push({
      items: listBuffer.filter((item) => item.text.trim().length > 0),
      type: 'list',
    });
    listBuffer = [];
  };

  const flushTableBuffer = () => {
    if (!tableBuffer.length) {
      return;
    }

    const rows = tableBuffer
      .filter((line) => !isMarkdownTableSeparator(line))
      .map((line) => ({ cells: parseTableRow(line) }))
      .filter((row) => row.cells.some((cell) => cell.length > 0));

    if (rows.length) {
      blocks.push({
        rows,
        type: 'table',
      });
    }

    tableBuffer = [];
  };

  const flushCodeBuffer = () => {
    const codeContent = codeBuffer.join('\n').replace(/\s+$/, '');
    if (codeContent.trim()) {
      blocks.push({
        content: codeContent,
        language: codeLanguage || undefined,
        type: 'code',
      });
    }

    codeBuffer = [];
    codeLanguage = '';
  };

  const flushAdmonitionBuffer = () => {
    if (admonitionKind && admonitionBuffer.join('\n').trim()) {
      blocks.push({
        content: admonitionBuffer.join('\n').trim(),
        kind: admonitionKind,
        type: 'admonition',
      });
    }

    admonitionBuffer = [];
    admonitionKind = null;
  };

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (admonitionKind) {
      if (trimmedLine === ':::') {
        flushAdmonitionBuffer();
      } else {
        admonitionBuffer.push(line);
      }
      return;
    }

    if (trimmedLine.startsWith('```')) {
      flushTextBuffer();
      flushListBuffer();
      flushTableBuffer();

      if (isInsideCodeBlock) {
        flushCodeBuffer();
        isInsideCodeBlock = false;
      } else {
        flushTextBuffer();
        isInsideCodeBlock = true;
        codeLanguage = trimmedLine.slice(3).trim();
      }

      return;
    }

    if (isInsideCodeBlock) {
      codeBuffer.push(line.replace(/\t/g, '  '));
      return;
    }

    if (!trimmedLine) {
      flushTextBuffer();
      flushListBuffer();
      flushTableBuffer();
      pushParagraphSpacer();
      return;
    }

    const parsedHeading = parseHeadingLine(line);
    if (parsedHeading) {
      flushTextBuffer();
      flushListBuffer();
      flushTableBuffer();
      blocks.push(parsedHeading);
      return;
    }

    const parsedListItem = parseListLine(line);
    if (parsedListItem) {
      flushTextBuffer();
      flushTableBuffer();
      listBuffer.push(parsedListItem);
      return;
    }

    const admonitionMatch = trimmedLine.match(admonitionPattern);
    if (admonitionMatch) {
      flushTextBuffer();
      flushListBuffer();
      flushTableBuffer();
      admonitionKind = admonitionMatch[1].toLowerCase() as AdmonitionBlockKind;
      admonitionBuffer = [];
      return;
    }

    if (listBuffer.length) {
      const lastListItem = listBuffer[listBuffer.length - 1];
      const lastIndentLevel = lastListItem?.indentLevel ?? 0;
      const currentIndentLevel = getIndentLevel(line);

      if (/^\s+/.test(line) && currentIndentLevel >= lastIndentLevel) {
        listBuffer[listBuffer.length - 1] = {
          ...lastListItem,
          text: `${lastListItem.text}\n${normalizePdfRichText(trimmedLine)}`.trim(),
        };
        return;
      }

      flushListBuffer();
    }

    if (isMarkdownTableLine(line)) {
      flushTextBuffer();
      tableBuffer.push(line);
      return;
    }

    if (tableBuffer.length) {
      flushTableBuffer();
    }

    textBuffer.push(line);
  });

  if (isInsideCodeBlock) {
    flushCodeBuffer();
  }

  if (admonitionKind) {
    textBuffer.push(`:::${admonitionKind}`, ...admonitionBuffer);
  }

  flushTextBuffer();
  flushListBuffer();
  flushTableBuffer();

  return blocks;
};

const pdfCodeKeywords = new Set([
  'abstract',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'record',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'try',
  'var',
  'void',
  'volatile',
  'while',
]);

const markdownImagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;

const getApiBaseUrl = () => {
  if (typeof window === 'undefined') {
    return 'http://localhost:3001';
  }

  const { origin } = window.location;

  if (/localhost:517\d|127\.0\.0\.1:517\d/.test(origin)) {
    return 'http://localhost:3001';
  }

  return origin;
};

const resolvePdfImageUrl = (source: string) => {
  if (/^https?:\/\//i.test(source)) {
    return source;
  }

  if (source.startsWith('/images/')) {
    return `${getApiBaseUrl()}${source}`;
  }

  if (source.startsWith('/')) {
    return `${window.location.origin}${source}`;
  }

  return source;
};

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('No se pudo convertir la imagen a data URL.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Error leyendo la imagen.'));
    reader.readAsDataURL(blob);
  });

const loadImageDimensions = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => reject(new Error('No se pudo cargar la imagen para el PDF.'));
    image.src = dataUrl;
  });

const rasterizeImageDataUrl = (dataUrl: string) =>
  new Promise<{ dataUrl: string; width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');

      if (!context) {
        reject(new Error('No se pudo preparar el canvas para el PDF.'));
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        height,
        width,
      });
    };
    image.onerror = () => reject(new Error('No se pudo rasterizar la imagen para el PDF.'));
    image.src = dataUrl;
  });

const resolvePdfImageAsset = async (source: string) => {
  const response = await fetch(resolvePdfImageUrl(source));

  if (!response.ok) {
    throw new Error(`No se pudo cargar la imagen ${source}.`);
  }

  // Si este flujo de lectura de imagenes se migra a Java, es obligatorio usar
  // try-catch-resources con FileInputStream u otros Streams para liberar los
  // recursos correctamente tras generar el PDF [cite: 2026-02-12].
  const blob = await response.blob();
  const dataUrl = await readBlobAsDataUrl(blob);
  const dimensions = await loadImageDimensions(dataUrl);

  return {
    dataUrl,
    ...dimensions,
  };
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const resolvePdfFontUrl = (fileName: string) => {
  if (typeof window === 'undefined') {
    return `http://localhost:3001/fonts/${fileName}`;
  }

  return `${window.location.origin}/fonts/${fileName}`;
};

const loadPdfFontBase64 = async (fileName: string) => {
  const response = await fetch(resolvePdfFontUrl(fileName));

  if (!response.ok) {
    throw new Error(`No se pudo cargar la fuente ${fileName}.`);
  }

  const buffer = await response.arrayBuffer();
  return arrayBufferToBase64(buffer);
};

export const App = () => {
  const initialManualSnapshotRef = useRef<StoredManualSnapshot>(
    getFallbackManualSnapshot(),
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [isQuickAccessCollapsed, setIsQuickAccessCollapsed] = useState(true);
  const [isFavoriteTemplatesCollapsed, setIsFavoriteTemplatesCollapsed] =
    useState(true);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [showAllQuickAccessEntries, setShowAllQuickAccessEntries] = useState(false);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState('');
  const [showFavoriteTemplatesOnly, setShowFavoriteTemplatesOnly] = useState(false);
  const [collapsedHomeCategories, setCollapsedHomeCategories] = useState<string[]>(
    () =>
      initialManualSnapshotRef.current.manualData.categories.map(
        (category) => category.name,
      ),
  );
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('');
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [resultSortMode, setResultSortMode] =
    useState<ResultSortMode>('pinned-latest');
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [draggedResultEntryId, setDraggedResultEntryId] = useState('');
  const [dragOverResultEntryId, setDragOverResultEntryId] = useState('');
  const [draggedHomeCategoryName, setDraggedHomeCategoryName] = useState('');
  const [dragOverHomeCategoryName, setDragOverHomeCategoryName] = useState('');
  const [draggedTemplateId, setDraggedTemplateId] = useState('');
  const [dragOverTemplateId, setDragOverTemplateId] = useState('');
  const [activeView, setActiveView] = useState<'home' | 'settings' | 'templates'>('home');
  const [manualData, setManualData] = useState<ManualData>(
    () => initialManualSnapshotRef.current.manualData,
  );
  const [modalState, setModalState] = useState<ModalState>(null);
  const [entryEditorViewMode, setEntryEditorViewMode] =
    useState<EntryEditorViewMode>('editor');
  const [entryForm, setEntryForm] = useState<EntryFormState>(() =>
    buildEntryFormState(),
  );
  const [debouncedEntryPreview, setDebouncedEntryPreview] =
    useState<EntryFormState>(entryForm);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(
    null,
  );
  const [templateForm, setTemplateForm] = useState<TemplateFormState | null>(
    null,
  );
  const [showEntryAdvancedOptions, setShowEntryAdvancedOptions] = useState(false);
  const [isEntryContextCollapsed, setIsEntryContextCollapsed] = useState(false);
  const [isEntryEditorFocused, setIsEntryEditorFocused] = useState(false);
  const [showTemplateTechnicalOptions, setShowTemplateTechnicalOptions] =
    useState(false);
  const [backupImportState, setBackupImportState] =
    useState<BackupImportState | null>(null);
  const [entryPdfExportState, setEntryPdfExportState] =
    useState<EntryPdfExportState | null>(null);
  const [sectionPdfExportState, setSectionPdfExportState] =
    useState<SectionPdfExportState | null>(null);
  const [formError, setFormError] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activeToolbarActionId, setActiveToolbarActionId] = useState('');
  const [activeBlockMenu, setActiveBlockMenu] =
    useState<'' | 'entry' | 'template'>('');
  const [contentEditorSelection, setContentEditorSelection] =
    useState<EditorSelectionState>({
      hasSelection: false,
      selectedCharacters: 0,
      selectedLines: 1,
    });
  const [templateEditorSelection, setTemplateEditorSelection] =
    useState<EditorSelectionState>({
      hasSelection: false,
      selectedCharacters: 0,
      selectedLines: 1,
    });
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const contentEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const templateContentEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const topContentRef = useRef<HTMLElement | null>(null);
  const resultsSectionRef = useRef<HTMLDivElement | null>(null);
  const templatesSectionRef = useRef<HTMLDivElement | null>(null);
  const homeCategoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const templateEditorPaneRef = useRef<HTMLDivElement | null>(null);
  const entryEditorFormPaneRef = useRef<HTMLDivElement | null>(null);
  const entryEditorPreviewPaneRef = useRef<HTMLDivElement | null>(null);
  const [deleteConfirmationEntryId, setDeleteConfirmationEntryId] = useState('');
  const [deleteConfirmationCategory, setDeleteConfirmationCategory] =
    useState<CategoryDeleteConfirmationState | null>(null);
  const [exportEntryId, setExportEntryId] = useState('');
  const [exportSectionCategoryName, setExportSectionCategoryName] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [saveToast, setSaveToast] = useState<SaveToastState | null>(null);
  const [saveSyncState, setSaveSyncState] = useState<SaveSyncState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [hasSaveConflict, setHasSaveConflict] = useState(false);
  const [manualOriginState, setManualOriginState] = useState<ManualOriginState>(
    initialManualSnapshotRef.current.source,
  );
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);
  const [serverHealthState, setServerHealthState] =
    useState<ServerHealthState>('checking');

  const manualServerRevisionRef = useRef('');
  const shouldPersistToServerRef = useRef(false);
  const hasMountedRef = useRef(false);
  const customization = manualData.settings.customization;
  const isCompactViewEnabled = manualData.settings.compactMode;
  const quickViews = manualData.settings.quickViews;
  const deferredEntryPreview = useDeferredValue(debouncedEntryPreview);

  const scrollViewportToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'auto',
    });
  };

  const isEditableElementFocused = () => {
    const activeElement = document.activeElement as HTMLElement | null;

    if (!activeElement) {
      return false;
    }

    const tagName = activeElement.tagName.toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      activeElement.isContentEditable
    );
  };

  const focusResultsSection = () => {
    window.requestAnimationFrame(() => {
      if (isEditableElementFocused()) {
        return;
      }

      resultsSectionRef.current?.scrollIntoView({
        behavior: 'auto',
        block: 'start',
      });
      resultsSectionRef.current?.focus({ preventScroll: true });
    });
  };

  const focusTemplatesSection = () => {
    window.requestAnimationFrame(() => {
      if (isEditableElementFocused()) {
        return;
      }

      templatesSectionRef.current?.scrollIntoView({
        behavior: 'auto',
        block: 'start',
      });
      templatesSectionRef.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    document.title = 'Prysma | Ecosistema de Conocimiento';

    const faviconHref =
      customization.appIconDataUrl.trim() || defaultPrysmaIconDataUrl;
    let faviconElement = document.querySelector<HTMLLinkElement>("link[rel='icon']");

    if (!faviconElement) {
      faviconElement = document.createElement('link');
      faviconElement.rel = 'icon';
      document.head.appendChild(faviconElement);
    }

    faviconElement.href = faviconHref;
  }, [customization.appIconDataUrl]);

  const categoryMap = useMemo(
    () =>
      new Map(
        manualData.categories.map((category) => [
          category.name.toLowerCase(),
          category,
        ]),
      ),
    [manualData.categories],
  );
  const customEntryOrderByCategory = manualData.settings.customEntryOrderByCategory;
  const results = useSearch(
    manualData.entries,
    debouncedSearchTerm,
    activeCategoryFilter,
    activeTagFilters,
  );
  const compareEntriesBySortMode = (
    firstEntry: KnowledgeEntry,
    secondEntry: KnowledgeEntry,
    sortMode: Exclude<ResultSortMode, 'custom'>,
  ) => {
      if (sortMode === 'title') {
        return firstEntry.titulo.localeCompare(secondEntry.titulo, 'es');
      }

      const dateDifference =
        new Date(secondEntry.updatedAt ?? 0).getTime() -
        new Date(firstEntry.updatedAt ?? 0).getTime();

      if (sortMode === 'latest') {
        return dateDifference;
      }

      if (sortMode === 'oldest') {
        return -dateDifference;
      }

      if (firstEntry.isPinned !== secondEntry.isPinned) {
        return firstEntry.isPinned ? -1 : 1;
      }

      return dateDifference;
    };
  const sortEntries = (entries: KnowledgeEntry[], sortMode: ResultSortMode) => {
    if (sortMode === 'custom') {
      const entriesByCategory = new Map<string, KnowledgeEntry[]>();

      entries.forEach((entry) => {
        const normalizedCategoryName = entry.categoria.toLowerCase();
        const currentEntries = entriesByCategory.get(normalizedCategoryName) ?? [];
        currentEntries.push(entry);
        entriesByCategory.set(normalizedCategoryName, currentEntries);
      });

      return Array.from(entriesByCategory.entries())
        .sort(([firstCategoryName], [secondCategoryName]) =>
          firstCategoryName.localeCompare(secondCategoryName, 'es'),
        )
        .flatMap(([categoryName, categoryEntries]) => {
          const categoryOrder = customEntryOrderByCategory[categoryName] ?? [];
          const orderIndexMap = new Map(
            categoryOrder.map((entryId, index) => [entryId, index] as const),
          );

          return [...categoryEntries].sort((firstEntry, secondEntry) => {
            const firstIndex = orderIndexMap.get(firstEntry.id);
            const secondIndex = orderIndexMap.get(secondEntry.id);

            if (firstIndex !== undefined && secondIndex !== undefined) {
              return firstIndex - secondIndex;
            }

            if (firstIndex !== undefined) {
              return -1;
            }

            if (secondIndex !== undefined) {
              return 1;
            }

            return compareEntriesBySortMode(
              firstEntry,
              secondEntry,
              'pinned-latest',
            );
          });
        });
    }

    return [...entries].sort((firstEntry, secondEntry) =>
      compareEntriesBySortMode(firstEntry, secondEntry, sortMode),
    );
  };
  const visibleResults = useMemo(
    () => (showPinnedOnly ? results.filter((entry) => entry.isPinned) : results),
    [results, showPinnedOnly],
  );
  const sortedResults = useMemo(
    () => sortEntries(visibleResults, resultSortMode),
    [customEntryOrderByCategory, resultSortMode, visibleResults],
  );
  const quickAccessEntries = useMemo(
    () =>
      sortEntries(
        manualData.entries.filter((entry) => entry.isPinned),
        'pinned-latest',
      ),
    [customEntryOrderByCategory, manualData.entries],
  );
  const visibleQuickAccessEntries = useMemo(
    () =>
      showAllQuickAccessEntries
        ? quickAccessEntries
        : quickAccessEntries.slice(0, HOME_PINNED_ENTRY_PREVIEW_LIMIT),
    [quickAccessEntries, showAllQuickAccessEntries],
  );
  const sortedTemplates = useMemo(() => manualData.templates, [manualData.templates]);
  const favoriteTemplates = useMemo(
    () => sortedTemplates.filter((template) => template.isFavorite),
    [sortedTemplates],
  );
  const filteredTemplates = useMemo(() => {
    const normalizedTemplateSearchTerm = normalizeComparableText(templateSearchTerm);

    return sortedTemplates.filter((template) => {
      if (
        templateCategoryFilter &&
        template.categoria?.toLowerCase() !== templateCategoryFilter.toLowerCase()
      ) {
        return false;
      }

      if (showFavoriteTemplatesOnly && !template.isFavorite) {
        return false;
      }

      if (!normalizedTemplateSearchTerm) {
        return true;
      }

      const searchableFields = [
        template.name,
        template.titulo,
        template.categoria ?? '',
        template.contenido,
        template.tags.join(' '),
        (template.pasos ?? []).join(' '),
        (template.comandos ?? [])
          .map((command) => `${command.label} ${command.value}`)
          .join(' '),
      ];

      return searchableFields.some((field) =>
        normalizeComparableText(field).includes(normalizedTemplateSearchTerm),
      );
    });
  }, [
    showFavoriteTemplatesOnly,
    sortedTemplates,
    templateCategoryFilter,
    templateSearchTerm,
  ]);
  const sectionPdfEntries = useMemo(
    () =>
      sectionPdfExportState
        ? sortEntries(
            manualData.entries.filter(
              (entry) =>
                entry.categoria.toLowerCase() ===
                sectionPdfExportState.categoryName.toLowerCase(),
            ),
            'custom',
          )
        : [],
    [manualData.entries, sectionPdfExportState, customEntryOrderByCategory],
  );
  const restorableTrashCategories = useMemo<TrashCategorySummary[]>(() => {
    const trashCategoryMap = new Map<string, TrashCategorySummary>();

    manualData.trash.forEach((entry) => {
      const trimmedName = entry.categoria.trim();
      const key = trimmedName.toLowerCase();
      const currentSummary = trashCategoryMap.get(key);

      if (currentSummary) {
        currentSummary.entryCount += 1;
        return;
      }

      trashCategoryMap.set(key, {
        entryCount: 1,
        name: trimmedName,
      });
    });

    return Array.from(trashCategoryMap.values()).sort((firstCategory, secondCategory) =>
      firstCategory.name.localeCompare(secondCategory.name, 'es'),
    );
  }, [manualData.trash]);
  const backupImportSummary = useMemo(
    () =>
      backupImportState
        ? buildBackupImportSummary(manualData, backupImportState.importedManualData)
        : null,
    [backupImportState, manualData],
  );
  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    activeCategoryFilter.trim().length > 0 ||
    activeTagFilters.length > 0 ||
    showPinnedOnly ||
    resultSortMode !== 'pinned-latest';
  const activeResultCategory = activeCategoryFilter
    ? categoryMap.get(activeCategoryFilter.toLowerCase())
    : undefined;
  const activeResultThemeVars = buildThemeVars(activeResultCategory?.color ?? 'blue');
  const deleteConfirmationEntry = deleteConfirmationEntryId
    ? manualData.entries.find((entry) => entry.id === deleteConfirmationEntryId)
    : undefined;

  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      manualData.settings.darkMode,
    );
  }, [manualData.settings.darkMode]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (modalState?.type === 'entry') {
      window.requestAnimationFrame(() => {
        entryEditorFormPaneRef.current?.scrollTo({
          top: 0,
          behavior: 'auto',
        });
        entryEditorPreviewPaneRef.current?.scrollTo({
          top: 0,
          behavior: 'auto',
        });
      });
      return;
    }

    if (modalState?.type === 'template') {
      window.requestAnimationFrame(() => {
        templateEditorPaneRef.current?.scrollTo({
          top: 0,
          behavior: 'auto',
        });
      });
      return;
    }

    if (modalState) {
      scrollViewportToTop();
      return;
    }

    if (activeView === 'settings') {
      scrollViewportToTop();
      return;
    }

    if (activeView === 'templates') {
      focusTemplatesSection();
      return;
    }

    if (hasActiveFilters) {
      focusResultsSection();
      return;
    }

    scrollViewportToTop();
  }, [
    activeView,
    hasActiveFilters,
    modalState,
    debouncedSearchTerm,
    activeCategoryFilter,
    activeTagFilters,
    showPinnedOnly,
    resultSortMode,
  ]);

  useEffect(() => {
    setDraggedResultEntryId('');
    setDragOverResultEntryId('');
  }, [activeCategoryFilter, activeTagFilters, debouncedSearchTerm, resultSortMode]);

  useEffect(() => {
    setDraggedHomeCategoryName('');
    setDragOverHomeCategoryName('');
  }, [activeView, manualData.categories.length]);

  useEffect(() => {
    setDraggedTemplateId('');
    setDragOverTemplateId('');
  }, [
    activeView,
    templateSearchTerm,
    templateCategoryFilter,
    showFavoriteTemplatesOnly,
    manualData.templates.length,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (modalState?.type === 'entry') {
      setEntryEditorViewMode('editor');
      setIsEntryContextCollapsed(false);
      setIsEntryEditorFocused(false);
    }
  }, [modalState]);

  useEffect(() => {
    if (modalState?.type !== 'entry') {
      setDebouncedEntryPreview(entryForm);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedEntryPreview(entryForm);
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [entryForm, modalState]);

  useEffect(() => {
    if (!saveToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSaveToast(null);
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [saveToast]);

  useEffect(() => {
    if (quickAccessEntries.length <= HOME_PINNED_ENTRY_PREVIEW_LIMIT && showAllQuickAccessEntries) {
      setShowAllQuickAccessEntries(false);
    }
  }, [quickAccessEntries.length, showAllQuickAccessEntries]);

  useEffect(() => {
    const handleClipboardCopy = (
      event: Event,
    ) => {
      const customEvent = event as CustomEvent<ClipboardCopyEventDetail>;

      setSaveToast({
        message: customEvent.detail?.message || 'Texto copiado.',
        tone: 'success',
      });
    };

    window.addEventListener(clipboardCopyEventName, handleClipboardCopy);

    return () => {
      window.removeEventListener(clipboardCopyEventName, handleClipboardCopy);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const checkServerHealth = async () => {
      try {
        const response = await fetch(`${getApiBaseUrl()}/health`);

        if (!response.ok) {
          throw new Error('Servidor no disponible');
        }

        if (!isCancelled) {
          setServerHealthState('online');
        }
      } catch {
        if (!isCancelled) {
          setServerHealthState('offline');
        }
      }
    };

    void checkServerHealth();

    const intervalId = window.setInterval(() => {
      void checkServerHealth();
    }, 20000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadManualFromServer = async () => {
      try {
        const response = await fetch(`${getApiBaseUrl()}/manual`);

        if (!response.ok) {
          throw new Error('No se pudo cargar el manual inicial.');
        }

        const payload = (await response.json()) as
          | { data?: unknown; revision?: string }
          | ManualData;
        const serverManual = normalizeManualData(
          payload && typeof payload === 'object' && 'data' in payload
            ? payload.data
            : payload,
        );
        const revision =
          payload && typeof payload === 'object' && 'revision' in payload
            ? payload.revision
            : '';

        if (!isCancelled) {
          persistManualData(serverManual);
          setManualData(serverManual);
          manualServerRevisionRef.current = typeof revision === 'string' ? revision : '';
          setHasSaveConflict(false);
          setManualOriginState('server');
          setUndoStack([]);
          setRedoStack([]);
          setServerHealthState('online');
          setSaveSyncState('saved');
          setLastSavedAt(formatSavedAtTime());
        }
      } catch {
        if (!isCancelled) {
          setServerHealthState('offline');
        }
      }
    };

    void loadManualFromServer();

    return () => {
      isCancelled = true;
    };
  }, []);

  const reloadManualFromServer = async () => {
    const hasUnsyncedChanges =
      hasSaveConflict || saveSyncState === 'error' || saveSyncState === 'pending';

    if (hasUnsyncedChanges) {
      const confirmed = window.confirm(
        'Hay cambios locales pendientes o en conflicto. Si recargas desde disco, se sustituira el estado actual por el del servidor. ¿Quieres continuar?',
      );

      if (!confirmed) {
        return;
      }
    }

    try {
      const response = await fetch(`${getApiBaseUrl()}/manual`);

      if (!response.ok) {
        throw new Error('No se pudo recargar el manual desde disco.');
      }

      const payload = (await response.json()) as
        | { data?: unknown; revision?: string }
        | ManualData;
      const serverManual = normalizeManualData(
        payload && typeof payload === 'object' && 'data' in payload
          ? payload.data
          : payload,
      );
      const revision =
        payload && typeof payload === 'object' && 'revision' in payload
          ? payload.revision
          : '';

      persistManualData(serverManual);
      setManualData(serverManual);
      manualServerRevisionRef.current = typeof revision === 'string' ? revision : '';
      setHasSaveConflict(false);
      setManualOriginState('server');
      setUndoStack([]);
      setRedoStack([]);
      setServerHealthState('online');
      setSaveSyncState('saved');
      setLastSavedAt(formatSavedAtTime());
      setSaveToast({
        message: 'Estado recargado desde disco correctamente.',
        tone: 'success',
      });
    } catch {
      setServerHealthState('offline');
      setSaveToast({
        message: 'No se pudo recargar el estado desde el servidor.',
        tone: 'error',
      });
    }
  };

  useEffect(() => {
    if (!shouldPersistToServerRef.current) {
      return;
    }

    shouldPersistToServerRef.current = false;

    let isCancelled = false;
    const timeoutId = window.setTimeout(() => {

    const persistManualOnServer = async () => {
      setSaveSyncState('saving');
      try {
        const response = await fetch(`${getApiBaseUrl()}/save-manual`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: manualData,
            expectedRevision: manualServerRevisionRef.current || undefined,
          }),
        });

        const payload = (await response
          .json()
          .catch(() => ({}))) as {
          currentRevision?: string;
          error?: string;
          revision?: string;
        };

        if (response.status === 409 || payload.error === 'save-conflict') {
          throw new Error('save-conflict');
        }

        if (!response.ok) {
          throw new Error('La respuesta del servidor no fue valida.');
        }

        if (!isCancelled) {
          manualServerRevisionRef.current =
            typeof payload.revision === 'string' ? payload.revision : '';
          setHasSaveConflict(false);
          setServerHealthState('online');
          setManualOriginState('server');
          setSaveSyncState('saved');
          setLastSavedAt(formatSavedAtTime());
          setSaveToast({
            message: 'Cambios guardados y sincronizados con disco.',
            tone: 'success',
          });
        }
      } catch (error) {
        if (!isCancelled) {
          const isSaveConflict =
            error instanceof Error && error.message === 'save-conflict';
          const isNetworkError =
            error instanceof TypeError ||
            (error instanceof Error && error.message === 'Failed to fetch');

          setServerHealthState(isSaveConflict ? 'online' : isNetworkError ? 'offline' : 'online');
          setHasSaveConflict(isSaveConflict);
          setSaveSyncState('error');
          setSaveToast({
            message: isSaveConflict
              ? 'Otra instancia ha guardado cambios antes que esta. Recarga desde disco o importa antes de volver a guardar.'
              : isNetworkError
                ? 'No se pudo sincronizar con el servidor. Si necesitas asegurar los cambios, exporta el JSON antes de cerrar.'
                : 'El servidor sigue activo, pero no ha podido guardar en disco. Revisa los logs o vuelve a intentarlo.',
            tone: 'error',
          });
        }
      }
    };

    void persistManualOnServer();
    }, 800);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [manualData]);

  const openCreateEntryModal = (
    prefilledCategory?: string,
    categoryLocked = false,
  ) => {
    const fallbackCategory = manualData.categories[0]?.name ?? '';
    const nextCategory = prefilledCategory ?? fallbackCategory;
    const categoryDefinition = nextCategory
      ? categoryMap.get(nextCategory.toLowerCase())
      : undefined;

    setEntryForm(
      buildEntryFormState(undefined, categoryDefinition, categoryLocked),
    );
    setEntryForm((current) => ({
      ...current,
      categoryLocked,
      categoria: nextCategory || current.categoria,
    }));
    setShowEntryAdvancedOptions(false);
    setSelectedTemplateId('');
    setFormError('');
    setModalState({
      lockedCategory: categoryLocked ? prefilledCategory : undefined,
      mode: 'create',
      type: 'entry',
    });
  };

  const openEditEntryModal = (entry: KnowledgeEntry) => {
    const categoryDefinition = categoryMap.get(entry.categoria.toLowerCase());
    setEntryForm(buildEntryFormState(entry, categoryDefinition, false));
    setShowEntryAdvancedOptions(false);
    setSelectedTemplateId('');
    setFormError('');
    setModalState({ entryId: entry.id, mode: 'edit', type: 'entry' });
  };

  const openCreateCategoryModal = () => {
    setCategoryForm(buildCategoryFormState());
    setFormError('');
    setModalState({ mode: 'create', type: 'category' });
  };

  const openCreateTemplateModal = () => {
    setTemplateForm(buildTemplateFormState(undefined, manualData.categories[0]?.name ?? ''));
    setShowTemplateTechnicalOptions(false);
    setFormError('');
    setModalState({ mode: 'create', type: 'template' });
  };

  const openEditTemplateModal = (template: EntryTemplate) => {
    setTemplateForm(buildTemplateFormState(template));
    setShowTemplateTechnicalOptions(false);
    setFormError('');
    setModalState({ mode: 'edit', templateId: template.id, type: 'template' });
  };

  const openDuplicateTemplateModal = (template: EntryTemplate) => {
    setTemplateForm(buildDuplicatedTemplateFormState(template));
    setShowTemplateTechnicalOptions(false);
    setFormError('');
    setModalState({ mode: 'create', type: 'template' });
  };

  const openCategoryModal = (categoryName: string) => {
    const category = categoryMap.get(categoryName.toLowerCase());
    if (!category) {
      return;
    }

    setCategoryForm(buildCategoryFormState(category));
    setFormError('');
    setModalState({ categoryName, mode: 'edit', type: 'category' });
  };

  const closeModal = () => {
    setModalState(null);
    setCategoryForm(null);
    setTemplateForm(null);
    setShowEntryAdvancedOptions(false);
    setShowTemplateTechnicalOptions(false);
    setSelectedTemplateId('');
    setFormError('');
  };

  const updateManualData = (
    updater: (currentManualData: ManualData) => ManualData,
  ) => {
    setManualData((currentManualData) => {
      const nextManualData = normalizeManualData(updater(currentManualData));
      const manualChanged = !areManualDataEqual(currentManualData, nextManualData);
      shouldPersistToServerRef.current = manualChanged;
      if (manualChanged) {
        setUndoStack((currentUndoStack) => [
          ...currentUndoStack.slice(-(MAX_UNDO_HISTORY - 1)),
          {
            manualData: currentManualData,
          },
        ]);
        setRedoStack([]);
        setSaveSyncState('pending');
      }
      persistManualData(nextManualData);
      return nextManualData;
    });
  };

  const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= items.length ||
      toIndex >= items.length ||
      fromIndex === toIndex
    ) {
      return items;
    }

    const nextItems = [...items];
    const [movedItem] = nextItems.splice(fromIndex, 1);
    nextItems.splice(toIndex, 0, movedItem);
    return nextItems;
  };

  const persistCustomCategoryOrder = (
    categoryName: string,
    reorderedVisibleEntryIds: string[],
  ) => {
    const normalizedCategoryName = categoryName.trim().toLowerCase();

    if (!normalizedCategoryName || reorderedVisibleEntryIds.length < 2) {
      return;
    }

    updateManualData((currentManualData) => {
      const categoryEntries = currentManualData.entries.filter(
        (entry) => entry.categoria.toLowerCase() === normalizedCategoryName,
      );
      const categoryEntryIds = categoryEntries.map((entry) => entry.id);
      const currentStoredOrder =
        currentManualData.settings.customEntryOrderByCategory[normalizedCategoryName] ?? [];
      const fullCategoryOrder = [
        ...currentStoredOrder.filter((entryId) => categoryEntryIds.includes(entryId)),
        ...categoryEntryIds.filter((entryId) => !currentStoredOrder.includes(entryId)),
      ];
      const reorderedVisibleSet = new Set(reorderedVisibleEntryIds);
      const nextFullCategoryOrder: string[] = [];
      let reorderedIndex = 0;

      fullCategoryOrder.forEach((entryId) => {
        if (reorderedVisibleSet.has(entryId)) {
          nextFullCategoryOrder.push(reorderedVisibleEntryIds[reorderedIndex] ?? entryId);
          reorderedIndex += 1;
          return;
        }

        nextFullCategoryOrder.push(entryId);
      });

      const normalizedNextOrder = Array.from(
        new Set(nextFullCategoryOrder.filter((entryId) => categoryEntryIds.includes(entryId))),
      );

      return {
        ...currentManualData,
        settings: {
          ...currentManualData.settings,
          customEntryOrderByCategory: {
            ...currentManualData.settings.customEntryOrderByCategory,
            [normalizedCategoryName]: normalizedNextOrder,
          },
        },
      };
    });
  };

  const persistHomeCategoryOrder = (reorderedCategoryNames: string[]) => {
    if (reorderedCategoryNames.length < 2) {
      return;
    }

    updateManualData((currentManualData) => {
      const categoryIndexMap = new Map(
        currentManualData.categories.map((category) => [
          category.name.toLowerCase(),
          category,
        ]),
      );
      const normalizedIncomingOrder = reorderedCategoryNames.map((categoryName) =>
        categoryName.toLowerCase(),
      );
      const nextCategories = [
        ...normalizedIncomingOrder
          .map((categoryName) => categoryIndexMap.get(categoryName))
          .filter((category): category is CategoryDefinition => Boolean(category)),
        ...currentManualData.categories.filter(
          (category) =>
            !normalizedIncomingOrder.includes(category.name.toLowerCase()),
        ),
      ];

      return {
        ...currentManualData,
        categories: nextCategories,
      };
    });
  };

  const handleCustomResultDrop = (targetEntryId: string) => {
    if (
      !activeCategoryFilter ||
      !draggedResultEntryId ||
      draggedResultEntryId === targetEntryId
    ) {
      setDraggedResultEntryId('');
      setDragOverResultEntryId('');
      return;
    }

    const visibleCategoryEntryIds = sortedResults
      .filter(
        (entry) => entry.categoria.toLowerCase() === activeCategoryFilter.toLowerCase(),
      )
      .map((entry) => entry.id);
    const sourceIndex = visibleCategoryEntryIds.indexOf(draggedResultEntryId);
    const targetIndex = visibleCategoryEntryIds.indexOf(targetEntryId);

    if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
      persistCustomCategoryOrder(
        activeCategoryFilter,
        moveItem(visibleCategoryEntryIds, sourceIndex, targetIndex),
      );
      setResultSortMode('custom');
    }

    setDraggedResultEntryId('');
    setDragOverResultEntryId('');
  };

  const handleHomeCategoryDrop = (targetCategoryName: string) => {
    if (
      !draggedHomeCategoryName ||
      draggedHomeCategoryName === targetCategoryName
    ) {
      setDraggedHomeCategoryName('');
      setDragOverHomeCategoryName('');
      return;
    }

    const visibleCategoryNames = manualData.categories.map((category) => category.name);
    const sourceIndex = visibleCategoryNames.indexOf(draggedHomeCategoryName);
    const targetIndex = visibleCategoryNames.indexOf(targetCategoryName);

    if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
      persistHomeCategoryOrder(
        moveItem(visibleCategoryNames, sourceIndex, targetIndex),
      );
    }

    setDraggedHomeCategoryName('');
    setDragOverHomeCategoryName('');
  };

  const persistTemplateOrder = (reorderedVisibleTemplateIds: string[]) => {
    if (reorderedVisibleTemplateIds.length < 2) {
      return;
    }

    updateManualData((currentManualData) => {
      const allTemplateIds = currentManualData.templates.map((template) => template.id);
      const reorderedVisibleSet = new Set(reorderedVisibleTemplateIds);
      const nextTemplateIds: string[] = [];
      let reorderedIndex = 0;

      allTemplateIds.forEach((templateId) => {
        if (reorderedVisibleSet.has(templateId)) {
          nextTemplateIds.push(reorderedVisibleTemplateIds[reorderedIndex] ?? templateId);
          reorderedIndex += 1;
          return;
        }

        nextTemplateIds.push(templateId);
      });

      const templateById = new Map(
        currentManualData.templates.map((template) => [template.id, template] as const),
      );

      return {
        ...currentManualData,
        templates: nextTemplateIds
          .map((templateId) => templateById.get(templateId))
          .filter((template): template is EntryTemplate => Boolean(template)),
      };
    });
  };

  const handleTemplateDrop = (targetTemplateId: string) => {
    if (!draggedTemplateId || draggedTemplateId === targetTemplateId) {
      setDraggedTemplateId('');
      setDragOverTemplateId('');
      return;
    }

    const visibleTemplateIds = filteredTemplates.map((template) => template.id);
    const sourceIndex = visibleTemplateIds.indexOf(draggedTemplateId);
    const targetIndex = visibleTemplateIds.indexOf(targetTemplateId);

    if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
      persistTemplateOrder(moveItem(visibleTemplateIds, sourceIndex, targetIndex));
    }

    setDraggedTemplateId('');
    setDragOverTemplateId('');
  };

  const handleUndoRecentChange = () => {
    const previousSnapshot = undoStack.at(-1);

    if (!previousSnapshot) {
      return;
    }

    setUndoStack((currentUndoStack) => currentUndoStack.slice(0, -1));
    setRedoStack((currentRedoStack) => [
      ...currentRedoStack.slice(-(MAX_UNDO_HISTORY - 1)),
      {
        manualData,
      },
    ]);
    persistManualData(previousSnapshot.manualData);
    shouldPersistToServerRef.current = true;
    setSaveSyncState('pending');
    setManualData(previousSnapshot.manualData);
    setActiveView('home');
    setSaveToast({
      message: 'Se ha deshecho el ultimo cambio.',
      tone: 'success',
    });
  };

  const handleRedoRecentChange = () => {
    const nextSnapshot = redoStack.at(-1);

    if (!nextSnapshot) {
      return;
    }

    setRedoStack((currentRedoStack) => currentRedoStack.slice(0, -1));
    setUndoStack((currentUndoStack) => [
      ...currentUndoStack.slice(-(MAX_UNDO_HISTORY - 1)),
      {
        manualData,
      },
    ]);
    persistManualData(nextSnapshot.manualData);
    shouldPersistToServerRef.current = true;
    setSaveSyncState('pending');
    setManualData(nextSnapshot.manualData);
    setActiveView('home');
    setSaveToast({
      message: 'Se ha rehecho el ultimo cambio deshecho.',
      tone: 'success',
    });
  };

  const toggleDarkMode = () => {
    updateManualData((currentManualData) => ({
      ...currentManualData,
      settings: {
        ...currentManualData.settings,
        darkMode: !currentManualData.settings.darkMode,
      },
    }));
  };

  const toggleCompactMode = () => {
    updateManualData((currentManualData) => ({
      ...currentManualData,
      settings: {
        ...currentManualData.settings,
        compactMode: !currentManualData.settings.compactMode,
      },
    }));
  };

  const handleCommandSave = (
    entryId: string,
    commandLabel: string,
    nextValue: string,
  ) => {
    updateManualData((currentManualData) => ({
      ...currentManualData,
      entries: currentManualData.entries.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }

        return {
          ...entry,
          comandos: entry.comandos?.map((command) =>
            command.label === commandLabel
              ? { ...command, value: nextValue }
              : command,
          ),
          updatedAt: getCurrentIsoDate(),
        };
      }),
    }));
  };

  const handleTogglePinEntry = (entryId: string) => {
    updateManualData((currentManualData) => ({
      ...currentManualData,
      entries: currentManualData.entries.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              isPinned: !entry.isPinned,
              updatedAt: getCurrentIsoDate(),
            }
          : entry,
      ),
    }));
  };

  const exportEntriesToPdf = async (
    entries: KnowledgeEntry[],
    fileName: string,
    options: {
      documentSubtitle?: string;
      documentTitle?: string;
      includeBrandingFooter?: boolean;
    } = {},
  ) => {
    if (!entries.length) {
      return;
    }

    setExportEntryId(entries.length === 1 ? entries[0].id : `section:${fileName}`);

    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ format: 'a4', orientation: 'portrait', unit: 'mm' });
      let useEmbeddedPdfFonts = false;

      try {
        const [regularFont, boldFont, italicFont, boldItalicFont] = await Promise.all([
          loadPdfFontBase64('prysma-pdf-regular.ttf'),
          loadPdfFontBase64('prysma-pdf-bold.ttf'),
          loadPdfFontBase64('prysma-pdf-italic.ttf'),
          loadPdfFontBase64('prysma-pdf-bolditalic.ttf'),
        ]);

        pdf.addFileToVFS('prysma-pdf-regular.ttf', regularFont);
        pdf.addFont('prysma-pdf-regular.ttf', 'PrysmaPdf', 'normal');
        pdf.addFileToVFS('prysma-pdf-bold.ttf', boldFont);
        pdf.addFont('prysma-pdf-bold.ttf', 'PrysmaPdf', 'bold');
        pdf.addFileToVFS('prysma-pdf-italic.ttf', italicFont);
        pdf.addFont('prysma-pdf-italic.ttf', 'PrysmaPdf', 'italic');
        pdf.addFileToVFS('prysma-pdf-bolditalic.ttf', boldItalicFont);
        pdf.addFont('prysma-pdf-bolditalic.ttf', 'PrysmaPdf', 'bolditalic');
        useEmbeddedPdfFonts = true;
      } catch (fontError) {
        console.warn('No se pudieron cargar las fuentes Unicode del PDF.', fontError);
      }

      const getPdfTextFont = () => (useEmbeddedPdfFonts ? 'PrysmaPdf' : 'helvetica');
      const getPdfCodeFont = () => (useEmbeddedPdfFonts ? 'PrysmaPdf' : 'courier');
      const getPdfFontStyle = (
        style: 'bold' | 'normal' | 'italic' | 'bolditalic' = 'normal',
      ) => {
        if (!useEmbeddedPdfFonts && style === 'bolditalic') {
          return 'bold';
        }

        return style;
      };
      const margin = 15;
      const pageWidth = 210;
      const pageHeight = 297;
      const contentWidth = pageWidth - margin * 2;
      const footerHeight = 14;
      const contentBottomLimit = pageHeight - margin - footerHeight;
      const includeBrandingFooter = options.includeBrandingFooter !== false;
      let cursorY = margin;
      const footerIconSource =
        customization.appIconDataUrl.trim() || defaultPrysmaIconDataUrl;
      const footerIconAsset = includeBrandingFooter
        ? await (async () => {
            try {
              if (footerIconSource.startsWith('data:')) {
                return await rasterizeImageDataUrl(footerIconSource);
              }

              return await resolvePdfImageAsset(footerIconSource);
            } catch {
              return null;
            }
          })()
        : null;

      const ensureSpace = (height: number) => {
        if (cursorY + height <= contentBottomLimit) {
          return;
        }

        pdf.addPage();
        cursorY = margin;
      };

      const writeText = (
        text: string,
        options: {
          color?: [number, number, number];
          fontSize?: number;
          fontStyle?: string;
          lineGap?: number;
          maxWidth?: number;
          x?: number;
        } = {},
      ) => {
        const fontSize = options.fontSize ?? 11;
        const lineGap = options.lineGap ?? 1.6;
        const maxWidth = options.maxWidth ?? contentWidth;
        const x = options.x ?? margin;
        pdf.setFont(
          getPdfTextFont(),
          getPdfFontStyle(
            (options.fontStyle as 'bold' | 'normal' | 'italic' | 'bolditalic') ??
              'normal',
          ),
        );
        pdf.setFontSize(fontSize);
        pdf.setTextColor(...(options.color ?? [30, 41, 59]));
        const lines = pdf.splitTextToSize(text, maxWidth) as string[];
        const lineHeight = (fontSize * 0.3528) * lineGap;
        ensureSpace(lines.length * lineHeight + 2);
        pdf.text(lines, x, cursorY);
        cursorY += lines.length * lineHeight + 2;
      };

      const writeInlineText = (
        text: string,
        options: {
          color?: [number, number, number];
          fontSize?: number;
          fontStyle?: 'bold' | 'bolditalic' | 'italic' | 'normal';
          lineGap?: number;
          maxWidth?: number;
          x?: number;
        } = {},
      ) => {
        const fontSize = options.fontSize ?? 11;
        const lineGap = options.lineGap ?? 1.6;
        const x = options.x ?? margin;
        const maxWidth = options.maxWidth ?? contentWidth;
        const baseColor = options.color ?? [30, 41, 59];
        const baseFontStyle = options.fontStyle ?? 'normal';
        const segments = parsePdfInlineSegments(text);
        const pieces: Array<PdfInlineSegment & { text: string }> = [];

        segments.forEach((segment) => {
          const tokens = segment.text.match(/\S+\s*|\s+/g) ?? [segment.text];

          tokens.forEach((token) => {
            if (token.length) {
              pieces.push({
                ...segment,
                text: token,
              });
            }
          });
        });

        const measurePieceWidth = (piece: PdfInlineSegment) => {
          const pieceFont =
            piece.type === 'code'
              ? getPdfCodeFont()
              : getPdfTextFont();
          const pieceFontStyle =
            piece.type === 'link'
              ? 'normal'
              : piece.type === 'code'
                ? 'normal'
                : piece.fontStyle ?? baseFontStyle;
          pdf.setFont(
            pieceFont,
            getPdfFontStyle(pieceFontStyle),
          );
          pdf.setFontSize(fontSize);
          return pdf.getTextWidth(piece.text);
        };

        const wrappedLines: PdfInlineSegment[][] = [];
        let currentLine: PdfInlineSegment[] = [];
        let currentWidth = 0;

        const pushCurrentLine = () => {
          wrappedLines.push(
            currentLine.length
              ? currentLine
              : [{ fontStyle: 'normal', text: ' ', type: 'text' }],
          );
          currentLine = [];
          currentWidth = 0;
        };

        const appendPiece = (piece: PdfInlineSegment) => {
          const pieceWidth = measurePieceWidth(piece);

          if (!currentLine.length || currentWidth + pieceWidth <= maxWidth) {
            currentLine.push(piece);
            currentWidth += pieceWidth;
            return;
          }

          pushCurrentLine();
          currentLine.push(piece);
          currentWidth = pieceWidth;
        };

        pieces.forEach((piece) => {
          const pieceWidth = measurePieceWidth(piece);

          if (pieceWidth <= maxWidth) {
            appendPiece(piece);
            return;
          }

          let chunk = '';

          for (const character of piece.text) {
            const candidate = `${chunk}${character}`;
            const candidatePiece = { ...piece, text: candidate };

            if (measurePieceWidth(candidatePiece) > maxWidth && chunk) {
              appendPiece({ ...piece, text: chunk });
              chunk = character;
              continue;
            }

            chunk = candidate;
          }

          if (chunk) {
            appendPiece({ ...piece, text: chunk });
          }
        });

        if (currentLine.length) {
          pushCurrentLine();
        }

        const lineHeight = fontSize * 0.3528 * lineGap;
        ensureSpace(wrappedLines.length * lineHeight + 2);

        wrappedLines.forEach((linePieces, lineIndex) => {
          let cursorX = x;
          const lineY = cursorY + lineIndex * lineHeight;

          linePieces.forEach((piece) => {
            const isLink = piece.type === 'link' && piece.href;
            const isCode = piece.type === 'code';
            const pieceColor = isLink
              ? [37, 99, 235] as [number, number, number]
              : isCode
                ? [30, 41, 59] as [number, number, number]
                : baseColor;
            const pieceFont =
              isCode
                ? getPdfCodeFont()
                : getPdfTextFont();
            const pieceFontStyle =
              isLink
                ? 'normal'
                : isCode
                  ? 'normal'
                  : piece.fontStyle ?? baseFontStyle;

            pdf.setFont(
              pieceFont,
              getPdfFontStyle(pieceFontStyle),
            );
            pdf.setFontSize(fontSize);
            pdf.setTextColor(...pieceColor);
            pdf.text(piece.text, cursorX, lineY);

            const pieceWidth = measurePieceWidth(piece);

            if (isLink) {
              pdf.setDrawColor(...pieceColor);
              pdf.setLineWidth(0.2);
              pdf.line(cursorX, lineY + 0.6, cursorX + pieceWidth, lineY + 0.6);
              pdf.link(cursorX, lineY - fontSize * 0.28, pieceWidth, lineHeight, {
                url: piece.href!,
              });
            }

            cursorX += pieceWidth;
          });
        });

        cursorY += wrappedLines.length * lineHeight + 2;
      };

      const writeSectionTitle = (title: string) => {
        ensureSpace(12);
        cursorY += 4;
        pdf.setDrawColor(226, 232, 240);
        pdf.line(margin, cursorY + 5, pageWidth - margin, cursorY + 5);
        writeText(title, {
          color: [15, 23, 42],
          fontSize: 12,
          fontStyle: 'bold',
          lineGap: 1.6,
        });
      };

      const writeMarkdownHeading = (content: string, depth: number) => {
        const headingDepth = Math.min(Math.max(depth, 1), 6);
        const fontSizeByDepth: Record<number, number> = {
          1: 15,
          2: 13,
          3: 11.5,
          4: 10.5,
          5: 10,
          6: 10,
        };
        const marginTopByDepth: Record<number, number> = {
          1: 4,
          2: 3.5,
          3: 3,
          4: 2.5,
          5: 2,
          6: 2,
        };

        ensureSpace(12);
        cursorY += marginTopByDepth[headingDepth];

        if (headingDepth <= 3) {
          pdf.setDrawColor(226, 232, 240);
          pdf.line(margin, cursorY + 4.5, pageWidth - margin, cursorY + 4.5);
        }

        writeText(content, {
          color: [15, 23, 42],
          fontSize: fontSizeByDepth[headingDepth],
          fontStyle: 'bold',
          lineGap: 1.45,
        });
      };

      const writeImagePlaceholder = (label: string) => {
        const placeholderHeight = 18;
        ensureSpace(placeholderHeight + 4);
        pdf.setDrawColor(203, 213, 225);
        pdf.setFillColor(248, 250, 252);
        pdf.roundedRect(margin, cursorY, contentWidth, placeholderHeight, 2, 2, 'FD');
        pdf.setFont(getPdfTextFont(), getPdfFontStyle('italic'));
        pdf.setFontSize(10);
        pdf.setTextColor(100, 116, 139);
        pdf.text(label, margin + 4, cursorY + 11);
        cursorY += placeholderHeight + 4;
      };

      const writeCodeBlock = (content: string, language?: string) => {
        const blockPaddingX = 4;
        const blockPaddingY = 4;
        const blockWidth = contentWidth;
        const lineGap = 1.45;
        const fontSize = 9;
        const innerWidth = blockWidth - blockPaddingX * 2;
        const defaultCodeColor: [number, number, number] = [15, 23, 42];
        const commentCodeColor: [number, number, number] = [100, 116, 139];
        const importCodeColor: [number, number, number] = [37, 99, 235];
        const keywordCodeColor: [number, number, number] = [79, 70, 229];
        const stringCodeColor: [number, number, number] = [5, 150, 105];
        const annotationCodeColor: [number, number, number] = [225, 29, 72];
        const typeCodeColor: [number, number, number] = [67, 56, 202];
        const findInlineCommentIndex = (line: string) => {
          let quote: '"' | "'" | null = null;
          let escaped = false;

          for (let index = 0; index < line.length - 1; index += 1) {
            const currentChar = line[index];
            const nextChar = line[index + 1];

            if (quote) {
              if (escaped) {
                escaped = false;
                continue;
              }

              if (currentChar === '\\') {
                escaped = true;
                continue;
              }

              if (currentChar === quote) {
                quote = null;
              }

              continue;
            }

            if (currentChar === '"' || currentChar === "'") {
              quote = currentChar;
              continue;
            }

            if (
              (currentChar === '/' && nextChar === '/') ||
              (currentChar === '/' && nextChar === '*')
            ) {
              return index;
            }
          }

          return -1;
        };
        const measureSegmentWidth = (segment: PdfCodeSegment) => {
          pdf.setFont(getPdfCodeFont(), getPdfFontStyle(segment.fontStyle));
          pdf.setFontSize(fontSize);
          return pdf.getTextWidth(segment.text);
        };
        const wrapStyledLine = (segments: PdfCodeSegment[]) => {
          const wrappedLines: PdfCodeSegment[][] = [];
          let currentLine: PdfCodeSegment[] = [];
          let currentLineWidth = 0;

          const pushCurrentLine = () => {
            wrappedLines.push(currentLine.length ? currentLine : [{
              color: defaultCodeColor,
              fontStyle: 'normal',
              text: ' ',
            }]);
            currentLine = [];
            currentLineWidth = 0;
          };

          const appendSegment = (segment: PdfCodeSegment) => {
            const segmentWidth = measureSegmentWidth(segment);

            if (currentLineWidth + segmentWidth <= innerWidth || !currentLine.length) {
              currentLine.push(segment);
              currentLineWidth += segmentWidth;
              return;
            }

            pushCurrentLine();
            currentLine.push(segment);
            currentLineWidth = segmentWidth;
          };

          segments.forEach((segment) => {
            const tokenWidth = measureSegmentWidth(segment);

            if (tokenWidth <= innerWidth) {
              appendSegment(segment);
              return;
            }

            let chunk = '';

            for (const character of segment.text) {
              const candidate = `${chunk}${character}`;
              const candidateSegment = { ...segment, text: candidate };

              if (measureSegmentWidth(candidateSegment) > innerWidth && chunk) {
                appendSegment({ ...segment, text: chunk });
                chunk = character;
                continue;
              }

              chunk = candidate;
            }

            if (chunk) {
              appendSegment({ ...segment, text: chunk });
            }
          });

          if (currentLine.length) {
            pushCurrentLine();
          }

          return wrappedLines;
        };
        const tokenizeCodeLine = (
          line: string,
          isInsideBlockComment: boolean,
        ): { inBlockComment: boolean; segments: PdfCodeSegment[] } => {
          const trimmedLine = line.trim();

          if (isInsideBlockComment) {
            return {
              inBlockComment: !trimmedLine.includes('*/'),
              segments: [
                {
                  color: commentCodeColor,
                  fontStyle: 'normal',
                  text: line.length > 0 ? line : ' ',
                },
              ],
            };
          }

          if (trimmedLine.startsWith('//')) {
            return {
              inBlockComment: false,
              segments: [
                {
                  color: commentCodeColor,
                  fontStyle: 'normal',
                  text: line.length > 0 ? line : ' ',
                },
              ],
            };
          }

          if (trimmedLine.startsWith('/*')) {
            return {
              inBlockComment: !trimmedLine.includes('*/'),
              segments: [
                {
                  color: commentCodeColor,
                  fontStyle: 'normal',
                  text: line.length > 0 ? line : ' ',
                },
              ],
            };
          }

          const inlineCommentIndex = findInlineCommentIndex(line);
          const codePart =
            inlineCommentIndex >= 0 ? line.slice(0, inlineCommentIndex) : line;
          const commentPart =
            inlineCommentIndex >= 0 ? line.slice(inlineCommentIndex) : '';
          const tokens =
            codePart.match(
              /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@\w+|\s+|[A-Za-z_]\w*|[^\sA-Za-z_]+)/g,
            ) ?? [codePart || ' '];
          const codeSegments = tokens.map((token) => {
            if (/^\s+$/.test(token)) {
              return {
                color: defaultCodeColor,
                fontStyle: 'normal' as const,
                text: token,
              };
            }

            if (
              (token.startsWith('"') && token.endsWith('"')) ||
              (token.startsWith("'") && token.endsWith("'"))
            ) {
              return {
                color: stringCodeColor,
                fontStyle: 'normal' as const,
                text: token,
              };
            }

            if (token.startsWith('@')) {
              return {
                color: annotationCodeColor,
                fontStyle: 'bold' as const,
                text: token,
              };
            }

            if (token === 'import') {
              return {
                color: importCodeColor,
                fontStyle: 'bold' as const,
                text: token,
              };
            }

            if (pdfCodeKeywords.has(token)) {
              return {
                color: keywordCodeColor,
                fontStyle: 'bold' as const,
                text: token,
              };
            }

            if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) {
              return {
                color: typeCodeColor,
                fontStyle: 'bold' as const,
                text: token,
              };
            }

            return {
              color: defaultCodeColor,
              fontStyle: 'normal' as const,
              text: token,
            };
          });

          return {
            inBlockComment:
              inlineCommentIndex >= 0 &&
              commentPart.startsWith('/*') &&
              !commentPart.includes('*/'),
            segments: commentPart
              ? [
                  ...codeSegments,
                  {
                    color: commentCodeColor,
                    fontStyle: 'normal' as const,
                    text: commentPart,
                  },
                ]
              : codeSegments,
          };
        };
        const codeLines = content.split('\n');
        const renderedLines: PdfCodeSegment[][] = [];
        let isInsideBlockComment = false;

        codeLines.forEach((line) => {
          const tokenizedLine = tokenizeCodeLine(line, isInsideBlockComment);
          isInsideBlockComment = tokenizedLine.inBlockComment;
          renderedLines.push(...wrapStyledLine(tokenizedLine.segments));
        });
        const lineHeight = fontSize * 0.3528 * lineGap;
        let currentIndex = 0;
        let isFirstChunk = true;

        while (currentIndex < renderedLines.length) {
          const currentLanguageBadgeHeight = language && isFirstChunk ? 8 : 0;
          const availableHeight = contentBottomLimit - cursorY - 6;
          let maxLinesForChunk = Math.floor(
            (availableHeight - blockPaddingY * 2 - currentLanguageBadgeHeight - 2) /
              lineHeight,
          );

          if (maxLinesForChunk <= 0) {
            pdf.addPage();
            cursorY = margin;
            continue;
          }

          const chunkLines = renderedLines.slice(
            currentIndex,
            currentIndex + maxLinesForChunk,
          );
          const blockHeight =
            blockPaddingY * 2 +
            currentLanguageBadgeHeight +
            chunkLines.length * lineHeight +
            2;

          pdf.setFillColor(248, 250, 252);
          pdf.setDrawColor(226, 232, 240);
          pdf.roundedRect(margin, cursorY, blockWidth, blockHeight, 2, 2, 'FD');

          let textY = cursorY + blockPaddingY + 2;

          if (language && isFirstChunk) {
            pdf.setFillColor(226, 232, 240);
            pdf.roundedRect(margin + blockPaddingX, cursorY + 3, 16, 5, 1.5, 1.5, 'F');
            pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
            pdf.setFontSize(7);
            pdf.setTextColor(71, 85, 105);
            pdf.text(language.toUpperCase(), margin + blockPaddingX + 1.5, cursorY + 6.7);
            textY += currentLanguageBadgeHeight;
          }

          chunkLines.forEach((lineSegments, lineIndex) => {
            let cursorX = margin + blockPaddingX;
            const lineY = textY + lineIndex * lineHeight;

            lineSegments.forEach((segment) => {
              pdf.setFont(getPdfCodeFont(), getPdfFontStyle(segment.fontStyle));
              pdf.setFontSize(fontSize);
              pdf.setTextColor(...segment.color);
              pdf.text(segment.text, cursorX, lineY);
              cursorX += measureSegmentWidth(segment);
            });
          });

          cursorY += blockHeight + 6;
          currentIndex += chunkLines.length;
          isFirstChunk = false;
        }
      };

      const writeListBlock = async (items: PdfListItem[]) => {
        const markerWidth = 12;
        const itemGap = 2.5;
        const indentWidth = 8;

        for (const item of items) {
          const itemX = margin + item.indentLevel * indentWidth;
          const textX = itemX + markerWidth;
          const textWidth = Math.max(24, pageWidth - margin - textX);
          const lineHeight = 10 * 0.3528 * 1.55;
          let markerPrinted = false;
          let itemHeight = 0;
          const itemLines = item.text.split('\n');

          const writeListTextLine = (
            line: string,
            y: number,
            shouldPrintMarker: boolean,
          ) => {
            const segments = parsePdfInlineSegments(line);
            const measurePieceWidth = (piece: PdfInlineSegment) => {
              const pieceFont =
                piece.type === 'code'
                  ? getPdfCodeFont()
                  : getPdfTextFont();
              const pieceFontStyle =
                piece.type === 'link' || piece.type === 'code'
                  ? 'normal'
                  : piece.fontStyle;
              pdf.setFont(pieceFont, getPdfFontStyle(pieceFontStyle));
              pdf.setFontSize(10);
              return pdf.getTextWidth(piece.text);
            };
            const pieces: PdfInlineSegment[] = [];

            segments.forEach((segment) => {
              const tokens = segment.text.match(/\S+\s*|\s+/g) ?? [segment.text];
              tokens.forEach((token) => {
                if (token.length) {
                  pieces.push({ ...segment, text: token });
                }
              });
            });

            const wrappedLines: PdfInlineSegment[][] = [];
            let currentLine: PdfInlineSegment[] = [];
            let currentWidth = 0;

            const pushLine = () => {
              wrappedLines.push(
                currentLine.length
                  ? currentLine
                  : [{ fontStyle: 'normal', text: ' ', type: 'text' }],
              );
              currentLine = [];
              currentWidth = 0;
            };

            const appendPiece = (piece: PdfInlineSegment) => {
              const pieceWidth = measurePieceWidth(piece);

              if (!currentLine.length || currentWidth + pieceWidth <= textWidth) {
                currentLine.push(piece);
                currentWidth += pieceWidth;
                return;
              }

              pushLine();
              currentLine.push(piece);
              currentWidth = pieceWidth;
            };

            pieces.forEach((piece) => {
              const pieceWidth = measurePieceWidth(piece);

              if (pieceWidth <= textWidth) {
                appendPiece(piece);
                return;
              }

              let chunk = '';

              for (const character of piece.text) {
                const candidate = `${chunk}${character}`;
                const candidatePiece = { ...piece, text: candidate };

                if (measurePieceWidth(candidatePiece) > textWidth && chunk) {
                  appendPiece({ ...piece, text: chunk });
                  chunk = character;
                  continue;
                }

                chunk = candidate;
              }

              if (chunk) {
                appendPiece({ ...piece, text: chunk });
              }
            });

            if (currentLine.length) {
              pushLine();
            }

            if (shouldPrintMarker) {
              pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
              pdf.setFontSize(10);
              pdf.setTextColor(51, 65, 85);
              pdf.text(item.marker, itemX, y + 4);
            }

            wrappedLines.forEach((linePieces, lineIndex) => {
              let cursorX = textX;
              const lineY = y + 4 + lineIndex * lineHeight;

              linePieces.forEach((piece) => {
                const isLink = piece.type === 'link' && piece.href;
                const isCode = piece.type === 'code';
                const pieceColor = isLink
                  ? [37, 99, 235] as [number, number, number]
                  : isCode
                    ? [30, 41, 59] as [number, number, number]
                    : [15, 23, 42] as [number, number, number];
                const pieceWidth = measurePieceWidth(piece);
                const pieceFont =
                  isCode ? getPdfCodeFont() : getPdfTextFont();
                const pieceFontStyle =
                  isLink || isCode ? 'normal' : piece.fontStyle;

                pdf.setFont(pieceFont, getPdfFontStyle(pieceFontStyle));
                pdf.setFontSize(10);
                pdf.setTextColor(...pieceColor);
                pdf.text(piece.text, cursorX, lineY);

                if (isLink) {
                  pdf.setDrawColor(...pieceColor);
                  pdf.setLineWidth(0.2);
                  pdf.line(cursorX, lineY + 0.6, cursorX + pieceWidth, lineY + 0.6);
                  pdf.link(cursorX, lineY - 2.8, pieceWidth, lineHeight, {
                    url: piece.href!,
                  });
                }

                cursorX += pieceWidth;
              });
            });

            return wrappedLines.length * lineHeight + 2;
          };

          for (const rawLine of itemLines) {
            const line = rawLine.trim();

            if (!line) {
              itemHeight += lineHeight * 0.5;
              continue;
            }

            const imageMatches = Array.from(line.matchAll(markdownImagePattern));

            if (!imageMatches.length) {
              ensureSpace(lineHeight + itemGap);
              const renderedHeight = writeListTextLine(
                line,
                cursorY + itemHeight,
                !markerPrinted,
              );
              markerPrinted = true;
              itemHeight += renderedHeight;
              continue;
            }

            let lastIndex = 0;

            for (const match of imageMatches) {
              const [fullMatch, , imageSource = ''] = match;
              const matchIndex = match.index ?? 0;
              const beforeText = line.slice(lastIndex, matchIndex).trim();

              if (beforeText) {
                ensureSpace(lineHeight + itemGap);
                const renderedHeight = writeListTextLine(
                  beforeText,
                  cursorY + itemHeight,
                  !markerPrinted,
                );
                markerPrinted = true;
                itemHeight += renderedHeight;
              }

              if (!markerPrinted) {
                pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
                pdf.setFontSize(10);
                pdf.setTextColor(51, 65, 85);
                pdf.text(item.marker, itemX, cursorY + itemHeight + 4);
                markerPrinted = true;
              }

              ensureSpace(96 + itemGap);
              const originalCursorY = cursorY;
              cursorY = cursorY + itemHeight;
              await writeImageToPdf(imageSource, {
                maxHeight: 90,
                maxWidth: textWidth,
                x: textX,
              });
              itemHeight = cursorY - originalCursorY;
              cursorY = originalCursorY;
              lastIndex = matchIndex + fullMatch.length;
            }

            const afterText = line.slice(lastIndex).trim();
            if (afterText) {
              ensureSpace(lineHeight + itemGap);
              const renderedHeight = writeListTextLine(
                afterText,
                cursorY + itemHeight,
                !markerPrinted,
              );
              markerPrinted = true;
              itemHeight += renderedHeight;
            }
          }

          cursorY += itemHeight + itemGap;
        }
      };

      const writeTableBlock = (rows: PdfTableRow[]) => {
        if (!rows.length) {
          return;
        }

        const columnCount = Math.max(...rows.map((row) => row.cells.length));
        const columnWidth = contentWidth / columnCount;
        const cellPaddingX = 2.5;
        const cellPaddingY = 2.5;
        const fontSize = 9.5;
        const lineHeight = fontSize * 0.3528 * 1.45;

        rows.forEach((row, rowIndex) => {
          const normalizedCells = Array.from({ length: columnCount }, (_, index) =>
            row.cells[index] ?? '',
          );
          const wrappedCells = normalizedCells.map(
            (cell) =>
              pdf.splitTextToSize(
                flattenPdfInlineMarkdown(cell) || ' ',
                columnWidth - cellPaddingX * 2,
              ) as string[],
          );
          const rowHeight =
            Math.max(...wrappedCells.map((lines) => lines.length), 1) * lineHeight +
            cellPaddingY * 2 +
            2;

          ensureSpace(rowHeight + 1.5);

          normalizedCells.forEach((_, columnIndex) => {
            const cellX = margin + columnIndex * columnWidth;
            const fillColor: [number, number, number] =
              rowIndex === 0
                ? [226, 232, 240]
                : rowIndex % 2 === 0
                  ? [248, 250, 252]
                  : [255, 255, 255];

            pdf.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
            pdf.setDrawColor(203, 213, 225);
            pdf.rect(cellX, cursorY, columnWidth, rowHeight, 'FD');

            pdf.setFont(
              getPdfTextFont(),
              getPdfFontStyle(rowIndex === 0 ? 'bold' : 'normal'),
            );
            pdf.setFontSize(fontSize);
            pdf.setTextColor(rowIndex === 0 ? 30 : 15, rowIndex === 0 ? 41 : 23, rowIndex === 0 ? 59 : 42);
            pdf.text(
              wrappedCells[columnIndex],
              cellX + cellPaddingX,
              cursorY + cellPaddingY + 3,
            );
          });

          cursorY += rowHeight + 1.5;
        });

        cursorY += 2;
      };

      const writeAdmonitionBlock = async (kind: AdmonitionBlockKind, content: string) => {
        const tone = admonitionPdfStyles[kind];
        const label = tone.label.toUpperCase();
        const innerBlocks = parsePdfContentBlocks(content);
        const admonitionParagraphs: string[] = [];
        const pushAdmonitionParagraph = (value: string) => {
          const normalizedValue = value.trimEnd();
          if (!normalizedValue.length) {
            admonitionParagraphs.push('');
            return;
          }

          admonitionParagraphs.push(normalizedValue);
        };
        const measureWrappedTextLineCount = (value: string, availableWidth: number) => {
          const paragraphs = value.split('\n');
          let count = 0;

          paragraphs.forEach((paragraph) => {
            const trimmedParagraph = paragraph.trim();

            if (!trimmedParagraph) {
              count += 1;
              return;
            }

            const wrappedLines = pdf.splitTextToSize(trimmedParagraph, availableWidth) as string[];
            count += Math.max(1, wrappedLines.length);
          });

          return count;
        };

        innerBlocks.forEach((block) => {
          if (block.type === 'heading') {
            pushAdmonitionParagraph(block.content);
            return;
          }

          if (block.type === 'list') {
            block.items.forEach((item) => {
              const itemLines = item.text.split('\n');
              const firstLine = itemLines[0]?.trim() ?? '';
              const continuationLines = itemLines
                .slice(1)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
              const indentPrefix = '  '.repeat(item.indentLevel);
              const continuationPrefix = `${indentPrefix}   `;

              pushAdmonitionParagraph(
                [
                  `${indentPrefix}${item.marker} ${flattenPdfInlineMarkdown(firstLine)}`.trimEnd(),
                  ...continuationLines.map(
                    (line) => `${continuationPrefix}${flattenPdfInlineMarkdown(line)}`,
                  ),
                ].join('\n'),
              );
            });
            return;
          }

          if (block.type === 'table') {
            block.rows.forEach((row) => {
              pushAdmonitionParagraph(flattenPdfInlineMarkdown(row.cells.join(' | ')));
            });
            return;
          }

          if (block.type === 'code') {
            block.content.split('\n').forEach((line) => {
              pushAdmonitionParagraph(line);
            });
            return;
          }

          if (block.type === 'spacer') {
            pushAdmonitionParagraph('');
            return;
          }

          if (block.type === 'admonition') {
            pushAdmonitionParagraph(admonitionPdfStyles[block.kind].label);
            block.content.split('\n').forEach((line) => {
              const matches = Array.from(line.matchAll(markdownImagePattern));

              if (!matches.length) {
                pushAdmonitionParagraph(flattenPdfInlineMarkdown(line));
                return;
              }

              let lastIndex = 0;
              matches.forEach((match) => {
                const [fullMatch] = match;
                const matchIndex = match.index ?? 0;
                const beforeText = line.slice(lastIndex, matchIndex).trim();

                if (beforeText) {
                  pushAdmonitionParagraph(flattenPdfInlineMarkdown(beforeText));
                }
                lastIndex = matchIndex + fullMatch.length;
              });

              const afterText = line.slice(lastIndex).trim();
              if (afterText) {
                pushAdmonitionParagraph(flattenPdfInlineMarkdown(afterText));
              }
            });
            return;
          }

          block.content.split('\n').forEach((line) => {
            const matches = Array.from(line.matchAll(markdownImagePattern));

            if (!matches.length) {
              pushAdmonitionParagraph(flattenPdfInlineMarkdown(line));
              return;
            }

            let lastIndex = 0;
            matches.forEach((match) => {
              const [fullMatch] = match;
              const matchIndex = match.index ?? 0;
              const beforeText = line.slice(lastIndex, matchIndex).trim();

              if (beforeText) {
                pushAdmonitionParagraph(flattenPdfInlineMarkdown(beforeText));
              }
              lastIndex = matchIndex + fullMatch.length;
            });

            const afterText = line.slice(lastIndex).trim();
            if (afterText) {
              pushAdmonitionParagraph(flattenPdfInlineMarkdown(afterText));
            }
          });
        });

        const paddingX = 4;
        const paddingY = 4;
        const textWidth = contentWidth - paddingX * 2;
        pdf.setFont(getPdfTextFont(), getPdfFontStyle('normal'));
        pdf.setFontSize(10);
        const lineHeight = 10 * 0.3528 * 1.5;
        const labelHeight = 9;
        let contentHeight = 0;

        for (const paragraph of admonitionParagraphs) {
          if (!paragraph.trim()) {
            contentHeight += lineHeight * 0.6;
            continue;
          }

          const wrappedLines = paragraph.trim()
            ? measureWrappedTextLineCount(paragraph, textWidth)
            : 1;
          contentHeight += Math.max(1, wrappedLines) * lineHeight;
        }

        const totalHeight = paddingY * 2 + labelHeight + contentHeight + 1;

        ensureSpace(totalHeight + 4);
        const contentStartY = cursorY + paddingY + labelHeight + 3;
        pdf.setFillColor(...tone.fill);
        pdf.setDrawColor(...tone.border);
        pdf.roundedRect(margin, cursorY, contentWidth, totalHeight, 2.5, 2.5, 'FD');

        pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
        pdf.setFontSize(9.5);
        pdf.setTextColor(...tone.text);
        pdf.text(label, margin + paddingX, cursorY + 6.5);

        pdf.setFont(getPdfTextFont(), getPdfFontStyle('normal'));
        pdf.setFontSize(10);
        pdf.setTextColor(...tone.text);
        let innerCursorY = contentStartY;

        for (const paragraph of admonitionParagraphs) {
          if (!paragraph.trim()) {
            innerCursorY += lineHeight * 0.6;
            continue;
          }

          const paragraphLines = paragraph.trim() ? paragraph.split('\n') : [''];

          paragraphLines.forEach((paragraphLine) => {
            const trimmedParagraph = paragraphLine.trim();
            const wrappedLines = trimmedParagraph
              ? (pdf.splitTextToSize(trimmedParagraph, textWidth) as string[])
              : [''];

            wrappedLines.forEach((wrappedLine, wrappedLineIndex) => {
              pdf.text(
                wrappedLine,
                margin + paddingX,
                innerCursorY + wrappedLineIndex * lineHeight,
              );
            });

            innerCursorY += Math.max(1, wrappedLines.length) * lineHeight;
          });
        }

        cursorY += totalHeight + 4;
      };

      const writeImageToPdf = async (
        source: string,
        options?: { maxHeight?: number; maxWidth?: number; x?: number },
      ) => {
        try {
          const imageAsset = await resolvePdfImageAsset(source);
          const maxWidth = options?.maxWidth ?? contentWidth;
          const maxHeight = options?.maxHeight ?? 120;
          const renderX = options?.x ?? margin;
          let renderWidth = maxWidth;
          let renderHeight = (imageAsset.height / imageAsset.width) * renderWidth;

          if (renderHeight > maxHeight) {
            renderHeight = maxHeight;
            renderWidth = (imageAsset.width / imageAsset.height) * renderHeight;
          }

          const imageFormat = imageAsset.dataUrl.includes('image/jpeg')
            ? 'JPEG'
            : 'PNG';

          ensureSpace(renderHeight + 8);
          pdf.addImage(
            imageAsset.dataUrl,
            imageFormat,
            renderX,
            cursorY,
            renderWidth,
            renderHeight,
          );
          cursorY += renderHeight + 6;
        } catch {
          writeImagePlaceholder('Imagen no disponible');
        }
      };

      const writeMarkdownLine = async (line: string) => {
        const matches = Array.from(line.matchAll(markdownImagePattern));

        if (!matches.length) {
          writeInlineText(normalizePdfRichText(line));
          return;
        }

        let lastIndex = 0;

        for (const match of matches) {
          const [fullMatch, , imageSource = ''] = match;
          const matchIndex = match.index ?? 0;
          const beforeText = line.slice(lastIndex, matchIndex).trim();

          if (beforeText) {
            writeInlineText(normalizePdfRichText(beforeText));
          }

          await writeImageToPdf(imageSource);
          lastIndex = matchIndex + fullMatch.length;
        }

        const afterText = line.slice(lastIndex).trim();
        if (afterText) {
          writeInlineText(normalizePdfRichText(afterText));
        }
      };

      if (options.documentTitle) {
        pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
        pdf.setFontSize(20);
        pdf.setTextColor(15, 23, 42);
        const documentTitleLines = pdf.splitTextToSize(
          options.documentTitle,
          contentWidth,
        ) as string[];
        const documentTitleLineHeight = 20 * 0.3528 * 1.55;
        ensureSpace(documentTitleLines.length * documentTitleLineHeight + 10);
        pdf.text(documentTitleLines, margin, cursorY);
        cursorY += documentTitleLines.length * documentTitleLineHeight + 3;

        if (options.documentSubtitle) {
          pdf.setFont(getPdfTextFont(), getPdfFontStyle('normal'));
          pdf.setFontSize(10.5);
          pdf.setTextColor(71, 85, 105);
          const subtitleLines = pdf.splitTextToSize(
            options.documentSubtitle,
            contentWidth,
          ) as string[];
          const subtitleLineHeight = 10.5 * 0.3528 * 1.55;
          ensureSpace(subtitleLines.length * subtitleLineHeight + 10);
          pdf.text(subtitleLines, margin, cursorY);
          cursorY += subtitleLines.length * subtitleLineHeight + 7;
        } else {
          cursorY += 5;
        }

        pdf.setDrawColor(226, 232, 240);
        pdf.line(margin, cursorY, pageWidth - margin, cursorY);
        cursorY += 7;
      }

      for (const [entryIndex, entry] of entries.entries()) {
        if (entryIndex > 0) {
          pdf.addPage();
          cursorY = margin;
        }

        pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
        pdf.setFontSize(18);
        pdf.setTextColor(15, 23, 42);
        const titleLines = pdf.splitTextToSize(entry.titulo, contentWidth) as string[];
        const titleLineHeight = 18 * 0.3528 * 1.6;
        ensureSpace(titleLines.length * titleLineHeight + 8);
        pdf.text(titleLines, margin, cursorY);
        cursorY += titleLines.length * titleLineHeight + 8;

        for (const block of parsePdfContentBlocks(entry.contenido)) {
        if (block.type === 'code') {
          writeCodeBlock(block.content, block.language);
          continue;
        }

        if (block.type === 'heading') {
          writeMarkdownHeading(block.content, block.depth);
          continue;
        }

        if (block.type === 'admonition') {
          await writeAdmonitionBlock(block.kind, block.content);
          continue;
        }

        if (block.type === 'list') {
          await writeListBlock(block.items);
          continue;
        }

        if (block.type === 'spacer') {
          cursorY += block.size === 'paragraph' ? 3.5 : 0;
          continue;
        }

        if (block.type === 'table') {
          writeTableBlock(block.rows);
          continue;
        }

        const textLines = block.content
          .split('\n');

        for (const rawLine of textLines) {
          const normalizedLine = normalizeIndentation(rawLine);
          const line = stripLeadingWhitespace(normalizedLine).trimEnd();

          if (!line) {
            cursorY += 2.5;
            continue;
          }

          const indentLevel = getIndentLevel(normalizedLine);
          const indentWidth = indentLevel * 8;
          const originalMargin = margin;
          const originalContentWidth = contentWidth;

          if (indentWidth > 0) {
            const scopedWidth = Math.max(30, originalContentWidth - indentWidth);
            const writeIndentedLine = async () => {
              const matches = Array.from(line.matchAll(markdownImagePattern));

              if (!matches.length) {
                writeInlineText(normalizePdfRichText(line), {
                  maxWidth: scopedWidth,
                  x: originalMargin + indentWidth,
                });
                return;
              }

              let lastIndex = 0;

              for (const match of matches) {
                const [fullMatch, , imageSource = ''] = match;
                const matchIndex = match.index ?? 0;
                const beforeText = line.slice(lastIndex, matchIndex).trim();

                if (beforeText) {
                  writeInlineText(normalizePdfRichText(beforeText), {
                    maxWidth: scopedWidth,
                    x: originalMargin + indentWidth,
                  });
                }

                await writeImageToPdf(imageSource);
                lastIndex = matchIndex + fullMatch.length;
              }

              const afterText = line.slice(lastIndex).trim();
              if (afterText) {
                writeInlineText(normalizePdfRichText(afterText), {
                  maxWidth: scopedWidth,
                  x: originalMargin + indentWidth,
                });
              }
            };

            await writeIndentedLine();
            continue;
          }

          await writeMarkdownLine(line);
        }
        }

        if (entry.pasos?.length) {
          writeSectionTitle('Pasos');
          entry.pasos.forEach((step, index) => {
            writeText(`${index + 1}. ${step}`);
          });
        }

        if (entry.comandos?.length) {
          writeSectionTitle('Parametros y comandos utiles');
          const labelWidth = 55;
          const valueWidth = contentWidth - labelWidth;
          const rowGap = 2;

          entry.comandos.forEach((command) => {
            pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
            pdf.setFontSize(10);
            const labelLines = pdf.splitTextToSize(command.label, labelWidth - 4) as string[];
            pdf.setFont(getPdfCodeFont(), getPdfFontStyle('normal'));
            pdf.setFontSize(10);
            const valueLines = pdf.splitTextToSize(command.value, valueWidth - 6) as string[];
            const rowHeight = Math.max(labelLines.length, valueLines.length) * (10 * 0.3528 * 1.6) + 6;
            ensureSpace(rowHeight + rowGap);

            pdf.setTextColor(71, 85, 105);
            pdf.setFont(getPdfTextFont(), getPdfFontStyle('bold'));
            pdf.text(labelLines, margin, cursorY + 5);

            pdf.setFillColor(248, 250, 252);
            pdf.setDrawColor(226, 232, 240);
            pdf.roundedRect(margin + labelWidth, cursorY, valueWidth, rowHeight, 1.5, 1.5, 'FD');

            pdf.setTextColor(15, 23, 42);
            pdf.setFont(getPdfCodeFont(), getPdfFontStyle('normal'));
            pdf.text(valueLines, margin + labelWidth + 3, cursorY + 5);

            cursorY += rowHeight + rowGap;
          });
        }
      }

      const totalPages = pdf.getNumberOfPages();
      const footerDividerY = pageHeight - margin - footerHeight + 1.5;
      const footerBaselineY = pageHeight - margin - 3.5;
      const footerIconSize = 5.5;

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        pdf.setPage(pageNumber);

        if (includeBrandingFooter) {
          pdf.setDrawColor(226, 232, 240);
          pdf.setLineWidth(0.25);
          pdf.line(margin, footerDividerY, pageWidth - margin, footerDividerY);

          let footerTextX = margin;

          if (footerIconAsset) {
            const footerIconFormat = footerIconAsset.dataUrl.includes('image/jpeg')
              ? 'JPEG'
              : 'PNG';

            pdf.addImage(
              footerIconAsset.dataUrl,
              footerIconFormat,
              margin,
              footerBaselineY - footerIconSize + 0.4,
              footerIconSize,
              footerIconSize,
            );
            footerTextX += footerIconSize + 2.5;
          }

          pdf.setFont(getPdfTextFont(), getPdfFontStyle('normal'));
          pdf.setFontSize(8.5);
          pdf.setTextColor(71, 85, 105);
          pdf.text('Documentación generada con Prysma', footerTextX, footerBaselineY);
        }

        if (totalPages > 1) {
          pdf.setFont(getPdfTextFont(), getPdfFontStyle('normal'));
          pdf.setFontSize(8.5);
          pdf.setTextColor(71, 85, 105);
          pdf.text(`Página ${pageNumber}`, pageWidth - margin, footerBaselineY, {
            align: 'right',
          });
        }
      }

  // A partir de ahora, para el cÃ³digo que pueda generar alguna excepciÃ³n, siempre debo usar try-catch-resources en Java para garantizar el cierre seguro de los flujos del archivo PDF generado.
      pdf.save(fileName);
    } catch (error) {
      console.error('No se pudo exportar la ficha a PDF.', error);
      setSaveToast({
        message: 'No se pudo exportar la ficha a PDF. Revisa la consola o vuelve a intentarlo.',
        tone: 'error',
      });
    } finally {
      setExportEntryId('');
    }
  };

  const openEntryPdfExportModal = (entry: KnowledgeEntry) => {
    setEntryPdfExportState({
      entryId: entry.id,
      includeBrandingFooter: true,
    });
  };

  const closeEntryPdfExportModal = () => {
    setEntryPdfExportState(null);
  };

  const handleExportEntryPdf = async () => {
    if (!entryPdfExportState) {
      return;
    }

    const entry = manualData.entries.find(
      (currentEntry) => currentEntry.id === entryPdfExportState.entryId,
    );

    if (!entry) {
      setSaveToast({
        message: 'No se ha encontrado la ficha seleccionada para exportar.',
        tone: 'error',
      });
      closeEntryPdfExportModal();
      return;
    }

    closeEntryPdfExportModal();
    await exportEntriesToPdf([entry], `${entry.id}.pdf`, {
      includeBrandingFooter: entryPdfExportState.includeBrandingFooter,
    });
    setSaveToast({
      message: `PDF generado para "${entry.titulo}".`,
      tone: 'success',
    });
  };

  const openSectionPdfExportModal = (categoryName: string) => {
    const categoryEntries = sortEntries(
      manualData.entries.filter(
        (entry) => entry.categoria.toLowerCase() === categoryName.toLowerCase(),
      ),
      'custom',
    );

    if (!categoryEntries.length) {
      setSaveToast({
        message: 'Esta sección no tiene fichas para exportar a PDF.',
        tone: 'error',
      });
      return;
    }

    setSectionPdfExportState({
      categoryName,
      includeBrandingFooter: true,
      selectedEntryIds: categoryEntries.map((entry) => entry.id),
    });
  };

  const closeSectionPdfExportModal = () => {
    setSectionPdfExportState(null);
  };

  const handleToggleSectionPdfEntry = (entryId: string) => {
    setSectionPdfExportState((currentState) => {
      if (!currentState) {
        return currentState;
      }

      const nextSelectedEntryIds = currentState.selectedEntryIds.includes(entryId)
        ? currentState.selectedEntryIds.filter((currentEntryId) => currentEntryId !== entryId)
        : [...currentState.selectedEntryIds, entryId];

      return {
        ...currentState,
        selectedEntryIds: nextSelectedEntryIds,
      };
    });
  };

  const handleExportSectionPdf = async () => {
    if (!sectionPdfExportState) {
      return;
    }

    const selectedEntryIdSet = new Set(sectionPdfExportState.selectedEntryIds);
    const selectedEntries = sectionPdfEntries.filter((entry) =>
      selectedEntryIdSet.has(entry.id),
    );

    if (!selectedEntries.length) {
      setSaveToast({
        message: 'Selecciona al menos una ficha antes de generar el PDF de la sección.',
        tone: 'error',
      });
      return;
    }

    setExportSectionCategoryName(sectionPdfExportState.categoryName);
    closeSectionPdfExportModal();

    try {
      const sectionDescription =
        categoryMap.get(sectionPdfExportState.categoryName.toLowerCase())
          ?.description ?? '';

      await exportEntriesToPdf(
        selectedEntries,
        `seccion-${slugify(sectionPdfExportState.categoryName)}.pdf`,
        {
          documentTitle: sectionPdfExportState.categoryName,
          documentSubtitle:
            sectionDescription ||
            `${selectedEntries.length} ficha${selectedEntries.length === 1 ? '' : 's'} seleccionada${selectedEntries.length === 1 ? '' : 's'}`,
          includeBrandingFooter: sectionPdfExportState.includeBrandingFooter,
        },
      );
      setSaveToast({
        message: `PDF generado para la sección ${sectionPdfExportState.categoryName} con ${selectedEntries.length} ficha${selectedEntries.length === 1 ? '' : 's'}.`,
        tone: 'success',
      });
    } finally {
      setExportSectionCategoryName('');
    }
  };

  const handleEntrySave = () => {
    const trimmedCategory = entryForm.categoria.trim();
    const trimmedTitle = entryForm.titulo.trim();
    const trimmedContent = entryForm.contenido.trim();

    if (!trimmedCategory || !trimmedTitle || !trimmedContent) {
      setFormError(
        'Categoría, título y contenido son obligatorios para guardar la ficha.',
      );
      return;
    }

    const normalizedCategoryKey = trimmedCategory.toLowerCase();
    const existingCategory = categoryMap.get(normalizedCategoryKey);

    if (!existingCategory) {
      setFormError(
        'La ficha debe pertenecer a una sección existente. Crea primero la sección desde la Home si aún no existe.',
      );
      return;
    }

    const customEntryId = entryForm.id.trim();
    const originalId =
      modalState?.type === 'entry' && modalState.mode === 'edit'
        ? modalState.entryId
        : undefined;
    const duplicateEntryId = customEntryId
      ? manualData.entries.some(
          (entry) => entry.id === customEntryId && entry.id !== originalId,
        )
      : false;

    if (duplicateEntryId) {
      setFormError(
        'Ya existe una ficha con ese ID. Usa otro identificador o deja el campo vacio para autogenerarlo.',
      );
      return;
    }

    const duplicateEntryTitle = manualData.entries.some(
      (entry) =>
        normalizeComparableText(entry.titulo) ===
          normalizeComparableText(trimmedTitle) && entry.id !== originalId,
    );

    if (duplicateEntryTitle) {
      setFormError(
        'Ya existe una ficha con ese título. Cambia el título para evitar duplicados.',
      );
      return;
    }

    updateManualData((currentManualData) => {
      const nextId = ensureUniqueEntryId(
        entryForm.id || `${trimmedCategory}-${trimmedTitle}`,
        currentManualData.entries,
        originalId,
      );
      const originalEntry = originalId
        ? currentManualData.entries.find((entry) => entry.id === originalId)
        : undefined;
      const nextEntry: KnowledgeEntry = {
        categoria: trimmedCategory,
        comandos: entryForm.comandos
          .map((command) => ({
            label: command.label.trim(),
            value: command.value,
          }))
          .filter((command) => command.label.length > 0),
        contenido: trimmedContent,
        id: nextId,
        pasos: splitLines(entryForm.pasos),
        tags:
          entryForm.tags.trim().length > 0
            ? normalizeTags(entryForm.tags)
            : generateAutomaticEntryTags({
                categoria: trimmedCategory,
                comandos: entryForm.comandos
                  .map((command) => ({
                    label: command.label.trim(),
                    value: command.value,
                  }))
                  .filter((command) => command.label.length > 0),
                contenido: trimmedContent,
                pasos: splitLines(entryForm.pasos),
                titulo: trimmedTitle,
              }),
        titulo: trimmedTitle,
        isPinned: originalEntry?.isPinned ?? false,
        updatedAt: getCurrentIsoDate(),
      };

      const nextEntries =
        modalState?.type === 'entry' && modalState.mode === 'edit'
          ? currentManualData.entries.map((entry) =>
              entry.id === modalState.entryId ? nextEntry : entry,
            )
          : [...currentManualData.entries, nextEntry];

      return {
        ...currentManualData,
        categories: deriveCategories(nextEntries, currentManualData.categories),
        entries: nextEntries,
      };
    });

    closeModal();
  };

  const handleCategorySave = () => {
    if (!categoryForm || modalState?.type !== 'category') {
      return;
    }

    const trimmedName = categoryForm.name.trim();
    if (!trimmedName || !categoryForm.description.trim()) {
      setFormError(
        'El nombre y la descripción de la sección son obligatorios.',
      );
      return;
    }

    const currentCategoryName = modalState.categoryName;
    const duplicateCategory = manualData.categories.find(
      (category) =>
        category.name.toLowerCase() === trimmedName.toLowerCase() &&
        category.name.toLowerCase() !== currentCategoryName?.toLowerCase(),
    );

    if (duplicateCategory) {
      setFormError(
        'Ya existe una sección con ese nombre. Usa otro nombre o edita la existente.',
      );
      return;
    }

    updateManualData((currentManualData) => {
      const nextEntries = currentCategoryName
        ? currentManualData.entries.map((entry) =>
            entry.categoria.toLowerCase() === currentCategoryName.toLowerCase()
              ? { ...entry, categoria: trimmedName }
              : entry,
          )
        : currentManualData.entries;

      const nextCategoryDefinition = {
        color: categoryForm.color,
        description: categoryForm.description.trim(),
        name: trimmedName,
      };

      const nextCategories = currentCategoryName
        ? currentManualData.categories.map((category) =>
            category.name.toLowerCase() === currentCategoryName.toLowerCase()
              ? nextCategoryDefinition
              : category,
          )
        : [...currentManualData.categories, nextCategoryDefinition];

      return {
        ...currentManualData,
        categories: deriveCategories(nextEntries, nextCategories),
        entries: nextEntries,
      };
    });

    closeModal();
  };

  const handleTemplateSave = () => {
    if (!templateForm || modalState?.type !== 'template') {
      return;
    }

    const trimmedName = templateForm.name.trim();
    const trimmedContent = templateForm.contenido.trim();

    if (!trimmedName || !trimmedContent) {
      setFormError(
        'El nombre y el contenido base son obligatorios para guardar la plantilla.',
      );
      return;
    }

    const trimmedCategory = templateForm.categoria.trim();
    if (
      trimmedCategory &&
      !manualData.categories.some(
        (category) => category.name.toLowerCase() === trimmedCategory.toLowerCase(),
      )
    ) {
      setFormError(
        'La sección sugerida de la plantilla debe existir antes de guardarla.',
      );
      return;
    }

    const originalTemplateId =
      modalState.mode === 'edit' ? modalState.templateId : undefined;
    const customTemplateId = templateForm.id.trim();
    const duplicateTemplateId = customTemplateId
      ? manualData.templates.some(
          (template) =>
            template.id === customTemplateId && template.id !== originalTemplateId,
        )
      : false;

    if (duplicateTemplateId) {
      setFormError(
        'Ya existe una plantilla con ese ID tecnico. Cambialo desde las opciones tecnicas o deja que la app lo genere automaticamente.',
      );
      return;
    }

    const duplicateTemplateName = manualData.templates.some(
      (template) =>
        normalizeComparableText(template.name) ===
          normalizeComparableText(trimmedName) &&
        template.id !== originalTemplateId,
    );

    if (duplicateTemplateName) {
      setFormError(
        'Ya existe una plantilla con ese nombre. Cambia el nombre para evitar duplicados.',
      );
      return;
    }

    const trimmedTemplateTitle = templateForm.titulo.trim();
    const duplicateTemplateTitle = trimmedTemplateTitle
      ? manualData.templates.some(
          (template) =>
            normalizeComparableText(template.titulo) ===
              normalizeComparableText(trimmedTemplateTitle) &&
            template.id !== originalTemplateId,
        )
      : false;

    if (duplicateTemplateTitle) {
      setFormError(
        'Ya existe una plantilla con ese titulo sugerido. Cambialo para evitar duplicados.',
      );
      return;
    }

    updateManualData((currentManualData) => {
      const originalTemplate = originalTemplateId
        ? currentManualData.templates.find(
            (template) => template.id === originalTemplateId,
          )
        : undefined;

      const nextId = ensureUniqueEntryId(
        templateForm.id || `plantilla-${trimmedName}`,
        currentManualData.templates.map((template) => ({
          id: template.id,
        })) as KnowledgeEntry[],
        originalTemplateId,
      );

      const nextTemplate = normalizeTemplate({
        categoria: trimmedCategory || undefined,
        comandos: templateForm.comandos
          .map((command) => ({
            label: command.label.trim(),
            value: command.value,
          }))
          .filter((command) => command.label.length > 0),
        contenido: trimmedContent,
        id: nextId,
        isFavorite: originalTemplate?.isFavorite ?? false,
        name: trimmedName,
        pasos: splitLines(templateForm.pasos),
        tags: normalizeTags(templateForm.tags),
        titulo: templateForm.titulo.trim(),
        updatedAt: getCurrentIsoDate(),
      });

      const nextTemplates =
        modalState.mode === 'edit'
          ? currentManualData.templates.map((template) =>
              template.id === modalState.templateId ? nextTemplate : template,
            )
          : [...currentManualData.templates, nextTemplate];

      return {
        ...currentManualData,
        templates: nextTemplates,
      };
    });

    closeModal();
  };

  const handleDeleteTemplate = (templateId: string) => {
    updateManualData((currentManualData) => ({
      ...currentManualData,
      templates: currentManualData.templates.filter(
        (template) => template.id !== templateId,
      ),
    }));

    closeModal();
  };

  const handleToggleFavoriteTemplate = (templateId: string) => {
    updateManualData((currentManualData) => ({
      ...currentManualData,
      templates: currentManualData.templates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              isFavorite: !template.isFavorite,
              updatedAt: getCurrentIsoDate(),
            }
          : template,
      ),
    }));
  };

  const handleApplySelectedTemplate = () => {
    if (!selectedTemplateId) {
      setFormError('Selecciona una plantilla antes de aplicarla.');
      return;
    }

    const template = manualData.templates.find(
      (currentTemplate) => currentTemplate.id === selectedTemplateId,
    );

    if (!template) {
      setFormError('No se ha encontrado la plantilla seleccionada.');
      return;
    }

    setEntryForm((current) => applyTemplateToEntryForm(current, template));
    setFormError('');
  };

  const handleSaveCurrentEntryAsTemplate = () => {
    setTemplateForm(
      buildTemplateFormState({
        categoria: entryForm.categoria.trim() || undefined,
        comandos: entryForm.comandos
          .map((command) => ({
            label: command.label.trim(),
            value: command.value,
          }))
          .filter((command) => command.label.length > 0),
        contenido: entryForm.contenido,
        id: '',
        name: entryForm.titulo.trim()
          ? `Plantilla ${entryForm.titulo.trim()}`
          : '',
        pasos: splitLines(entryForm.pasos),
        tags: normalizeTags(entryForm.tags),
        titulo: entryForm.titulo.trim(),
        updatedAt: getCurrentIsoDate(),
      }),
    );
    setFormError('');
    setModalState({ mode: 'create', type: 'template' });
  };

  const openCreateEntryWithTemplate = (template: EntryTemplate) => {
    const preferredCategory =
      activeCategoryFilter || template.categoria || manualData.categories[0]?.name || '';
    const shouldLockCategory = Boolean(activeCategoryFilter);
    const categoryDefinition = preferredCategory
      ? categoryMap.get(preferredCategory.toLowerCase())
      : undefined;
    const baseForm = buildEntryFormState(
      undefined,
      categoryDefinition,
      shouldLockCategory,
    );

    setEntryForm(
      applyTemplateToEntryForm(
        {
          ...baseForm,
          categoria: preferredCategory,
          categoryLocked: shouldLockCategory,
        },
        template,
      ),
    );
    setSelectedTemplateId(template.id);
    setFormError('');
    setModalState({
      lockedCategory: shouldLockCategory ? preferredCategory : undefined,
      mode: 'create',
      type: 'entry',
    });
  };

  const handleDeleteEntry = (entryId: string) => {
    setDeleteConfirmationEntryId(entryId);
  };

  const handleCancelDeleteEntry = () => {
    setDeleteConfirmationEntryId('');
  };

  const handleConfirmDeleteEntry = () => {
    if (!deleteConfirmationEntryId) {
      return;
    }

    const entryId = deleteConfirmationEntryId;
    updateManualData((currentManualData) => {
      const entryToDelete = currentManualData.entries.find(
        (entry) => entry.id === entryId,
      );

      if (!entryToDelete) {
        return currentManualData;
      }

      return {
        ...currentManualData,
        entries: currentManualData.entries.filter((entry) => entry.id !== entryId),
        trash: [
          entryToDelete,
          ...currentManualData.trash.filter((entry) => entry.id !== entryId),
        ],
      };
    });
    setDeleteConfirmationEntryId('');
  };

  const handleRestoreEntry = (entryId: string) => {
    updateManualData((currentManualData) => {
      const entryToRestore = currentManualData.trash.find(
        (entry) => entry.id === entryId,
      );

      if (!entryToRestore) {
        return currentManualData;
      }

      const categoryAlreadyExists = currentManualData.categories.some(
        (category) =>
          category.name.toLowerCase() === entryToRestore.categoria.toLowerCase(),
      );

      return {
        ...currentManualData,
        deletedCategories: (currentManualData.deletedCategories ?? []).filter(
          (category) =>
            category.name.toLowerCase() !== entryToRestore.categoria.toLowerCase(),
        ),
        categories: categoryAlreadyExists
          ? currentManualData.categories
          : [
              ...currentManualData.categories,
              currentManualData.deletedCategories?.find(
                (category) =>
                  category.name.toLowerCase() ===
                  entryToRestore.categoria.toLowerCase(),
              ) ?? getDefaultCategoryDefinition(entryToRestore.categoria),
            ],
        entries: [...currentManualData.entries, entryToRestore],
        trash: currentManualData.trash.filter((entry) => entry.id !== entryId),
      };
    });
  };

  const handleRestoreCategory = (categoryName: string) => {
    updateManualData((currentManualData) => {
      const entriesToRestore = currentManualData.trash.filter(
        (entry) => entry.categoria.toLowerCase() === categoryName.toLowerCase(),
      );

      if (!entriesToRestore.length) {
        return currentManualData;
      }

      const deletedCategoryDefinition =
        currentManualData.deletedCategories?.find(
          (category) => category.name.toLowerCase() === categoryName.toLowerCase(),
        ) ?? getDefaultCategoryDefinition(categoryName);
      const categoryAlreadyExists = currentManualData.categories.some(
        (category) => category.name.toLowerCase() === categoryName.toLowerCase(),
      );

      return {
        ...currentManualData,
        deletedCategories: (currentManualData.deletedCategories ?? []).filter(
          (category) => category.name.toLowerCase() !== categoryName.toLowerCase(),
        ),
        categories: categoryAlreadyExists
          ? currentManualData.categories
          : [...currentManualData.categories, deletedCategoryDefinition],
        entries: [...currentManualData.entries, ...entriesToRestore],
        trash: currentManualData.trash.filter(
          (entry) => entry.categoria.toLowerCase() !== categoryName.toLowerCase(),
        ),
      };
    });
  };

  const handleEmptyTrash = () => {
    if (!manualData.trash.length) {
      return;
    }

    const confirmed = window.confirm(
      'Esta acción eliminará definitivamente todas las fichas de la papelera y no se podrán restaurar después. ¿Quieres continuar?',
    );

    if (!confirmed) {
      return;
    }

    updateManualData((currentManualData) => ({
      ...currentManualData,
      deletedCategories: [],
      trash: [],
    }));
    setSaveToast({
      message: 'La papelera se ha vaciado definitivamente.',
      tone: 'success',
    });
  };

  const handleDeleteCategory = (categoryName: string) => {
    const entriesInCategory = manualData.entries.filter(
      (entry) => entry.categoria.toLowerCase() === categoryName.toLowerCase(),
    );

    setDeleteConfirmationCategory({
      categoryName,
      entryCount: entriesInCategory.length,
    });
  };

  const handleCancelDeleteCategory = () => {
    setDeleteConfirmationCategory(null);
  };

  const handleConfirmDeleteCategory = () => {
    if (!deleteConfirmationCategory) {
      return;
    }

    const { categoryName } = deleteConfirmationCategory;

    updateManualData((currentManualData) => {
      const entriesToTrash = currentManualData.entries.filter(
        (entry) => entry.categoria.toLowerCase() === categoryName.toLowerCase(),
      );

      return {
        ...currentManualData,
        deletedCategories: [
          ...(currentManualData.deletedCategories ?? []).filter(
            (category) => category.name.toLowerCase() !== categoryName.toLowerCase(),
          ),
          ...currentManualData.categories.filter(
            (category) => category.name.toLowerCase() === categoryName.toLowerCase(),
          ),
        ],
        categories: currentManualData.categories.filter(
          (category) => category.name.toLowerCase() !== categoryName.toLowerCase(),
        ),
        entries: currentManualData.entries.filter(
          (entry) => entry.categoria.toLowerCase() !== categoryName.toLowerCase(),
        ),
        trash: [
          ...entriesToTrash,
          ...currentManualData.trash.filter(
            (entry) =>
              !entriesToTrash.some((deletedEntry) => deletedEntry.id === entry.id),
          ),
        ],
      };
    });

    setDeleteConfirmationCategory(null);
    closeModal();
  };

  const handleExport = () => {
    const exportPayload = manualData;
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'manual.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    window.alert(
      'Guia: este archivo ya sale con el manual completo. Si quieres conservarlo solo en tu equipo, sustituyelo en src/data/manual.local.json.',
    );
  };

  const downloadJsonFile = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  };

  const handleExportBackup = () => {
    // Recordatorio: Para cualquier proceso en Java que gestione la lectura o escritura de estos archivos de backup o metadatos de fichas, es obligatorio utilizar try-catch-resources para el cierre seguro de flujos de datos.
    const backupPayload: ManualBackupPayload = {
      fecha_creacion: new Date().toISOString(),
      total_entradas: manualData.entries.length,
      version_asistente: ASSISTANT_VERSION,
      data: manualData,
    };

    downloadJsonFile(
      backupPayload,
      `Prysma_Backup_${new Date().toISOString().slice(0, 10)}.json`,
    );
  };

  const handleImportBackupClick = () => {
    backupInputRef.current?.click();
  };

  const closeBackupImportModal = () => {
    setBackupImportState(null);
  };

  const applyImportedManualData = (
    importedManualData: ManualData,
    importMode: ImportMode,
  ) => {
    const nextManualData =
      importMode === 'replace'
        ? importedManualData
        : mergeManualData(manualData, importedManualData);

    setUndoStack((currentUndoStack) => [
      ...currentUndoStack.slice(-(MAX_UNDO_HISTORY - 1)),
      {
        manualData,
      },
    ]);
    persistManualData(nextManualData);
    shouldPersistToServerRef.current = true;
    setUndoStack((currentUndoStack) => [
      ...currentUndoStack.slice(-(MAX_UNDO_HISTORY - 1)),
      {
        manualData,
      },
    ]);
    setRedoStack([]);
    setSaveSyncState('pending');
    setManualData(nextManualData);
    setSearchTerm('');
    setActiveCategoryFilter('');
    setActiveTagFilters([]);
    setShowPinnedOnly(false);
    setResultSortMode('pinned-latest');
    setBackupImportState(null);
    setSaveToast({
      message:
        importMode === 'replace'
          ? 'Backup importado reemplazando el estado actual.'
          : 'Backup importado fusionando el contenido con el estado actual.',
      tone: 'success',
    });
  };

  const handleImportBackup = async (file?: File) => {
    if (!file) {
      return;
    }

    try {
      // Recordatorio: Para cualquier proceso en Java que gestione la lectura o escritura de estos archivos de backup o metadatos de fichas, es obligatorio utilizar try-catch-resources para el cierre seguro de flujos de datos.
      const rawBackup = await file.text();
      const parsedBackup = JSON.parse(rawBackup);
      const importedManualData = normalizeManualData(
        extractManualImportSource(parsedBackup),
      );
      setBackupImportState({
        fileName: file.name,
        importedManualData,
      });
    } catch {
      window.alert('No se pudo importar el backup. Revisa que el JSON sea válido.');
    }
  };

  const handleMarkdownEditorPaste = async (
    event: ReactClipboardEvent<HTMLTextAreaElement>,
    textarea: HTMLTextAreaElement | null,
    currentValue: string,
    setValue: (value: string) => void,
  ) => {
    const clipboardFiles = Array.from(event.clipboardData.files);
    const imageFile = clipboardFiles.find((file) =>
      file.type.startsWith('image/'),
    );

    if (!imageFile) {
      const plainText = event.clipboardData.getData('text/plain');
      const htmlText = event.clipboardData.getData('text/html');

      if ((!plainText && !htmlText) || !textarea) {
        return;
      }

      event.preventDefault();

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextScrollTop = textarea.scrollTop;
      const normalizedText = htmlText
        ? convertHtmlClipboardToMarkdown(htmlText) || normalizePastedMarkdownText(plainText)
        : normalizePastedMarkdownText(plainText);
      const nextCursorPosition = start + normalizedText.length;

      setEditorValueAndNormalizeLists(
        textarea,
        currentValue,
        setValue,
        () => ({
          nextValue: `${currentValue.slice(0, start)}${normalizedText}${currentValue.slice(end)}`,
          selectionStart: nextCursorPosition,
          selectionEnd: nextCursorPosition,
        }),
        nextScrollTop,
      );
      return;
    }

    event.preventDefault();
    setIsUploadingImage(true);

    try {
      const formData = new FormData();
      formData.append('image', imageFile);

      // Si en el futuro esta logica de envio de archivos se procesa en un
      // servidor Java, es imperativo usar try-catch-resources para el manejo
      // de los Streams y asegurar la liberacion de memoria en el entorno RGA
      // [cite: 2026-02-12].
      const response = await fetch(`${getApiBaseUrl()}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('La subida de la imagen no se completo correctamente.');
      }

      const result = (await response.json()) as {
        filename?: string;
        path?: string;
      };
      const imagePath = result.path ?? `/images/${result.filename ?? ''}`;

      if (!imagePath || imagePath.endsWith('/')) {
        throw new Error('No se ha recibido una ruta valida para la imagen.');
      }

      insertTextAtCursor(
        textarea,
        currentValue,
        setValue,
        `![descripcion](${imagePath})`,
      );
    } catch {
      window.alert(
        'No se pudo subir la imagen pegada. Revisa que el servidor de imagenes este activo en el puerto 3001.',
      );
    } finally {
      setIsUploadingImage(false);
    }
  };
  const handleMarkdownEditorChange = (
    event: ReactChangeEvent<HTMLTextAreaElement>,
    textarea: HTMLTextAreaElement | null,
    setValue: (value: string) => void,
    setSelectionState: (nextState: EditorSelectionState) => void,
  ) => {
    const nextRawValue = event.target.value;
    const normalizedValue = renumberOrderedMarkdownLists(nextRawValue);

    if (!textarea || normalizedValue === nextRawValue) {
      setValue(normalizedValue);
      requestAnimationFrame(() => {
        setSelectionState(getEditorSelectionState(textarea));
      });
      return;
    }

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectionDelta = normalizedValue.length - nextRawValue.length;

    updateTextareaValueWithSelection(
      textarea,
      setValue,
      normalizedValue,
      selectionStart,
      Math.max(selectionStart, selectionEnd + selectionDelta),
      textarea.scrollTop,
    );

    requestAnimationFrame(() => {
      setSelectionState(getEditorSelectionState(textarea));
    });
  };

  const activeEntryCategory = entryForm.categoria.trim()
    ? categoryMap.get(entryForm.categoria.trim().toLowerCase())
    : undefined;
  const entryEditorColorKey = (
    entryForm.categoryColor ||
    activeEntryCategory?.color ||
    'blue'
  ) as CategoryColorKey;
  const entryThemeVars = buildThemeVars(entryEditorColorKey);
  const categoryThemeVars = buildThemeVars(categoryForm?.color ?? 'blue');
  const clearAllFilters = () => {
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setActiveCategoryFilter('');
    setActiveTagFilters([]);
    setShowPinnedOnly(false);
    setResultSortMode('pinned-latest');
    setActiveView('home');
  };
  const handleOpenSettingsView = () => {
    setActiveView('settings');
  };
  const handleOpenTemplatesView = () => {
    setActiveView('templates');
  };
  const handleToggleHomeCategoryCollapse = (categoryName: string) => {
    setCollapsedHomeCategories((currentCollapsedCategories) =>
      currentCollapsedCategories.includes(categoryName)
        ? currentCollapsedCategories.filter(
            (currentCategoryName) => currentCategoryName !== categoryName,
          )
        : [...currentCollapsedCategories, categoryName],
    );
  };

  const scrollToHomeCategory = (categoryName: string) => {
    const targetCategoryElement = homeCategoryRefs.current[categoryName];

    if (!targetCategoryElement) {
      return;
    }

    if (collapsedHomeCategories.includes(categoryName)) {
      setCollapsedHomeCategories((currentCollapsedCategories) =>
        currentCollapsedCategories.filter(
          (currentCategoryName) => currentCategoryName !== categoryName,
        ),
      );
    }

    window.requestAnimationFrame(() => {
      targetCategoryElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  const renderTemplateCard = (
    template: EntryTemplate,
    variant: 'catalog' | 'home-favorite' = 'catalog',
  ) => {
    const isHomeFavorite = variant === 'home-favorite';
    const isCompactTemplateCard = isCompactViewEnabled || isHomeFavorite;
    const visibleTagLimit = isCompactTemplateCard ? 4 : 6;
    const iconActionButtonClass = `inline-flex items-center justify-center rounded-xl border bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 ${
      isCompactTemplateCard ? 'h-10 w-10' : 'h-11 w-11'
    }`;

    return (
      <div
        key={template.id}
        role="button"
        tabIndex={0}
        onClick={() => openEditTemplateModal(template)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openEditTemplateModal(template);
          }
        }}
        aria-label={`Editar plantilla ${template.name}`}
        className={`cursor-pointer rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-sky-300 hover:bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40 dark:hover:bg-slate-900 ${
          isCompactTemplateCard ? 'p-3.5' : 'p-4'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4
                className={`truncate font-semibold text-slate-900 dark:text-slate-100 ${
                  isCompactTemplateCard ? 'text-sm' : 'text-base'
                }`}
              >
                {template.name}
              </h4>
              {template.isFavorite ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.2 3.693a1 1 0 0 0 .95.69h3.88c.969 0 1.371 1.24.588 1.81l-3.14 2.282a1 1 0 0 0-.364 1.118l1.2 3.694c.3.921-.755 1.688-1.539 1.118l-3.14-2.282a1 1 0 0 0-1.176 0l-3.14 2.282c-.783.57-1.838-.197-1.539-1.118l1.2-3.694a1 1 0 0 0-.364-1.118L2.43 9.12c-.783-.57-.38-1.81.588-1.81h3.88a1 1 0 0 0 .95-.69l1.2-3.693Z" />
                  </svg>
                  Favorita
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {template.categoria
                ? `Sección sugerida: ${template.categoria}`
                : 'Reutilizable en distintas secciones'}
            </p>
          </div>

          <button
            type="button"
            aria-pressed={template.isFavorite}
            onClick={(event) => {
              event.stopPropagation();
              handleToggleFavoriteTemplate(template.id);
            }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border ${
              isCompactTemplateCard ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
            } font-medium transition-colors ${
              template.isFavorite
                ? 'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:border-amber-300 dark:hover:bg-amber-500/15'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-sky-400/30 dark:hover:bg-sky-500/10 dark:hover:text-sky-200'
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill={template.isFavorite ? 'currentColor' : 'none'}
              className="h-4 w-4"
            >
              <path
                d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.2 3.693a1 1 0 0 0 .95.69h3.88c.969 0 1.371 1.24.588 1.81l-3.14 2.282a1 1 0 0 0-.364 1.118l1.2 3.694c.3.921-.755 1.688-1.539 1.118l-3.14-2.282a1 1 0 0 0-1.176 0l-3.14 2.282c-.783.57-1.838-.197-1.539-1.118l1.2-3.694a1 1 0 0 0-.364-1.118L2.43 9.12c-.783-.57-.38-1.81.588-1.81h3.88a1 1 0 0 0 .95-.69l1.2-3.693Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            {template.isFavorite ? 'Quitar' : 'Favorita'}
          </button>
        </div>

        {template.tags.length ? (
          <div className={`mt-3 flex flex-wrap ${isCompactTemplateCard ? 'gap-1.5' : 'gap-2'}`}>
            {template.tags.slice(0, visibleTagLimit).map((tag) => (
              <span
                key={`${template.id}-${tag}`}
                className={`inline-flex rounded-full border border-slate-200 bg-slate-50 font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 ${
                  isCompactTemplateCard ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
                }`}
              >
                #{tag}
              </span>
            ))}
            {template.tags.length > visibleTagLimit ? (
              <span className={`inline-flex rounded-full border border-slate-200 bg-slate-50 font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 ${
                isCompactTemplateCard ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
              }`}>
                +{template.tags.length - visibleTagLimit}
              </span>
            ) : null}
          </div>
        ) : null}

        <div
          className={`mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/30 ${
            isCompactTemplateCard ? 'max-h-32 p-2.5' : 'max-h-40 p-3'
          }`}
        >
          <div className="pointer-events-none text-sm leading-6 text-slate-600 dark:text-slate-300">
            <MarkdownRenderer content={template.contenido} />
          </div>
        </div>

        <div className={`mt-4 flex flex-wrap ${isCompactTemplateCard ? 'gap-1.5' : 'gap-2'}`}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openCreateEntryWithTemplate(template);
            }}
            className={`rounded-xl border border-emerald-600 bg-emerald-600 font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500 ${
              isCompactTemplateCard ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-sm'
            }`}
          >
            Usar en ficha
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openDuplicateTemplateModal(template);
            }}
            aria-label={`Duplicar plantilla ${template.name}`}
            title={`Duplicar plantilla ${template.name}`}
            className={`${iconActionButtonClass} border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:border-violet-400/60 dark:hover:bg-violet-500/15 dark:hover:text-violet-200`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="h-5 w-5"
            >
              <rect
                x="7"
                y="7"
                width="9"
                height="9"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M5 13H4a1 1 0 0 1-1-1V4.5a1.5 1.5 0 0 1 1.5-1.5H12a1 1 0 0 1 1 1v1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteTemplate(template.id);
            }}
            aria-label={`Eliminar plantilla ${template.name}`}
            title={`Eliminar plantilla ${template.name}`}
            className={`${iconActionButtonClass} border-red-300 bg-red-50 text-red-700 hover:border-red-400 hover:bg-red-100 hover:text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300 dark:hover:border-red-400/60 dark:hover:bg-red-500/15 dark:hover:text-red-200`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="h-5 w-5"
            >
              <path
                d="M4.5 6h11M8 3.5h4m-6 2.5.6 9a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    );
  };
  const handleSaveCustomization = ({
    customization: nextCustomization,
    quickViews: nextQuickViews,
  }: {
    customization: AppCustomizationSettings;
    quickViews: QuickViewDefinition[];
  }) => {
    updateManualData((currentManualData) => ({
      ...currentManualData,
      settings: {
        ...currentManualData.settings,
        customization: normalizeCustomization(nextCustomization),
        quickViews: normalizeQuickViews(nextQuickViews),
      },
    }));
    setActiveView('home');
  };
  const handleCategoryFilter = (categoryName: string) => {
    setActiveView('home');
    setActiveCategoryFilter(categoryName);
    setResultSortMode('custom');
  };
  const isQuickViewActive = (quickView: QuickViewDefinition) =>
    (quickView.categoryName ?? '') === activeCategoryFilter &&
    (quickView.searchTerm ?? '') === searchTerm &&
    Boolean(quickView.showPinnedOnly) === showPinnedOnly;
  const applyQuickView = (quickView: QuickViewDefinition) => {
    setActiveView('home');
    setSearchTerm(quickView.searchTerm ?? '');
    setDebouncedSearchTerm(quickView.searchTerm ?? '');
    setActiveCategoryFilter(quickView.categoryName ?? '');
    setActiveTagFilters([]);
    setShowPinnedOnly(Boolean(quickView.showPinnedOnly));
    setResultSortMode(
      quickView.showPinnedOnly
        ? 'pinned-latest'
        : quickView.categoryName
          ? 'custom'
          : 'pinned-latest',
    );
  };
  const handleTagFilter = (tag: string) => {
    setActiveView('home');
    setActiveTagFilters((currentTags) => {
      const normalizedTag = tag.toLowerCase();
      return currentTags.includes(normalizedTag)
        ? currentTags.filter((currentTag) => currentTag !== normalizedTag)
        : [...currentTags, normalizedTag];
    });
  };
  const handleSearchTermChange = (value: string) => {
    setActiveView('home');
    setSearchTerm(value);
  };
  const syncEditorSelectionState = (
    textarea: HTMLTextAreaElement | null,
    setSelectionState: (nextState: EditorSelectionState) => void,
  ) => {
    setSelectionState(getEditorSelectionState(textarea));
  };
  const buildToolbarContextLabel = (selectionState: EditorSelectionState) =>
    selectionState.hasSelection
      ? `Seleccion activa: ${selectionState.selectedLines} ${selectionState.selectedLines === 1 ? 'linea' : 'lineas'} y ${selectionState.selectedCharacters} ${selectionState.selectedCharacters === 1 ? 'caracter' : 'caracteres'}. Los botones de estructura se aplican al bloque seleccionado.`
      : 'Sin seleccion: los botones de estructura actuan sobre la linea actual y los de formato insertan o envuelven contenido en el cursor.';
  // Recordatorio: Si se implementa una lÃ³gica Java para la persistencia de estos cambios o el procesado de comandos en el servidor, es obligatorio utilizar try-catch-resources para el cierre seguro de flujos de datos y configuraciÃ³n.
  const toolbarContainerStyle = {
    ...entryThemeVars,
    borderColor: getCategoryColorHex(entryEditorColorKey),
    boxShadow: `0 0 0 1px ${hexToRgba(getCategoryColorHex(entryEditorColorKey), 0.2)}, 0 0 14px ${hexToRgba(getCategoryColorHex(entryEditorColorKey), 0.08)}`,
  } as CSSProperties;
  const createToolbarActions = (
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    currentValue: string,
    setValue: (value: string) => void,
    syncSelectionState: () => void,
  ): ToolbarAction[] => {
    const runToolbarAction = (action: () => void) => () => {
      action();
      requestAnimationFrame(() => {
        syncSelectionState();
      });
    };

    return [
      {
        buttonLabel: 'Negrita',
        icon: 'B',
        label: '**Negrita**',
        shortcut: 'Ctrl+B',
        onClick: runToolbarAction(() =>
          updateContentSelection(
            textareaRef.current,
            currentValue,
            setValue,
            '**',
            '**',
          )),
      },
      {
        buttonLabel: 'Codigo',
        icon: '<>',
        label: '> Codigo',
        onClick: runToolbarAction(() =>
          updateContentSelection(
            textareaRef.current,
            currentValue,
            setValue,
            '```java\n',
            '\n```',
          )),
      },
      {
        buttonLabel: 'Imagen',
        icon: '[]',
        label: '![Imagen]()',
        onClick: runToolbarAction(() =>
          updateContentSelection(
            textareaRef.current,
            currentValue,
            setValue,
            '![',
            ']()',
          )),
      },
      {
        buttonLabel: 'Enlace',
        icon: 'lnk',
        label: 'Enlace',
        shortcut: 'Ctrl+K',
        onClick: runToolbarAction(() =>
          updateContentSelection(
            textareaRef.current,
            currentValue,
            setValue,
            '[',
            ']()',
          )),
      },
      {
        buttonLabel: 'Lista',
        icon: '*',
        label: 'Lista',
        shortcut: 'Ctrl+Shift+8',
        onClick: runToolbarAction(() =>
          prefixCurrentOrSelectedLines(
            textareaRef.current,
            currentValue,
            setValue,
            () => '- ',
          )),
      },
      {
        buttonLabel: 'Numerada',
        icon: '1.',
        label: 'Numerada',
        shortcut: 'Ctrl+Shift+7',
        onClick: runToolbarAction(() =>
          prefixCurrentOrSelectedLines(
            textareaRef.current,
            currentValue,
            setValue,
            (lineIndex) => `${lineIndex + 1}. `,
          )),
      },
      {
        buttonLabel: 'Tab',
        icon: '>>',
        label: 'Tab',
        onClick: runToolbarAction(() =>
          indentSelectedLines(
            textareaRef.current,
            currentValue,
            setValue,
          )),
      },
      {
        buttonLabel: 'Ajuste',
        icon: '<>',
        label: 'Ajuste de linea',
        onClick: runToolbarAction(() =>
          wrapMarkdownSelection(
            textareaRef.current,
            currentValue,
            setValue,
          )),
      },
      {
        buttonLabel: 'Salto',
        icon: '//',
        label: 'Salto',
        onClick: runToolbarAction(() =>
          insertTextAtCursor(
            textareaRef.current,
            currentValue,
            setValue,
            '\n\n',
          )),
      },
      {
        buttonLabel: 'H1',
        icon: 'H1',
        label: 'Título 1',
        shortcut: 'Ctrl+Alt+1',
        onClick: runToolbarAction(() =>
          prefixCurrentOrSelectedLines(
            textareaRef.current,
            currentValue,
            setValue,
            () => '# ',
          )),
      },
      {
        buttonLabel: 'H2',
        icon: 'H2',
        label: 'Título 2',
        shortcut: 'Ctrl+Alt+2',
        onClick: runToolbarAction(() =>
          prefixCurrentOrSelectedLines(
            textareaRef.current,
            currentValue,
            setValue,
            () => '## ',
          )),
      },
      {
        buttonLabel: 'H3',
        icon: 'H3',
        label: 'Título 3',
        shortcut: 'Ctrl+Alt+3',
        onClick: runToolbarAction(() =>
          prefixCurrentOrSelectedLines(
            textareaRef.current,
            currentValue,
            setValue,
            () => '### ',
          )),
      },
      {
        buttonLabel: 'Seccion',
        icon: '§',
        label: 'Seccion',
        onClick: runToolbarAction(() =>
          prefixCurrentOrSelectedLines(
            textareaRef.current,
            currentValue,
            setValue,
            () => '## ',
          )),
      },
      {
        buttonLabel: 'Tabla',
        icon: '::',
        label: 'Tabla',
        onClick: runToolbarAction(() =>
          insertSnippetAtCursor(
            textareaRef.current,
            currentValue,
            setValue,
            '|  |  |\n| --- | --- |\n|  |  |',
            2,
          )),
      },
    ];
  };
  const handleToolbarActionClick = (actionIndex: number, action: ToolbarAction) => {
    action.onClick();
    const actionKey = `${actionIndex}`;
    setActiveToolbarActionId(actionKey);
    window.setTimeout(() => {
      setActiveToolbarActionId((currentValue) =>
        currentValue === actionKey ? '' : currentValue,
      );
    }, 240);
  };

  // Recordatorio: Si se implementa una logica Java para personalizar estas barras de herramientas o cargar macros de texto dinamicas, es obligatorio utilizar try-catch-resources para el cierre seguro de flujos de configuracion de la interfaz.
  const toolbarActions = createToolbarActions(
    contentEditorRef,
    entryForm.contenido,
    (nextValue) =>
      setEntryForm((current) => ({ ...current, contenido: nextValue })),
    () => syncEditorSelectionState(contentEditorRef.current, setContentEditorSelection),
  );
  const templateToolbarActions = createToolbarActions(
    templateContentEditorRef,
    templateForm?.contenido ?? '',
    (nextValue) =>
      setTemplateForm((current) =>
        current ? { ...current, contenido: nextValue } : current,
      ),
    () =>
      syncEditorSelectionState(
        templateContentEditorRef.current,
        setTemplateEditorSelection,
      ),
  );
  const entryEditorViewModeOptions: Array<{
    label: string;
    value: EntryEditorViewMode;
  }> = [
    { label: 'Editor', value: 'editor' },
    { label: 'Vista previa', value: 'preview' },
    { label: 'Dividido', value: 'split' },
  ];
  const showEntryEditorPane = isEntryEditorFocused
    ? true
    : entryEditorViewMode !== 'preview';
  const showEntryPreviewPane = isEntryEditorFocused
    ? false
    : entryEditorViewMode !== 'editor';
  const showFocusedEntryEditor = isEntryEditorFocused && showEntryEditorPane;
  const renderAdmonitionToolbarMenu = (
    menuId: 'entry' | 'template',
    textarea: HTMLTextAreaElement | null,
    currentValue: string,
    setValue: (nextValue: string) => void,
    syncSelectionState: () => void,
  ) => {
    const isOpen = activeBlockMenu === menuId;

    return (
      <div className="relative">
        <button
          type="button"
          onClick={() =>
            setActiveBlockMenu((currentValue) =>
              currentValue === menuId ? '' : menuId,
            )
          }
          aria-expanded={isOpen}
          aria-haspopup="menu"
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-all duration-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 ${
            isOpen ? 'shadow-sm' : ''
          }`}
        >
          <span className="font-mono text-[11px]" aria-hidden="true">
            []
          </span>
          <span>Bloque</span>
        </button>

        {isOpen ? (
          <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="grid gap-1">
              {admonitionBlockOptions.map((option) => (
                <button
                  key={`${menuId}-${option.kind}`}
                  type="button"
                  onClick={() => {
                    insertAdmonitionBlockAtCursor(
                      textarea,
                      currentValue,
                      setValue,
                      option.kind,
                    );
                    setActiveBlockMenu('');
                    requestAnimationFrame(() => {
                      syncSelectionState();
                    });
                  }}
                  className={`rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${option.colorClassName}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };
  const sidebarContent = (
    <SidebarUtilities
      customization={customization}
      onEmptyTrash={handleEmptyTrash}
      onRestoreCategory={handleRestoreCategory}
      onRestoreEntry={handleRestoreEntry}
      restorableCategories={restorableTrashCategories}
      trashEntries={manualData.trash}
    />
  );

  // Recordatorio: Para cualquier proceso en Java que gestione la configuraciÃ³n de estos iconos o estados de usuario, es obligatorio utilizar try-catch-resources para el cierre seguro de flujos de datos.
  const saveStatusLabel =
    hasSaveConflict
      ? 'Conflicto de guardado'
      : saveSyncState === 'error'
      ? 'Error al guardar'
      : saveSyncState === 'pending'
        ? 'Pendiente de guardar'
        : saveSyncState === 'saving'
          ? 'Guardando...'
          : saveSyncState === 'saved' && lastSavedAt
            ? `Guardado a las ${lastSavedAt}`
            : 'Sin cambios';
  const saveStatusTone =
    hasSaveConflict
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
      : saveSyncState === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
      : saveSyncState === 'saved'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
        : saveSyncState === 'saving' || saveSyncState === 'pending'
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300';
  const serverStatusLabel =
    serverHealthState === 'online'
      ? 'Servidor OK'
      : serverHealthState === 'offline'
        ? 'Servidor KO'
        : 'Comprobando servidor';
  const serverStatusTone =
    serverHealthState === 'online'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
      : serverHealthState === 'offline'
        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
        : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300';
  const storageStatusLabel =
    hasSaveConflict
      ? 'Conflicto con otra sesión'
      : saveSyncState === 'error'
      ? 'Cambios aún no sincronizados'
      : saveSyncState === 'saving' || saveSyncState === 'pending'
        ? 'Pendiente de sincronizar con disco'
        : manualOriginState === 'server'
          ? 'Cargado desde disco'
          : manualOriginState === 'local-storage'
            ? 'Recuperado desde guardado local'
            : 'Cargado desde base inicial';
  const storageStatusTone =
    hasSaveConflict
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
      : saveSyncState === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
      : saveSyncState === 'saving' || saveSyncState === 'pending'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
        : manualOriginState === 'server'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
        : manualOriginState === 'local-storage'
            ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200'
            : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300';
  const diagnosticsSnapshot: AppDiagnosticsSnapshot = {
    approximateSizeKb: Math.max(1, Math.round(JSON.stringify(manualData).length / 1024)),
    categoriesCount: manualData.categories.length,
    dataOriginLabel: storageStatusLabel,
    entriesCount: manualData.entries.length,
    hasSaveConflict,
    lastSavedAt,
    redoDepth: redoStack.length,
    revisionLabel: manualServerRevisionRef.current || 'sin revision remota',
    saveStatusLabel,
    serverStatusLabel,
    templatesCount: manualData.templates.length,
    trashCount: manualData.trash.length,
    undoDepth: undoStack.length,
  };
  const renderHeaderStatusBadge = (
    label: string,
    tone: string,
    icon: 'server' | 'storage' | 'save',
  ) => {
    const iconMarkup =
      icon === 'server' ? (
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/70 ring-1 ring-current/10 dark:bg-slate-950/30"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.6">
            <rect x="4" y="4" width="12" height="4" rx="1.2" />
            <rect x="4" y="11" width="12" height="4" rx="1.2" />
            <path d="M7 6h.01M7 13h.01M10 6h4M10 13h4" strokeLinecap="round" />
          </svg>
        </span>
      ) : icon === 'storage' ? (
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/70 ring-1 ring-current/10 dark:bg-slate-950/30"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.6">
            <path d="M5 4.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
            <path d="M7 4.5v4h6v-4M8 12.5h4" strokeLinecap="round" />
          </svg>
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/70 ring-1 ring-current/10 dark:bg-slate-950/30"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.6">
            <circle cx="10" cy="10" r="5.5" />
            <path d="M10 7v3.3l2.2 1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );

    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${tone}`}
      >
        {iconMarkup}
        <span>{label}</span>
      </div>
    );
  };
  const headerStatus = (
    <>
      {renderHeaderStatusBadge(serverStatusLabel, serverStatusTone, 'server')}
      {renderHeaderStatusBadge(storageStatusLabel, storageStatusTone, 'storage')}
      {renderHeaderStatusBadge(saveStatusLabel, saveStatusTone, 'save')}
    </>
  );
  const headerActions = (
    <>
      <button
        type="button"
        onClick={() => {
          void reloadManualFromServer();
        }}
        aria-label="Recargar desde disco"
        title="Recargar desde disco"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-5 w-5"
        >
          <path
            d="M16 10a6 6 0 1 1-1.3-3.8M16 4v4h-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleUndoRecentChange}
        aria-label="Deshacer ultimo cambio"
        title={
          undoStack.length
            ? 'Deshacer ultimo cambio'
            : 'No hay cambios recientes para deshacer'
        }
        disabled={!undoStack.length}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-colors dark:bg-slate-900 ${
          undoStack.length
            ? 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white'
            : 'cursor-not-allowed border-slate-200/70 text-slate-300 dark:border-slate-800 dark:text-slate-700'
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-5 w-5"
        >
          <path
            d="M7 6 3.5 9.5 7 13M4 9.5h6.25a4.25 4.25 0 1 1 0 8.5H8.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleRedoRecentChange}
        aria-label="Rehacer ultimo cambio"
        title={
          redoStack.length
            ? 'Rehacer ultimo cambio'
            : 'No hay cambios deshechos para rehacer'
        }
        disabled={!redoStack.length}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-colors dark:bg-slate-900 ${
          redoStack.length
            ? 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white'
            : 'cursor-not-allowed border-slate-200/70 text-slate-300 dark:border-slate-800 dark:text-slate-700'
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-5 w-5"
        >
          <path
            d="m13 6 3.5 3.5L13 13M16 9.5H9.75a4.25 4.25 0 1 0 0 8.5h1.75"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={toggleCompactMode}
        aria-label={
          isCompactViewEnabled ? 'Activar vista normal' : 'Activar vista compacta'
        }
        title={
          isCompactViewEnabled ? 'Activar vista normal' : 'Activar vista compacta'
        }
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-colors dark:bg-slate-900 ${
          isCompactViewEnabled
            ? 'border-cyan-300/70 text-cyan-600 shadow-[0_0_0_4px_rgba(8,145,178,0.12)] dark:border-cyan-400/50 dark:text-cyan-300'
            : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white'
        }`}
      >
        {isCompactViewEnabled ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className="h-5 w-5"
          >
            <path
              d="M4 5.25h12M4 10h12M4 14.75h12"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className="h-5 w-5"
          >
            <path
              d="M4 4.75h5.5v4.5H4v-4.5Zm6.5 0H16v4.5h-5.5v-4.5ZM4 10.75h5.5v4.5H4v-4.5Zm6.5 0H16v4.5h-5.5v-4.5Z"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.4"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={handleOpenSettingsView}
        aria-label="Abrir configuración general"
        title="Abrir configuración general"
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-colors dark:bg-slate-900 ${
          activeView === 'settings'
            ? 'border-sky-400/70 text-sky-600 shadow-[0_0_0_4px_rgba(14,165,233,0.12)] dark:border-sky-400/50 dark:text-sky-300'
            : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white'
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-5 w-5"
        >
          <path
            d="M4 5.25h4M12 5.25h4M4 10h7M15 10h1M4 14.75h2M10 14.75h6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.7"
          />
          <circle cx="10" cy="5.25" r="1.6" fill="currentColor" />
          <circle cx="13" cy="10" r="1.6" fill="currentColor" />
          <circle cx="7" cy="14.75" r="1.6" fill="currentColor" />
        </svg>
      </button>
      <button
      type="button"
      onClick={toggleDarkMode}
      aria-label={
        manualData.settings.darkMode ? 'Activar modo claro' : 'Activar modo oscuro'
      }
      title={
        manualData.settings.darkMode ? 'Activar modo claro' : 'Activar modo oscuro'
      }
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-colors dark:bg-slate-900 ${
        manualData.settings.darkMode
          ? 'border-indigo-300/60 text-indigo-500 hover:border-indigo-400 hover:bg-indigo-50 dark:border-indigo-400/40 dark:text-indigo-400 dark:hover:bg-indigo-950/30'
          : 'border-amber-300/60 text-amber-500 hover:border-amber-400 hover:bg-amber-50 dark:border-amber-400/40 dark:text-amber-400 dark:hover:bg-amber-950/30'
      }`}
    >
      {manualData.settings.darkMode ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-5 w-5"
        >
          <path
            d="M16.5 12.5A7.2 7.2 0 0 1 7.5 3.5 7.2 7.2 0 1 0 16.5 12.5Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-5 w-5"
        >
          <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M10 1.8v2M10 16.2v2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M1.8 10h2M16.2 10h2M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.6"
          />
        </svg>
      )}
      </button>
    </>
  );

  return (
    <>
      <MainLayout
        appName={customization.appName}
        customization={customization}
        headerActions={headerActions}
        headerStatus={headerStatus}
        searchTerm={searchTerm}
        onSearchTermChange={handleSearchTermChange}
        onHomeClick={clearAllFilters}
        sidebarContent={sidebarContent}
      >
        <section ref={topContentRef} className="space-y-5 sm:space-y-6">
          {activeView === 'settings' ? (
            <AppCustomizationPanel
              categoryNames={manualData.categories.map((category) => category.name)}
              customization={customization}
              diagnostics={diagnosticsSnapshot}
              onCancel={() => setActiveView('home')}
              onExportBackup={handleExportBackup}
              onExportManual={handleExport}
              onImportBackupClick={handleImportBackupClick}
              onSave={handleSaveCustomization}
              quickViews={quickViews}
            />
          ) : activeView === 'templates' ? (
            <div
              ref={templatesSectionRef}
              tabIndex={-1}
              className="space-y-5 outline-none"
            >
              <div className="hero-shell animate-fade-in overflow-hidden rounded-[2rem] border border-slate-200 p-5 shadow-sm dark:border-slate-800 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-700 dark:text-sky-300">
                      Biblioteca de plantillas
                    </p>
                    <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                      Plantillas reutilizables
                    </h2>
                    <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-200">
                      Crea, edita y organiza las plantillas desde una pantalla propia.
                      Las favoritas son las únicas que volverán a mostrarse en la home.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2.5">
                      <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200">
                        {sortedTemplates.length} plantilla{sortedTemplates.length === 1 ? '' : 's'}
                      </span>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                        {favoriteTemplates.length} favorita{favoriteTemplates.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  <div className="relative z-10 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={openCreateTemplateModal}
                      className="inline-flex items-center gap-2 rounded-2xl border border-sky-500/60 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-700 transition-colors hover:border-sky-500 hover:bg-sky-500/15 hover:text-sky-800 dark:border-sky-400/50 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:border-sky-300 dark:hover:bg-sky-400/15 dark:hover:text-sky-200"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="none"
                        className="h-5 w-5"
                      >
                        <path
                          d="M6 3.5h8a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 14 16.5H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5Z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        />
                        <path
                          d="M7.5 7h5M7.5 10h5M7.5 13h3"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                      Nueva plantilla
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('home')}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      Volver a la Home
                    </button>
                  </div>
                </div>
              </div>

              <section className="rounded-3xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm dark:border-sky-400/20 dark:bg-sky-500/10">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-700 dark:text-sky-300">
                      Búsqueda y filtros
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      Encuentra plantillas por nombre, contenido, sección o favoritas.
                    </p>
                  </div>
                  <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-800 shadow-sm dark:border-sky-400/30 dark:bg-slate-950/70 dark:text-sky-200">
                    {filteredTemplates.length} resultado{filteredTemplates.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_220px_auto]">
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1 space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                      Buscar plantilla
                      <input
                        value={templateSearchTerm}
                        onChange={(event) => setTemplateSearchTerm(event.target.value)}
                        placeholder="Nombre, título, tag o contenido..."
                        className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                    <SearchHelpButton
                      title="Ayuda del buscador de plantillas"
                      description="Encuentra plantillas por nombre, contenido, seccion, tags o estado de favorita."
                      items={[
                        {
                          title: 'Nombre y titulo',
                          description: 'Busca por palabras clave relacionadas con el nombre o el titulo sugerido de la plantilla.',
                        },
                        {
                          title: 'Contenido y pasos',
                          description: 'Tambien localiza texto dentro del contenido base y de los pasos sugeridos.',
                        },
                        {
                          title: 'Seccion y tags',
                          description: 'Combina el texto con el filtro por seccion o con los tags para acotar mas rapido.',
                        },
                        {
                          title: 'Favoritas',
                          description: 'Activa Solo favoritas para quedarte solo con las plantillas marcadas como destacadas.',
                        },
                      ]}
                    />
                  </div>

                  <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    Filtrar por sección
                    <select
                      value={templateCategoryFilter}
                      onChange={(event) => setTemplateCategoryFilter(event.target.value)}
                      className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    >
                      <option value="">Todas las secciones</option>
                      {manualData.categories.map((category) => (
                        <option key={category.name} value={category.name}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-wrap items-end gap-3">
                    <label className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={showFavoriteTemplatesOnly}
                        onChange={(event) => setShowFavoriteTemplatesOnly(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      Solo favoritas
                    </label>
                    {(templateSearchTerm || templateCategoryFilter || showFavoriteTemplatesOnly) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTemplateSearchTerm('');
                          setTemplateCategoryFilter('');
                          setShowFavoriteTemplatesOnly(false);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                      >
                        Limpiar
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>

              {sortedTemplates.length ? (
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                        Todas las plantillas
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Arrastra las tarjetas para reordenarlas. Las favoritas seguirán este mismo orden en la home.
                      </p>
                    </div>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Marca como favoritas las que quieras tener a mano en la home
                    </span>
                  </div>
                  {filteredTemplates.length ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {filteredTemplates.map((template) => (
                        <div
                          key={template.id}
                          draggable
                          onDragStart={(event) => {
                            setDraggedTemplateId(template.id);
                            setDragOverTemplateId(template.id);
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', template.id);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (dragOverTemplateId !== template.id) {
                              setDragOverTemplateId(template.id);
                            }
                            event.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            handleTemplateDrop(template.id);
                          }}
                          onDragEnd={() => {
                            setDraggedTemplateId('');
                            setDragOverTemplateId('');
                          }}
                          className={`rounded-2xl transition-all duration-200 ${
                            dragOverTemplateId === template.id
                              ? 'scale-[1.01] ring-2 ring-sky-400/70 ring-offset-2 ring-offset-slate-100 dark:ring-sky-400/60 dark:ring-offset-slate-950'
                              : 'cursor-grab active:cursor-grabbing'
                          }`}
                        >
                          {renderTemplateCard(template)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                      No hay plantillas para la combinación actual de búsqueda y filtros. Usa Limpiar para volver a ver todo el catálogo.
                    </div>
                  )}
                </section>
              ) : (
                <section className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Aún no hay plantillas
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Crea la primera plantilla para reutilizar contenido y tener tus
                    estructuras favoritas siempre a mano.
                  </p>
                  <button
                    type="button"
                    onClick={openCreateTemplateModal}
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-sky-600 bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-sky-700 hover:bg-sky-700 dark:border-sky-500 dark:bg-sky-600 dark:hover:border-sky-400 dark:hover:bg-sky-500"
                  >
                    Crear primera plantilla
                  </button>
                </section>
              )}
            </div>
          ) : hasActiveFilters ? (
            <div
              ref={resultsSectionRef}
              tabIndex={-1}
              className="space-y-4 outline-none"
            >
              <div
                className="hero-shell animate-fade-in overflow-hidden rounded-[2rem] border border-slate-200 p-5 shadow-sm dark:border-slate-800 sm:p-6"
                style={activeResultThemeVars}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-700 dark:text-sky-300">
                    Navegacion activa
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">
                    Resultados
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {results.length} resultado{results.length === 1 ? '' : 's'} para{' '}
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {searchTerm.trim().length ? `"${searchTerm}"` : 'los filtros activos'}
                    </span>.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {activeResultCategory ? (
                      <span
                        className="section-gradient-pill inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-slate-800 dark:text-slate-100"
                        style={activeResultThemeVars}
                      >
                        Seccion activa: {activeResultCategory.name}
                      </span>
                    ) : null}
                    {activeTagFilters.length ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200">
                        Tags activos: {activeTagFilters.map((tag) => `#${tag}`).join(', ')}
                      </span>
                    ) : null}
                    {showPinnedOnly ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
                        Solo ancladas
                      </span>
                    ) : null}
                    {resultSortMode !== 'pinned-latest' ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        Orden: {resultSortMode === 'latest'
                          ? 'Mas recientes'
                          : resultSortMode === 'oldest'
                            ? 'Mas antiguas'
                            : 'Título'}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="sidebar-soft-button inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                    >
                      Limpiar filtro
                    </button>
                    {quickViews.map((quickView) => (
                      <button
                        key={quickView.id}
                        type="button"
                        onClick={() => applyQuickView(quickView)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          isQuickViewActive(quickView)
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                            : getQuickViewToneClass(quickView.tone)
                        }`}
                      >
                        {quickView.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    <span>Ordenar</span>
                    <select
                      value={resultSortMode}
                      onChange={(event) =>
                        setResultSortMode(event.target.value as ResultSortMode)
                      }
                      className="rounded-lg bg-white/90 px-2 py-1 text-sm text-slate-800 outline-none transition-colors dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="custom" className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">Personalizado</option>
                      <option value="pinned-latest" className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">Ancladas + recientes</option>
                      <option value="latest" className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">Mas recientes</option>
                      <option value="oldest" className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">Mas antiguas</option>
                      <option value="title" className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">Título</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowPinnedOnly((currentValue) => !currentValue)}
                    className={`rounded-2xl border px-4 py-2 text-sm font-medium transition-colors ${
                      showPinnedOnly
                        ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-400/50 dark:bg-amber-500/10 dark:text-amber-200'
                        : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                    }`}
                  >
                    {showPinnedOnly ? 'Ver todas' : 'Solo ancladas'}
                  </button>

                  {activeResultCategory ? (
                    <button
                      type="button"
                      onClick={() =>
                        openCreateEntryModal(activeResultCategory.name, true)
                      }
                      className="section-gradient-pill inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:text-slate-900 dark:text-slate-100 dark:hover:text-white"
                      style={activeResultThemeVars}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="none"
                        className="h-5 w-5"
                      >
                        <path
                          d="M10 4v12M4 10h12"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                      Añadir ficha a {activeResultCategory.name}
                    </button>
                  ) : null}
                </div>
              </div>
              {activeResultCategory ? (
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Arrastra las fichas dentro de esta sección para guardar un orden personalizado.
                </p>
              ) : null}
              </div>

              {sortedResults.length ? (
                <div className="grid gap-3">
                  {sortedResults.map((entry) => {
                    const category = categoryMap.get(entry.categoria.toLowerCase());
                    const canDragResultCard =
                      Boolean(activeCategoryFilter) &&
                      entry.categoria.toLowerCase() === activeCategoryFilter.toLowerCase();
                    const isDragOverResultCard = dragOverResultEntryId === entry.id;

                    return (
                      <div
                        key={entry.id}
                        draggable={canDragResultCard}
                        onDragStart={(event) => {
                          if (!canDragResultCard) {
                            return;
                          }

                          setDraggedResultEntryId(entry.id);
                          setDragOverResultEntryId(entry.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', entry.id);
                        }}
                        onDragOver={(event) => {
                          if (!canDragResultCard) {
                            return;
                          }

                          event.preventDefault();
                          if (dragOverResultEntryId !== entry.id) {
                            setDragOverResultEntryId(entry.id);
                          }
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(event) => {
                          if (!canDragResultCard) {
                            return;
                          }

                          event.preventDefault();
                          handleCustomResultDrop(entry.id);
                        }}
                        onDragEnd={() => {
                          setDraggedResultEntryId('');
                          setDragOverResultEntryId('');
                        }}
                        className={
                          canDragResultCard
                            ? `rounded-[1.8rem] transition-all ${
                                isDragOverResultCard
                                  ? 'scale-[1.01] ring-2 ring-sky-400/70 ring-offset-2 ring-offset-slate-100 dark:ring-sky-400/60 dark:ring-offset-slate-950'
                                  : 'cursor-grab active:cursor-grabbing'
                              }`
                            : ''
                        }
                      >
                        <ResultCard
                          activeTags={activeTagFilters}
                          categoryColorKey={category?.color}
                          compact={isCompactViewEnabled}
                          entry={entry}
                          onCommandSave={handleCommandSave}
                          onDeleteEntry={handleDeleteEntry}
                          onEditEntry={openEditEntryModal}
                          onExportPdf={openEntryPdfExportModal}
                          onTagClick={handleTagFilter}
                          onTogglePin={handleTogglePinEntry}
                          pdfIsGenerating={exportEntryId === entry.id}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="app-surface-shell rounded-[1.8rem] border border-dashed border-slate-300 px-4 py-8 text-center shadow-sm dark:border-slate-700 sm:px-6 sm:py-10">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    No hay resultados para la vista actual
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Ajusta la búsqueda, cambia los filtros activos o pulsa{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      Limpiar filtro
                    </span>{' '}
                    para volver al listado completo.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
            <div className="hero-shell animate-fade-in overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="hero-grid relative p-5 sm:p-6 lg:p-8">
                <div className="hero-orb hero-orb-primary" aria-hidden="true" />
                <div className="hero-orb hero-orb-secondary" aria-hidden="true" />

                <div className="relative z-10 space-y-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-4">
                        <AppLogo
                          appIconDataUrl={customization.appIconDataUrl}
                          appName={customization.appName}
                          className="h-16 w-16 shrink-0 sm:h-20 sm:w-20"
                        />
                        <div className="min-w-0">
                          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-700 dark:text-sky-300">
                            Centro operativo
                          </p>
                          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-3xl lg:text-[2.5rem]">
                            {customization.heroTitle}
                          </h2>
                        </div>
                      </div>
                    </div>

                    <div className="relative z-10 flex flex-wrap gap-3 lg:shrink-0">
                      <button
                        type="button"
                        onClick={handleOpenTemplatesView}
                        className="inline-flex items-center gap-2 rounded-2xl border border-sky-500/60 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-700 transition-colors hover:border-sky-500 hover:bg-sky-500/15 hover:text-sky-800 dark:border-sky-400/50 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:border-sky-300 dark:hover:bg-sky-400/15 dark:hover:text-sky-200"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          fill="none"
                          className="h-5 w-5"
                        >
                          <path
                            d="M6 3.5h8a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 14 16.5H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                          <path
                            d="M7.5 7h5M7.5 10h5M7.5 13h3"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                        Plantillas
                      </button>
                      <button
                        type="button"
                        onClick={openCreateCategoryModal}
                        className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/60 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-700 transition-colors hover:border-emerald-500 hover:bg-emerald-500/15 hover:text-emerald-800 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:border-emerald-300 dark:hover:bg-emerald-400/15 dark:hover:text-emerald-200"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          fill="none"
                          className="h-5 w-5"
                        >
                          <path
                            d="M10 4v12M4 10h12"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeWidth="1.8"
                          />
                        </svg>
                        Nueva Seccion
                      </button>
                    </div>
                  </div>

                  <div className="max-w-none">
                    <p className="text-base leading-7 text-slate-600 dark:text-slate-200 sm:text-lg">
                      {customization.heroDescription}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2.5">
                      <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200">
                        Manuales versionados
                      </span>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 shadow-sm dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200">
                        Busqueda operativa
                      </span>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                        Plantillas reutilizables
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2.5">
                      {quickViews.map((quickView) => (
                        <button
                          key={quickView.id}
                          type="button"
                          onClick={() => applyQuickView(quickView)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
                            isQuickViewActive(quickView)
                              ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                              : getQuickViewToneClass(quickView.tone)
                          }`}
                        >
                          {quickView.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              </div>

              <div className="border-t border-slate-200/80 bg-slate-50/80 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40 sm:px-6 lg:px-8">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:items-center">
                  <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-900 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-100">
                    <span className="text-base leading-none" aria-hidden="true">
                      *
                    </span>
                    <p className="font-medium leading-5">
                      Recordatorio: {customization.reminderText}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Secciones
                      </p>
                      <p className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-white">
                        {manualData.categories.length}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Fichas
                      </p>
                      <p className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-white">
                        {manualData.entries.length}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Plantillas
                      </p>
                      <p className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-white">
                        {manualData.templates.length}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {quickAccessEntries.length ? (
                <section className="mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                        Acceso rápido
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {quickAccessEntries.length} ficha{quickAccessEntries.length === 1 ? '' : 's'} anclada{quickAccessEntries.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {quickAccessEntries.length > HOME_PINNED_ENTRY_PREVIEW_LIMIT &&
                      !isQuickAccessCollapsed ? (
                        <button
                          type="button"
                          onClick={() =>
                            setShowAllQuickAccessEntries((currentValue) => !currentValue)
                          }
                          className="text-xs font-semibold text-sky-700 transition-colors hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
                        >
                          {showAllQuickAccessEntries ? 'Ver menos' : `Ver más (${quickAccessEntries.length - HOME_PINNED_ENTRY_PREVIEW_LIMIT})`}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          setIsQuickAccessCollapsed((currentValue) => !currentValue)
                        }
                        className="text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                      >
                        {isQuickAccessCollapsed ? 'Expandir' : 'Colapsar'}
                      </button>
                    </div>
                  </div>
                  {!isQuickAccessCollapsed ? (
                    <div className="mt-3 grid gap-3">
                      {visibleQuickAccessEntries.map((entry) => {
                        const category = categoryMap.get(entry.categoria.toLowerCase());

                        return (
                        <ResultCard
                            activeTags={activeTagFilters}
                            key={entry.id}
                            categoryColorKey={category?.color}
                            compact={isCompactViewEnabled}
                            entry={entry}
                            onCommandSave={handleCommandSave}
                            onDeleteEntry={handleDeleteEntry}
                            onEditEntry={openEditEntryModal}
                            onExportPdf={openEntryPdfExportModal}
                            onTagClick={handleTagFilter}
                            onTogglePin={handleTogglePinEntry}
                            pdfIsGenerating={exportEntryId === entry.id}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {sortedTemplates.length ? (
                <section className="mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                      Plantillas favoritas
                    </h3>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={handleOpenTemplatesView}
                        className="text-xs font-semibold text-sky-700 transition-colors hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
                      >
                        Ver todas
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setIsFavoriteTemplatesCollapsed((currentValue) => !currentValue)
                        }
                        className="text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                      >
                        {isFavoriteTemplatesCollapsed ? 'Expandir' : 'Colapsar'}
                      </button>
                    </div>
                  </div>
                  {!isFavoriteTemplatesCollapsed ? (
                    favoriteTemplates.length ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {favoriteTemplates.map((template) =>
                          renderTemplateCard(template, 'home-favorite'),
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                        Aún no tienes plantillas favoritas. Entra en la biblioteca de
                        plantillas y marca las que quieras fijar en esta pantalla.
                      </div>
                    )
                  ) : null}
                </section>
              ) : null}

              {manualData.categories.length ? (
                <section className="mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                        Indice rapido
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Salta directamente a una seccion sin recorrer toda la home.
                      </p>
                    </div>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {manualData.categories.length} seccion
                      {manualData.categories.length === 1 ? '' : 'es'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {manualData.categories.map((category) => (
                      <button
                        key={`home-index-${category.name}`}
                        type="button"
                        onClick={() => scrollToHomeCategory(category.name)}
                        className="section-gradient-pill inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:text-slate-900 dark:text-slate-100 dark:hover:text-white"
                        style={buildThemeVars(category.color)}
                      >
                        <span>{category.name}</span>
                        <span className="rounded-full border border-current/15 bg-white/70 px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-950/70">
                          {
                            manualData.entries.filter(
                              (entry) =>
                                entry.categoria.toLowerCase() ===
                                category.name.toLowerCase(),
                            ).length
                          }
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="mt-6 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                    Secciones principales
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Arrastra las tarjetas para reordenar secciones y colapsa las que no necesites.
                  </p>
                </div>
                {manualData.categories.length ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedHomeCategories((currentCollapsedCategories) =>
                        currentCollapsedCategories.length === manualData.categories.length
                          ? []
                          : manualData.categories.map((category) => category.name),
                      )
                    }
                    className="text-xs font-semibold text-sky-700 transition-colors hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
                  >
                    {collapsedHomeCategories.length === manualData.categories.length
                      ? 'Expandir todo'
                      : 'Colapsar todo'}
                  </button>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
                {manualData.categories.map((category) => {
                  const theme = getCategoryTheme(category.color);
                  const entryCount = manualData.entries.filter(
                    (entry) =>
                      entry.categoria.toLowerCase() === category.name.toLowerCase(),
                  ).length;
                  const isCollapsed = collapsedHomeCategories.includes(category.name);
                  const isDragOverCategory = dragOverHomeCategoryName === category.name;

                  return (
                    <div
                      key={category.name}
                      draggable
                      onDragStart={(event) => {
                        setDraggedHomeCategoryName(category.name);
                        setDragOverHomeCategoryName(category.name);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', category.name);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (dragOverHomeCategoryName !== category.name) {
                          setDragOverHomeCategoryName(category.name);
                        }
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleHomeCategoryDrop(category.name);
                      }}
                      onDragEnd={() => {
                        setDraggedHomeCategoryName('');
                        setDragOverHomeCategoryName('');
                      }}
                      ref={(element) => {
                        homeCategoryRefs.current[category.name] = element;
                      }}
                      className={`neon-card section-gradient-card rounded-2xl border p-4 transition-all duration-200 ${
                        isDragOverCategory
                          ? 'scale-[1.01] ring-2 ring-sky-400/70 ring-offset-2 ring-offset-slate-100 dark:ring-sky-400/60 dark:ring-offset-slate-950'
                          : 'cursor-grab active:cursor-grabbing'
                      } ${theme.chip}`}
                      style={buildThemeVars(category.color)}
                    >
                      <div className="flex items-start justify-end">
                        <div className="flex min-w-[7.5rem] shrink-0 items-center justify-end gap-1.5 sm:min-w-[8.75rem] sm:gap-2">
                          <span
                            aria-hidden="true"
                            title={`Arrastrar sección ${category.name}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-current/15 bg-white/70 text-current/80 transition-colors dark:bg-slate-950/80 sm:h-9 sm:w-9"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="none"
                              className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                            >
                              <circle cx="7" cy="6" r="1.2" fill="currentColor" />
                              <circle cx="13" cy="6" r="1.2" fill="currentColor" />
                              <circle cx="7" cy="10" r="1.2" fill="currentColor" />
                              <circle cx="13" cy="10" r="1.2" fill="currentColor" />
                              <circle cx="7" cy="14" r="1.2" fill="currentColor" />
                              <circle cx="13" cy="14" r="1.2" fill="currentColor" />
                            </svg>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleHomeCategoryCollapse(category.name)}
                            aria-label={`${isCollapsed ? 'Expandir' : 'Colapsar'} sección ${category.name}`}
                            title={`${isCollapsed ? 'Expandir' : 'Colapsar'} sección ${category.name}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-current/15 bg-white/70 text-current transition-colors hover:bg-white dark:bg-slate-950/80 dark:hover:bg-slate-900 sm:h-9 sm:w-9"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              className={`h-4 w-4 transition-transform sm:h-5 sm:w-5 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                            >
                              <path
                                d="m6 8 4 4 4-4"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => openCategoryModal(category.name)}
                            aria-label={`Editar sección ${category.name}`}
                            title={`Editar sección ${category.name}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-current/15 bg-white/70 text-current transition-colors hover:bg-white dark:bg-slate-950/80 dark:hover:bg-slate-900 sm:h-9 sm:w-9"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              className="icon-neon h-4 w-4 sm:h-5 sm:w-5"
                            >
                              <path
                                d="M10 2.5a1 1 0 0 1 1 1v.6a6.3 6.3 0 0 1 1.8.8l.4-.4a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-.4.4c.3.6.6 1.2.8 1.8h.6a1 1 0 0 1 1 1v1.4a1 1 0 0 1-1 1h-.6a6.3 6.3 0 0 1-.8 1.8l.4.4a1 1 0 0 1 0 1.4l-1 1a1 1 0 0 1-1.4 0l-.4-.4a6.3 6.3 0 0 1-1.8.8v.6a1 1 0 0 1-1 1H8.6a1 1 0 0 1-1-1v-.6a6.3 6.3 0 0 1-1.8-.8l-.4.4a1 1 0 0 1-1.4 0l-1-1a1 1 0 0 1 0-1.4l.4-.4a6.3 6.3 0 0 1-.8-1.8H2a1 1 0 0 1-1-1V9.9a1 1 0 0 1 1-1h.6a6.3 6.3 0 0 1 .8-1.8L3 6.7a1 1 0 0 1 0-1.4l1-1a1 1 0 0 1 1.4 0l.4.4a6.3 6.3 0 0 1 1.8-.8v-.6a1 1 0 0 1 1-1H10Z"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                strokeLinejoin="round"
                              />
                              <circle
                                cx="9.3"
                                cy="10.6"
                                r="2.2"
                                stroke="currentColor"
                                strokeWidth="1.2"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCategoryFilter(category.name)}
                        className="mt-3 block w-full text-left"
                      >
                        <div className="min-h-[4.25rem]">
                          <h4 className="overflow-hidden text-balance text-base font-semibold leading-5 text-slate-900 dark:text-slate-50 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
                            {category.name}
                          </h4>
                        </div>
                      </button>

                      {!isCollapsed ? (
                        <button
                          type="button"
                          onClick={() => handleCategoryFilter(category.name)}
                          className="mt-2 block w-full text-left"
                        >
                          <span className="block text-[11px] leading-5 text-slate-500 dark:text-slate-300 sm:text-xs sm:leading-5">
                            {category.description}
                          </span>
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => handleCategoryFilter(category.name)}
                        className="mt-3 block w-full text-left"
                      >
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-current/80 dark:text-slate-100">
                          {entryCount} ficha{entryCount === 1 ? '' : 's'}
                        </span>
                      </button>

                      {!isCollapsed ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openSectionPdfExportModal(category.name)}
                            disabled={!entryCount || exportSectionCategoryName === category.name}
                            className="inline-flex items-center gap-2 rounded-xl border border-sky-600 bg-sky-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:border-sky-700 hover:bg-sky-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 dark:border-sky-500 dark:bg-sky-600 dark:hover:border-sky-400 dark:hover:bg-sky-500 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              className="h-4 w-4"
                            >
                              <path
                                d="M5.5 3.5h6.7L15.5 6.8V15a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 15V5A1.5 1.5 0 0 1 5.5 3.5Z"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M12 3.8V7h3.2M7 10h5.5M7 13h4"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            {exportSectionCategoryName === category.name
                              ? 'Generando PDF...'
                              : 'PDF de sección'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </MainLayout>

      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          void handleImportBackup(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {entryPdfExportState ? (
        <div className="modal-overlay fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="modal-shell w-full max-w-xl rounded-3xl border border-slate-200 p-5 shadow-2xl dark:border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Exportar ficha a PDF
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                  Elige si quieres incluir el pie corporativo con icono, texto y numeración.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEntryPdfExportModal}
                aria-label="Cerrar exportacion individual de PDF"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="mt-5">
              <ToggleSwitch
                checked={entryPdfExportState.includeBrandingFooter}
                description="Incluye icono de Prysma, texto de generación y número de página cuando corresponda."
                label="Pie corporativo en PDF"
                onChange={(nextValue) =>
                  setEntryPdfExportState((currentState) =>
                    currentState
                      ? { ...currentState, includeBrandingFooter: nextValue }
                      : currentState,
                  )
                }
              />
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeEntryPdfExportModal}
                className="rounded-xl border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleExportEntryPdf();
                }}
                className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
              >
                Generar PDF
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sectionPdfExportState ? (
        <div className="modal-overlay fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="modal-shell w-full max-w-3xl rounded-3xl border border-slate-200 p-5 shadow-2xl dark:border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  PDF completo de sección
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                  Selecciona qué fichas de{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {sectionPdfExportState.categoryName}
                  </span>{' '}
                  quieres incluir en el documento.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSectionPdfExportModal}
                aria-label="Cerrar selector de PDF por sección"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSectionPdfExportState((currentState) =>
                      currentState
                        ? {
                            ...currentState,
                            selectedEntryIds: sectionPdfEntries.map((entry) => entry.id),
                          }
                        : currentState,
                    )
                  }
                  className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 transition-colors hover:border-sky-400 hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:border-sky-300 dark:hover:bg-sky-500/15"
                >
                  Seleccionar todas
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSectionPdfExportState((currentState) =>
                      currentState
                        ? {
                            ...currentState,
                            selectedEntryIds: [],
                          }
                        : currentState,
                    )
                  }
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                >
                  Deseleccionar todas
                </button>
              </div>

              <p className="text-sm text-slate-500 dark:text-slate-300">
                {sectionPdfExportState.selectedEntryIds.length} de {sectionPdfEntries.length} fichas seleccionadas
              </p>
            </div>

            <div className="mt-4">
              <ToggleSwitch
                checked={sectionPdfExportState.includeBrandingFooter}
                description="Incluye icono de Prysma, texto de generación y numeración al final de cada página."
                label="Pie corporativo en PDF"
                onChange={(nextValue) =>
                  setSectionPdfExportState((currentState) =>
                    currentState
                      ? { ...currentState, includeBrandingFooter: nextValue }
                      : currentState,
                  )
                }
              />
            </div>

            <div className="mt-5 max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              {sectionPdfEntries.map((entry) => {
                const isSelected = sectionPdfExportState.selectedEntryIds.includes(entry.id);

                return (
                  <label
                    key={entry.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                      isSelected
                        ? 'border-sky-300 bg-sky-50 dark:border-sky-400/30 dark:bg-sky-500/10'
                        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSectionPdfEntry(entry.id)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {entry.titulo}
                        </p>
                        <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                          {entry.id}
                        </span>
                      </div>
                      <div className="mt-2 max-h-28 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-950/30">
                        <div className="pointer-events-none text-sm leading-6 text-slate-600 dark:text-slate-300">
                          <MarkdownRenderer content={entry.contenido} />
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeSectionPdfExportModal}
                className="rounded-xl border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleExportSectionPdf();
                }}
                className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
              >
                Generar PDF
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {backupImportState ? (
        <div className="modal-overlay fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="modal-shell w-full max-w-2xl rounded-3xl border border-slate-200 p-5 shadow-2xl dark:border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Revisar backup antes de importar
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                  Revisa el contenido detectado y decide si quieres fusionarlo con
                  lo actual o reemplazar por completo el estado cargado.
                </p>
              </div>
              <button
                type="button"
                onClick={closeBackupImportModal}
                aria-label="Cerrar modal de importacion"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
              >
                X
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                  Archivo analizado
                </p>
                <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {backupImportState.fileName}
                </p>
                <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <p>
                    {backupImportState.importedManualData.categories.length} secciones
                  </p>
                  <p>{backupImportState.importedManualData.entries.length} fichas</p>
                  <p>
                    {backupImportState.importedManualData.templates.length} plantillas
                  </p>
                  <p>{backupImportState.importedManualData.trash.length} en papelera</p>
                </div>
              </div>

              <div className="space-y-3">
                {backupImportSummary ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                      Impacto estimado
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-400/20 dark:bg-emerald-500/10">
                        <p className="font-semibold text-emerald-800 dark:text-emerald-200">
                          {backupImportSummary.newEntries}
                        </p>
                        <p className="text-emerald-700 dark:text-emerald-300">fichas nuevas</p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-400/20 dark:bg-emerald-500/10">
                        <p className="font-semibold text-emerald-800 dark:text-emerald-200">
                          {backupImportSummary.newTemplates}
                        </p>
                        <p className="text-emerald-700 dark:text-emerald-300">plantillas nuevas</p>
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-400/20 dark:bg-sky-500/10">
                        <p className="font-semibold text-sky-800 dark:text-sky-200">
                          {backupImportSummary.newCategories}
                        </p>
                        <p className="text-sky-700 dark:text-sky-300">secciones nuevas</p>
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-400/20 dark:bg-sky-500/10">
                        <p className="font-semibold text-sky-800 dark:text-sky-200">
                          {backupImportSummary.newTrashEntries}
                        </p>
                        <p className="text-sky-700 dark:text-sky-300">entradas en papelera</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                      <p>
                        Coincidencias de sección: {backupImportSummary.matchingCategories}
                      </p>
                      <p>
                        Coincidencias por ID de ficha: {backupImportSummary.conflictingEntryIds}
                      </p>
                      <p>
                        Coincidencias por título de ficha: {backupImportSummary.conflictingEntryTitles}
                      </p>
                      <p>
                        Coincidencias por ID de plantilla: {backupImportSummary.conflictingTemplateIds}
                      </p>
                      <p>
                        Coincidencias por nombre/título de plantilla:{' '}
                        {backupImportSummary.conflictingTemplateNames +
                          backupImportSummary.conflictingTemplateTitles}
                      </p>
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    applyImportedManualData(
                      backupImportState.importedManualData,
                      'merge',
                    )
                  }
                  className="w-full rounded-2xl border border-sky-500 bg-sky-500/10 px-4 py-4 text-left transition-colors hover:border-sky-600 hover:bg-sky-500/15 dark:border-sky-400/50 dark:hover:border-sky-300"
                >
                  <span className="block text-sm font-semibold text-sky-800 dark:text-sky-200">
                    Fusionar con lo actual
                  </span>
                  <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
                    Conserva lo que ya tienes y combina fichas, secciones,
                    plantillas y papelera. Si hay coincidencias por ID, prevalece
                    el contenido del backup.
                  </span>
                  {backupImportSummary ? (
                    <span className="mt-2 block text-xs text-sky-700 dark:text-sky-300">
                      Añadirá {backupImportSummary.newEntries} fichas nuevas y
                      actualizará {backupImportSummary.conflictingEntryIds} por ID.
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    applyImportedManualData(
                      backupImportState.importedManualData,
                      'replace',
                    )
                  }
                  className="w-full rounded-2xl border border-amber-500 bg-amber-500/10 px-4 py-4 text-left transition-colors hover:border-amber-600 hover:bg-amber-500/15 dark:border-amber-400/50 dark:hover:border-amber-300"
                >
                  <span className="block text-sm font-semibold text-amber-800 dark:text-amber-200">
                    Reemplazar el estado actual
                  </span>
                  <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
                    Sustituye por completo el estado actual por el contenido del backup.
                  </span>
                  {backupImportSummary ? (
                    <span className="mt-2 block text-xs text-amber-700 dark:text-amber-300">
                      Dejará el sistema con {backupImportState.importedManualData.entries.length}{' '}
                      fichas y {backupImportState.importedManualData.categories.length}{' '}
                      secciones procedentes del archivo importado.
                    </span>
                  ) : null}
                </button>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeBackupImportModal}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveToast ? (
        <div className="modal-shell fixed bottom-4 right-4 z-[80] max-w-sm rounded-2xl border border-slate-200 px-4 py-3 shadow-lg dark:border-slate-700">
          <p
            className={`text-sm font-medium ${
              saveToast.tone === 'success'
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-red-700 dark:text-red-300'
            }`}
          >
            {saveToast.message}
          </p>
        </div>
      ) : null}

      {modalState ? (
        <div className="modal-overlay fixed inset-0 z-50">
          {modalState.type === 'entry' ? (
            <div className="app-surface-shell flex h-full flex-col" style={entryThemeVars}>
              <div className="modal-shell flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {modalState.mode === 'create'
                      ? 'Editor de Ficha'
                      : 'Editar ficha'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Editor enriquecido con Markdown, vista previa opcional y modo dividido bajo demanda.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white/80 p-1 dark:border-slate-800 dark:bg-slate-950/70">
                    {entryEditorViewModeOptions.map((option) => {
                      const isActive = entryEditorViewMode === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setEntryEditorViewMode(option.value)}
                          aria-pressed={isActive}
                          className={`rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ${
                            isActive
                              ? 'bg-sky-600 text-white shadow-sm dark:bg-sky-500'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <ToggleSwitch
                    checked={showEntryAdvancedOptions}
                    description="Activa acciones técnicas, plantillas e identificador manual."
                    label="Opciones avanzadas"
                    onChange={setShowEntryAdvancedOptions}
                  />
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleEntrySave}
                    className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                  >
                    Guardar cambios
                  </button>
                </div>
              </div>

              <div
                className={`min-h-0 flex-1 ${
                  entryEditorViewMode === 'split'
                    ? 'grid grid-cols-1 xl:grid-cols-2'
                    : 'flex h-full flex-col'
                }`}
              >
                {showEntryEditorPane ? (
                <div
                  ref={entryEditorFormPaneRef}
                  className={`app-surface-shell min-h-0 h-full overflow-y-auto ${
                    entryEditorViewMode === 'split'
                      ? 'border-r border-slate-200 dark:border-slate-800'
                      : ''
                  }`}
                >
                  <div className={`${showFocusedEntryEditor ? 'flex min-h-full flex-col p-5 sm:p-6' : 'space-y-6 p-5 sm:p-6'}`}>
                    {!showFocusedEntryEditor ? (
                    <section className="section-gradient-card neon-card space-y-4 rounded-3xl border border-slate-200 p-5 shadow-sm dark:border-slate-800" style={entryThemeVars}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            Contexto de la ficha
                          </p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                            Define sección, metadatos y soporte operativo antes de redactar el documento.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setIsEntryContextCollapsed((currentValue) => !currentValue)
                          }
                          aria-expanded={!isEntryContextCollapsed}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
                        >
                          <span>{isEntryContextCollapsed ? 'Mostrar' : 'Ocultar'}</span>
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 20 20"
                            fill="none"
                            className={`h-4 w-4 transition-transform ${isEntryContextCollapsed ? '' : 'rotate-180'}`}
                          >
                            <path
                              d="m5.5 8 4.5 4 4.5-4"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>

                      {!isEntryContextCollapsed ? (
                      <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                          Seccion
                          <select
                            value={entryForm.categoria}
                            onChange={(event) =>
                              setEntryForm((current) => ({
                                ...current,
                                categoria: event.target.value,
                              }))
                            }
                            disabled={entryForm.categoryLocked}
                            className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white disabled:bg-slate-100 disabled:text-slate-500 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
                          >
                            <option value="">
                              {manualData.categories.length
                                ? 'Selecciona una sección'
                                : 'No hay secciones creadas'}
                            </option>
                            {manualData.categories.map((category) => (
                              <option key={category.name} value={category.name}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                          Título
                          <input
                            value={entryForm.titulo}
                            onChange={(event) =>
                              setEntryForm((current) => ({
                                ...current,
                                titulo: event.target.value,
                              }))
                            }
                            className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                        </label>

                        <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                          Tags
                          <input
                            value={entryForm.tags}
                            onChange={(event) =>
                              setEntryForm((current) => ({
                                ...current,
                                tags: event.target.value,
                              }))
                            }
                            className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            placeholder="oracle, producción, incidencia, prysma"
                          />
                          <p className="text-xs font-normal leading-5 text-slate-500 dark:text-slate-400">
                            Usa de 2 a 5 tags cortos para búsqueda, separados por comas. Convención recomendada: tecnología, entorno, tipo de tarea y sistema o negocio. Ejemplo: oracle, producción, incidencia, prysma.
                          </p>
                        </label>
                      </div>

                      {showEntryAdvancedOptions ? (
                        <div className="space-y-4 rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              Opciones avanzadas de la ficha
                            </p>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                              Aquí puedes reutilizar plantillas, guardar esta ficha como plantilla o editar el identificador técnico.
                            </p>
                          </div>

                          {manualData.templates.length ? (
                            <div className="soft-subpanel grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 md:grid-cols-[minmax(0,1fr)_auto]">
                              <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                Plantilla
                                <select
                                  value={selectedTemplateId}
                                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                                  className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                >
                                  <option value="">Selecciona una plantilla</option>
                                  {manualData.templates.map((template) => (
                                    <option key={template.id} value={template.id}>
                                      {template.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <div className="flex items-end">
                                <button
                                  type="button"
                                  onClick={handleApplySelectedTemplate}
                                  className="w-full rounded-xl border border-sky-600 bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-sky-700 hover:bg-sky-700 dark:border-sky-500 dark:bg-sky-600 dark:hover:border-sky-400 dark:hover:bg-sky-500 md:w-auto"
                                >
                                  Aplicar plantilla
                                </button>
                              </div>
                            </div>
                          ) : null}

                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                            <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                              ID de la ficha
                              <input
                                value={entryForm.id}
                                onChange={(event) =>
                                  setEntryForm((current) => ({
                                    ...current,
                                    id: event.target.value,
                                  }))
                                }
                                className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                placeholder="Se genera automaticamente si lo dejas vacio"
                              />
                            </label>

                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={handleSaveCurrentEntryAsTemplate}
                                className="w-full rounded-xl border border-sky-600 bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-sky-700 hover:bg-sky-700 dark:border-sky-500 dark:bg-sky-600 dark:hover:border-sky-400 dark:hover:bg-sky-500 md:w-auto"
                              >
                                Guardar como plantilla
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {entryForm.categoryLocked && activeEntryCategory ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                          La nueva ficha se añadirá dentro de la sección{' '}
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeEntryCategory.name}
                          </span>
                          . Para cambiarla, vuelve a la Home y entra desde otra sección.
                        </div>
                      ) : !manualData.categories.length ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                          Antes de crear fichas necesitas al menos una sección. Crea la sección desde la Home y luego vuelve aquí.
                        </div>
                      ) : !activeEntryCategory ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                          Selecciona una sección existente para que la ficha quede bien organizada.
                        </div>
                      ) : activeEntryCategory ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                          La ficha se guardará dentro de la sección{' '}
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeEntryCategory.name}
                          </span>
                          , con la descripción actual de la Home.
                        </div>
                      ) : null}
                      </>
                      ) : null}
                    </section>
                    ) : null}

                    <section className={`section-gradient-card neon-card rounded-3xl border border-slate-200 shadow-sm dark:border-slate-800 ${
                      showFocusedEntryEditor ? 'flex min-h-0 flex-1 flex-col p-4 sm:p-5' : 'space-y-4 p-5'
                    }`} style={entryThemeVars}>
                      <div
                        className={`z-10 rounded-xl border-b border-slate-200 bg-slate-50/80 dark:bg-slate-900/80 dark:border-slate-800 ${
                          showFocusedEntryEditor ? 'sticky top-0 space-y-3 px-2 py-2 pb-3' : ''
                        }`}
                        style={toolbarContainerStyle}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                        {toolbarActions.map((action, index) => {
                          const isActive = activeToolbarActionId === `${index}`;

                          return (
                          <button
                            key={action.label}
                            type="button"
                            onClick={() => handleToolbarActionClick(index, action)}
                            aria-label={`Insertar ${action.buttonLabel}`}
                            title={
                              action.shortcut
                                ? `${action.buttonLabel} (${action.shortcut})`
                                : `Insertar ${action.buttonLabel}`
                            }
                            className={`inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-all duration-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 ${
                              isActive
                                ? 'scale-[1.02] shadow-sm'
                                : ''
                            }`}
                            style={
                              isActive
                                ? {
                                    borderColor: getCategoryColorHex(entryEditorColorKey),
                                    color: getCategoryColorHex(entryEditorColorKey),
                                    boxShadow: `0 0 0 1px ${hexToRgba(getCategoryColorHex(entryEditorColorKey), 0.2)}, 0 0 10px ${hexToRgba(getCategoryColorHex(entryEditorColorKey), 0.22)}`,
                                  }
                                : undefined
                            }
                          >
                            <span
                              className="font-mono text-[11px]"
                              aria-hidden="true"
                            >
                              {action.icon}
                            </span>
                            <span>{action.buttonLabel}</span>
                          </button>
                          );
                        })}
                        {renderAdmonitionToolbarMenu(
                          'entry',
                          contentEditorRef.current,
                          entryForm.contenido,
                          (nextValue) =>
                            setEntryForm((current) => ({
                              ...current,
                              contenido: nextValue,
                            })),
                          () =>
                            syncEditorSelectionState(
                              contentEditorRef.current,
                              setContentEditorSelection,
                            ),
                        )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setIsEntryEditorFocused((currentValue) => !currentValue)
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
                          >
                            <span>{showFocusedEntryEditor ? 'Salir de enfoque' : 'Expandir editor'}</span>
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              className="h-4 w-4"
                            >
                              {showFocusedEntryEditor ? (
                                <path
                                  d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              ) : (
                                <path
                                  d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13M6.5 6.5l-3 3M13.5 6.5l3 3M6.5 13.5l-3-3M13.5 13.5l3-3"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              )}
                            </svg>
                          </button>
                        </div>
                        <p className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                          {buildToolbarContextLabel(contentEditorSelection)}
                        </p>
                      </div>

                      <div className={`${showFocusedEntryEditor ? 'mt-4 flex min-h-0 flex-1 flex-col space-y-2' : 'space-y-2'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Documento Markdown
                          </p>
                          <div className="flex items-center gap-3">
                            {isUploadingImage ? (
                              <span className="text-xs font-medium text-sky-600 dark:text-sky-300">
                                Subiendo imagen...
                              </span>
                            ) : null}
                            <p className="text-xs text-slate-400 dark:text-slate-300">
                              Soporta codigo, tablas, acordeones por encabezado e imagenes locales en `/public/images/`
                            </p>
                          </div>
                        </div>
                        <textarea
                          ref={contentEditorRef}
                          value={entryForm.contenido}
                          onPaste={(event) => {
                            void handleMarkdownEditorPaste(
                              event,
                              contentEditorRef.current,
                              entryForm.contenido,
                              (nextValue) =>
                                setEntryForm((current) => ({
                                  ...current,
                                  contenido: nextValue,
                                })),
                            );
                          }}
                          onChange={(event) =>
                            handleMarkdownEditorChange(
                              event,
                              contentEditorRef.current,
                              (nextValue) =>
                                setEntryForm((current) => ({
                                  ...current,
                                  contenido: nextValue,
                                })),
                              setContentEditorSelection,
                            )
                          }
                          onFocus={() =>
                            syncEditorSelectionState(
                              contentEditorRef.current,
                              setContentEditorSelection,
                            )
                          }
                          onSelect={() =>
                            syncEditorSelectionState(
                              contentEditorRef.current,
                              setContentEditorSelection,
                            )
                          }
                          onKeyUp={() =>
                            syncEditorSelectionState(
                              contentEditorRef.current,
                              setContentEditorSelection,
                            )
                          }
                          onMouseUp={() =>
                            syncEditorSelectionState(
                              contentEditorRef.current,
                              setContentEditorSelection,
                            )
                          }
                          onKeyDown={(event) =>
                            handleMarkdownEditorKeyDown(
                              event,
                              contentEditorRef.current,
                              entryForm.contenido,
                              (nextValue) =>
                                setEntryForm((current) => ({
                                  ...current,
                                  contenido: nextValue,
                                })),
                            )
                          }
                          className={`themed-field w-full rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white ${showFocusedEntryEditor ? 'min-h-0 flex-1' : 'min-h-[420px]'} ${isUploadingImage ? 'cursor-wait' : ''}`}
                          placeholder="# Título de sección&#10;&#10;Escribe aquí tu documentación en Markdown..."
                        />
                      </div>
                    </section>

                    {!showFocusedEntryEditor ? (
                    <section className="section-gradient-card neon-card space-y-4 rounded-3xl border border-slate-200 p-5 shadow-sm dark:border-slate-800" style={entryThemeVars}>
                      <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Pasos
                        <textarea
                          value={entryForm.pasos}
                          onChange={(event) =>
                            setEntryForm((current) => ({
                              ...current,
                              pasos: event.target.value,
                            }))
                          }
                          rows={5}
                          className="themed-field w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          placeholder="Un paso por linea"
                        />
                      </label>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Comandos y parámetros
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setEntryForm((current) => ({
                                ...current,
                                comandos: [
                                  ...current.comandos,
                                  { label: '', value: '' },
                                ],
                              }))
                            }
                            className="rounded-xl border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                          >
                            Añadir fila
                          </button>
                        </div>

                        <div className="space-y-3">
                          {entryForm.comandos.map((command, index) => (
                            <div
                              key={`${index}-${command.label}`}
                              className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 md:grid-cols-[180px_minmax(0,1fr)_auto]"
                            >
                              <input
                                value={command.label}
                                onChange={(event) =>
                                  setEntryForm((current) => ({
                                    ...current,
                                    comandos: current.comandos.map(
                                      (currentCommand, commandIndex) =>
                                        commandIndex === index
                                          ? {
                                              ...currentCommand,
                                              label: event.target.value,
                                            }
                                          : currentCommand,
                                    ),
                                  }))
                                }
                                className="themed-field rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                placeholder="Etiqueta"
                              />
                              <input
                                value={command.value}
                                onChange={(event) =>
                                  setEntryForm((current) => ({
                                    ...current,
                                    comandos: current.comandos.map(
                                      (currentCommand, commandIndex) =>
                                        commandIndex === index
                                          ? {
                                              ...currentCommand,
                                              value: event.target.value,
                                            }
                                          : currentCommand,
                                    ),
                                  }))
                                }
                                className="themed-field rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                placeholder="Valor"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setEntryForm((current) => ({
                                    ...current,
                                    comandos:
                                      current.comandos.length === 1
                                        ? [{ label: '', value: '' }]
                                        : current.comandos.filter(
                                            (_, commandIndex) =>
                                              commandIndex !== index,
                                          ),
                                  }))
                                }
                                className="rounded-xl border border-red-600 bg-red-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                    ) : null}

                    {!showFocusedEntryEditor && formError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {formError}
                      </div>
                    ) : null}
                  </div>
                </div>
                ) : null}

                {showEntryPreviewPane ? (
                <div
                  ref={entryEditorPreviewPaneRef}
                  className="app-surface-shell min-h-0 h-full overflow-y-auto"
                >
                  <div className="space-y-6 p-5 sm:p-6">
                    <div className="section-gradient-card neon-card rounded-3xl border border-slate-200 p-5 shadow-sm dark:border-slate-800" style={entryThemeVars}>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="section-gradient-pill inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-100" style={entryThemeVars}>
                          {deferredEntryPreview.categoria || 'Sin categoría'}
                        </span>
                        <span className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                          {deferredEntryPreview.id || 'id-pendiente'}
                        </span>
                      </div>

                      <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                        {deferredEntryPreview.titulo || 'Vista previa de la ficha'}
                      </h2>

                      <div className="mt-4 text-sm leading-6 text-slate-700 dark:text-slate-200">
                        <MarkdownRenderer content={deferredEntryPreview.contenido} />
                      </div>
                    </div>

                    {splitLines(deferredEntryPreview.pasos).length ? (
                      <div className="section-gradient-card neon-card rounded-3xl border border-slate-200 p-5 shadow-sm dark:border-slate-800" style={entryThemeVars}>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Pasos
                        </h3>
                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700 dark:text-slate-200">
                          {splitLines(deferredEntryPreview.pasos).map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    ) : null}

                    {deferredEntryPreview.comandos.some(
                      (command) => command.label.trim() || command.value.trim(),
                    ) ? (
                      <div className="section-gradient-card neon-card rounded-3xl border border-slate-200 p-5 shadow-sm dark:border-slate-800" style={entryThemeVars}>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Comandos y parámetros
                        </h3>
                        <div className="mt-3 space-y-2">
                          {deferredEntryPreview.comandos
                            .filter(
                              (command) =>
                                command.label.trim() || command.value.trim(),
                            )
                            .map((command, index) => (
                              <div
                                key={`${command.label}-${index}`}
                                className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40 sm:grid-cols-[140px_minmax(0,1fr)]"
                                style={{
                                  borderLeftColor: getCategoryColorHex(entryEditorColorKey),
                                  borderLeftStyle: 'solid',
                                  borderLeftWidth: 4,
                                }}
                              >
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-400">
                                  {command.label || 'Etiqueta'}
                                </span>
                                <code className="overflow-x-auto whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950/80 dark:text-white">
                                  {command.value || 'Valor'}
                                </code>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                ) : null}
              </div>
            </div>
          ) : modalState.type === 'category' ? (
            <div className="flex h-full items-center justify-center p-4">
              <div className="modal-shell w-full max-w-2xl rounded-3xl border border-slate-200 shadow-2xl dark:border-slate-800" style={categoryThemeVars}>
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {modalState.mode === 'create'
                        ? 'Nueva sección'
                        : 'Editar sección'}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Configura el nombre, el color y la descripción del bloque principal de la Home.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeModal}
                    aria-label="Cerrar modal"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
                  <section className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                      Nombre de la sección
                      <input
                        value={categoryForm?.name ?? ''}
                        onChange={(event) =>
                          setCategoryForm((current) =>
                            current
                              ? { ...current, name: event.target.value }
                              : current,
                          )
                        }
                        className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>

                    <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                      Color
                      <select
                        value={categoryForm?.color ?? 'blue'}
                        onChange={(event) =>
                          setCategoryForm((current) =>
                            current
                              ? {
                                  ...current,
                                  color: event.target.value as CategoryColorKey,
                                }
                              : current,
                          )
                        }
                        className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      >
                        {categoryColorOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                      Descripción de la Home
                      <textarea
                        value={categoryForm?.description ?? ''}
                        onChange={(event) =>
                          setCategoryForm((current) =>
                            current
                              ? { ...current, description: event.target.value }
                              : current,
                          )
                        }
                        rows={4}
                        className="themed-field w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                  </section>

                  {formError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {formError}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
                  {modalState.mode === 'edit' ? (
                    <button
                      type="button"
                      onClick={() =>
                        categoryForm?.name
                          ? handleDeleteCategory(categoryForm.name)
                          : undefined
                      }
                      className="mr-auto rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 transition-all duration-200 hover:border-rose-300 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:border-rose-400/40 dark:hover:bg-rose-500/20"
                    >
                      Eliminar sección
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleCategorySave}
                    className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                  >
                    Guardar cambios
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="app-surface-shell flex h-full flex-col" style={entryThemeVars}>
              <div className="modal-shell flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {modalState.mode === 'create'
                        ? 'Nueva plantilla'
                        : 'Editar plantilla'}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Define una estructura reutilizable para acelerar la creación de fichas.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <ToggleSwitch
                      checked={showTemplateTechnicalOptions}
                      description="Activa el identificador técnico y los campos opcionales de la plantilla."
                      label="Opciones avanzadas"
                      onChange={setShowTemplateTechnicalOptions}
                    />
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-xl border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleTemplateSave}
                      className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                    >
                      Guardar plantilla
                    </button>
                  </div>
              </div>

              <div
                ref={templateEditorPaneRef}
                className="app-surface-shell min-h-0 flex-1 overflow-y-auto"
              >
                <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-6">
                  <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                    <section className="section-gradient-card neon-card space-y-4 rounded-3xl border border-slate-200 p-5 shadow-sm dark:border-slate-800" style={entryThemeVars}>
                    <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                      Nombre de la plantilla
                      <input
                        value={templateForm?.name ?? ''}
                        onChange={(event) =>
                          setTemplateForm((current) =>
                            current ? { ...current, name: event.target.value } : current,
                          )
                        }
                        className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                        placeholder="Ej. Plantilla Incidencia Batch"
                      />
                    </label>

                    {showTemplateTechnicalOptions ? (
                      <div className="rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/60">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Opciones avanzadas de plantilla
                          </p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            La app puede generar el identificador técnico automáticamente y dejar el resto de campos opcionales fuera del flujo normal.
                          </p>
                        </div>

                        <div className="mt-3 space-y-4">
                          <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            ID de plantilla
                            <input
                              value={templateForm?.id ?? ''}
                              onChange={(event) =>
                                setTemplateForm((current) =>
                                  current ? { ...current, id: event.target.value } : current,
                                )
                              }
                              className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                              placeholder="Se genera automaticamente si lo dejas vacio"
                            />
                          </label>

                          <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            Sección sugerida
                            <select
                              value={templateForm?.categoria ?? ''}
                              onChange={(event) =>
                                setTemplateForm((current) =>
                                  current ? { ...current, categoria: event.target.value } : current,
                                )
                              }
                              className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="">Sin sección fija</option>
                              {manualData.categories.map((category) => (
                                <option key={category.name} value={category.name}>
                                  {category.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            Título sugerido
                            <input
                              value={templateForm?.titulo ?? ''}
                              onChange={(event) =>
                                setTemplateForm((current) =>
                                  current ? { ...current, titulo: event.target.value } : current,
                                )
                              }
                              className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                              placeholder="Ej. Nueva incidencia"
                            />
                          </label>

                          <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            Tags sugeridos
                            <input
                              value={templateForm?.tags ?? ''}
                              onChange={(event) =>
                                setTemplateForm((current) =>
                                  current ? { ...current, tags: event.target.value } : current,
                                )
                              }
                              className="themed-field w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                              placeholder="batch, incidencia, producción"
                            />
                          </label>

                          <label className="space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            Pasos sugeridos
                            <textarea
                              value={templateForm?.pasos ?? ''}
                              onChange={(event) =>
                                setTemplateForm((current) =>
                                  current ? { ...current, pasos: event.target.value } : current,
                                )
                              }
                              rows={5}
                              className="themed-field w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                              placeholder="Un paso por linea"
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}
                    </section>

                    <section className="section-gradient-card neon-card space-y-4 rounded-3xl border border-slate-200 p-5 shadow-sm dark:border-slate-800" style={entryThemeVars}>
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-xl border-b border-slate-200 bg-slate-50/80 px-2 py-2 dark:border-slate-800 dark:bg-slate-900/80"
                        style={toolbarContainerStyle}
                      >
                        {templateToolbarActions.map((action, index) => {
                          const isActive = activeToolbarActionId === `${index}`;

                          return (
                            <button
                              key={`template-${action.label}`}
                              type="button"
                              onClick={() => handleToolbarActionClick(index, action)}
                              aria-label={`Insertar ${action.buttonLabel}`}
                              title={
                                action.shortcut
                                  ? `${action.buttonLabel} (${action.shortcut})`
                                  : `Insertar ${action.buttonLabel}`
                              }
                              className={`inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-all duration-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 ${
                                isActive ? 'scale-[1.02] shadow-sm' : ''
                              }`}
                              style={
                                isActive
                                  ? {
                                      borderColor: getCategoryColorHex(entryEditorColorKey),
                                      color: getCategoryColorHex(entryEditorColorKey),
                                      boxShadow: `0 0 0 1px ${hexToRgba(getCategoryColorHex(entryEditorColorKey), 0.2)}, 0 0 10px ${hexToRgba(getCategoryColorHex(entryEditorColorKey), 0.22)}`,
                                    }
                                  : undefined
                              }
                            >
                              <span
                                className="font-mono text-[11px]"
                                aria-hidden="true"
                              >
                                {action.icon}
                              </span>
                              <span>{action.buttonLabel}</span>
                            </button>
                          );
                        })}
                        {renderAdmonitionToolbarMenu(
                          'template',
                          templateContentEditorRef.current,
                          templateForm?.contenido ?? '',
                          (nextValue) =>
                            setTemplateForm((current) =>
                              current
                                ? { ...current, contenido: nextValue }
                                : current,
                            ),
                          () =>
                            syncEditorSelectionState(
                              templateContentEditorRef.current,
                              setTemplateEditorSelection,
                            ),
                        )}
                      </div>
                      <p className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                        {buildToolbarContextLabel(templateEditorSelection)}
                      </p>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Documento Markdown
                          </p>
                          <div className="flex items-center gap-3">
                            {isUploadingImage ? (
                              <span className="text-xs font-medium text-sky-600 dark:text-sky-300">
                                Subiendo imagen...
                              </span>
                            ) : null}
                            <p className="text-xs text-slate-400 dark:text-slate-300">
                              Soporta codigo, tablas, acordeones por encabezado e imagenes locales en `/public/images/`
                            </p>
                          </div>
                        </div>

                        <textarea
                          ref={templateContentEditorRef}
                          value={templateForm?.contenido ?? ''}
                          onPaste={(event) => {
                            void handleMarkdownEditorPaste(
                              event,
                              templateContentEditorRef.current,
                              templateForm?.contenido ?? '',
                              (nextValue) =>
                                setTemplateForm((current) =>
                                  current
                                    ? { ...current, contenido: nextValue }
                                    : current,
                                ),
                            );
                          }}
                          onChange={(event) =>
                            handleMarkdownEditorChange(
                              event,
                              templateContentEditorRef.current,
                              (nextValue) =>
                                setTemplateForm((current) =>
                                  current
                                    ? { ...current, contenido: nextValue }
                                    : current,
                                ),
                              setTemplateEditorSelection,
                            )
                          }
                          onFocus={() =>
                            syncEditorSelectionState(
                              templateContentEditorRef.current,
                              setTemplateEditorSelection,
                            )
                          }
                          onSelect={() =>
                            syncEditorSelectionState(
                              templateContentEditorRef.current,
                              setTemplateEditorSelection,
                            )
                          }
                          onKeyUp={() =>
                            syncEditorSelectionState(
                              templateContentEditorRef.current,
                              setTemplateEditorSelection,
                            )
                          }
                          onMouseUp={() =>
                            syncEditorSelectionState(
                              templateContentEditorRef.current,
                              setTemplateEditorSelection,
                            )
                          }
                          onKeyDown={(event) =>
                            handleMarkdownEditorKeyDown(
                              event,
                              templateContentEditorRef.current,
                              templateForm?.contenido ?? '',
                              (nextValue) =>
                                setTemplateForm((current) =>
                                  current
                                    ? { ...current, contenido: nextValue }
                                    : current,
                                ),
                            )
                          }
                          rows={14}
                          className={`themed-field min-h-[280px] w-full rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white ${isUploadingImage ? 'cursor-wait' : ''}`}
                          placeholder="# Título de sección&#10;&#10;Escribe aquí tu documentación en Markdown..."
                        />
                      </div>

                    {showTemplateTechnicalOptions ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Comandos y parámetros sugeridos
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setTemplateForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      comandos: [
                                        ...current.comandos,
                                        { label: '', value: '' },
                                      ],
                                    }
                                  : current,
                              )
                            }
                            className="rounded-xl border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                          >
                            Añadir fila
                          </button>
                        </div>

                        <div className="space-y-3">
                          {(templateForm?.comandos ?? []).map((command, index) => (
                            <div
                              key={`template-command-${index}`}
                              className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 md:grid-cols-[180px_minmax(0,1fr)_auto]"
                            >
                              <input
                                value={command.label}
                                onChange={(event) =>
                                  setTemplateForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          comandos: current.comandos.map(
                                            (currentCommand, commandIndex) =>
                                              commandIndex === index
                                                ? {
                                                    ...currentCommand,
                                                    label: event.target.value,
                                                  }
                                                : currentCommand,
                                          ),
                                        }
                                      : current,
                                  )
                                }
                                className="themed-field rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                placeholder="Etiqueta"
                              />
                              <input
                                value={command.value}
                                onChange={(event) =>
                                  setTemplateForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          comandos: current.comandos.map(
                                            (currentCommand, commandIndex) =>
                                              commandIndex === index
                                                ? {
                                                    ...currentCommand,
                                                    value: event.target.value,
                                                  }
                                                : currentCommand,
                                          ),
                                        }
                                      : current,
                                  )
                                }
                                className="themed-field rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                placeholder="Valor"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setTemplateForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          comandos:
                                            current.comandos.length === 1
                                              ? [{ label: '', value: '' }]
                                              : current.comandos.filter(
                                                  (_, commandIndex) =>
                                                    commandIndex !== index,
                                                ),
                                        }
                                      : current,
                                  )
                                }
                                className="rounded-xl border border-red-600 bg-red-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {formError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {formError}
                      </div>
                    ) : null}
                    </section>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-2 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-xl border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleTemplateSave}
                      className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                    >
                      Guardar plantilla
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {deleteConfirmationEntry ? (
        <div className="modal-overlay fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="modal-shell w-full max-w-md rounded-3xl border border-slate-200 p-5 shadow-2xl dark:border-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Confirmar borrado
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-200">
              ¿Estás seguro de que deseas mover esta ficha a la papelera?
            </p>
            <p className="soft-subpanel mt-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 dark:border-slate-800 dark:text-slate-100">
              {deleteConfirmationEntry.titulo}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelDeleteEntry}
                className="rounded-xl border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:hover:border-red-400 dark:hover:bg-red-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteEntry}
                className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmationCategory ? (
        <div className="modal-overlay fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="modal-shell w-full max-w-md rounded-3xl border border-slate-200 p-5 shadow-2xl dark:border-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Confirmar borrado de sección
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-200">
              Esta acción eliminará la sección y sus fichas asociadas.
            </p>
            <p className="soft-subpanel mt-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 dark:border-slate-800 dark:text-slate-100">
              {deleteConfirmationCategory.categoryName} ·{' '}
              {deleteConfirmationCategory.entryCount} ficha
              {deleteConfirmationCategory.entryCount === 1 ? '' : 's'}
            </p>
            {deleteConfirmationCategory.entryCount >= 5 ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Esta sección tiene bastante contenido. Revisa el backup antes de confirmar el borrado.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelDeleteCategory}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCategory}
                className="rounded-xl border border-rose-600 bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:border-rose-700 hover:bg-rose-700 dark:border-rose-500 dark:bg-rose-600 dark:hover:border-rose-400 dark:hover:bg-rose-500"
              >
                Eliminar sección
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
};
