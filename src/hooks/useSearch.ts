import { useMemo } from 'react';
import type { KnowledgeEntry } from '../types';

const normalize = (value: string) => value.trim().toLowerCase();
const stripMarkdown = (value: string) =>
  value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/^#{1,6}\s+/gm, ' ')
    .replace(/[>*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const buildEntrySearchBlob = (entry: KnowledgeEntry) =>
  [
    entry.titulo,
    entry.categoria,
    entry.contenido,
    stripMarkdown(entry.contenido),
    entry.tags.join(' '),
    entry.pasos?.join(' ') ?? '',
    entry.comandos?.map((command) => `${command.label} ${command.value}`).join(' ') ?? '',
  ]
    .join(' ')
    .toLowerCase();

interface EntrySearchIndex {
  category: string;
  entry: KnowledgeEntry;
  hasCommands: boolean;
  hasSteps: boolean;
  normalizedTags: string[];
  searchBlob: string;
}

const matchesPrefixQuery = (
  entryIndex: EntrySearchIndex,
  query: string,
  predicate: (entryIndex: EntrySearchIndex) => boolean,
) => {
  if (!predicate(entryIndex)) {
    return false;
  }

  if (!query) {
    return true;
  }

  return entryIndex.searchBlob.includes(query);
};

export function useSearch(
  entries: KnowledgeEntry[],
  rawSearchTerm: string,
  activeCategoryFilter?: string,
  activeTagFilters: string[] = [],
) {
  const entrySearchIndexes = useMemo<EntrySearchIndex[]>(
    () =>
      entries.map((entry) => ({
        category: normalize(entry.categoria),
        entry,
        hasCommands: Boolean(entry.comandos?.length),
        hasSteps: Boolean(entry.pasos?.length),
        normalizedTags: entry.tags.map((tag) => normalize(tag)).filter(Boolean),
        searchBlob: buildEntrySearchBlob(entry),
      })),
    [entries],
  );

  return useMemo(() => {
    const term = normalize(rawSearchTerm);
    const normalizedCategoryFilter = normalize(activeCategoryFilter ?? '');
    const normalizedTagFilters = activeTagFilters
      .map((tag) => normalize(tag))
      .filter(Boolean);
    let filteredEntryIndexes = entrySearchIndexes;

    if (normalizedCategoryFilter) {
      filteredEntryIndexes = filteredEntryIndexes.filter(
        (entryIndex) => entryIndex.category === normalizedCategoryFilter,
      );
    }

    if (normalizedTagFilters.length) {
      filteredEntryIndexes = filteredEntryIndexes.filter((entryIndex) =>
        normalizedTagFilters.every((activeTag) =>
          entryIndex.normalizedTags.includes(activeTag),
        ),
      );
    }

    if (!term) {
      return filteredEntryIndexes.map((entryIndex) => entryIndex.entry);
    }

    if (term.startsWith('/cmd')) {
      const cmdQuery = normalize(term.replace('/cmd', ''));

      return filteredEntryIndexes
        .filter((entryIndex) =>
        matchesPrefixQuery(
          entryIndex,
          cmdQuery,
          (candidateEntryIndex) =>
            (candidateEntryIndex.entry.categoria === 'Batch' ||
              candidateEntryIndex.entry.categoria === 'General') &&
            candidateEntryIndex.hasCommands,
        ),
        )
        .map((entryIndex) => entryIndex.entry);
    }

    if (term.startsWith('/env')) {
      const envQuery = normalize(term.replace('/env', ''));

      return filteredEntryIndexes
        .filter((entryIndex) =>
          matchesPrefixQuery(
            entryIndex,
            envQuery,
            (candidateEntryIndex) => candidateEntryIndex.entry.categoria === 'Entorno',
          ),
        )
        .map((entryIndex) => entryIndex.entry);
    }

    if (term.startsWith('/db')) {
      const dbQuery = normalize(term.replace('/db', ''));

      return filteredEntryIndexes
        .filter((entryIndex) =>
        matchesPrefixQuery(
          entryIndex,
          dbQuery,
          (candidateEntryIndex) =>
            candidateEntryIndex.entry.categoria === 'Batch' ||
            candidateEntryIndex.entry.comandos?.some((command) =>
              /sql|oracle|tabla|query|select|insert|update|delete/i.test(
                `${command.label} ${command.value}`,
              ),
            ) === true ||
            /sql|oracle|tabla|bbdd|base de datos|query/i.test(candidateEntryIndex.searchBlob),
        ),
        )
        .map((entryIndex) => entryIndex.entry);
    }

    if (term.startsWith('/uml')) {
      const umlQuery = normalize(term.replace('/uml', ''));

      return filteredEntryIndexes
        .filter((entryIndex) =>
          matchesPrefixQuery(
            entryIndex,
            umlQuery,
            (candidateEntryIndex) => candidateEntryIndex.entry.categoria === 'UML',
          ),
        )
        .map((entryIndex) => entryIndex.entry);
    }

    if (term.startsWith('/task')) {
      const taskQuery = normalize(term.replace('/task', ''));

      return filteredEntryIndexes
        .filter((entryIndex) =>
        matchesPrefixQuery(
          entryIndex,
          taskQuery,
          (candidateEntryIndex) =>
            candidateEntryIndex.hasSteps ||
            /\bpaso\b|\btarea\b|\bprocedimiento\b|\bchecklist\b/i.test(candidateEntryIndex.searchBlob),
        ),
        )
        .map((entryIndex) => entryIndex.entry);
    }

    return filteredEntryIndexes
      .filter((entryIndex) => entryIndex.searchBlob.includes(term))
      .map((entryIndex) => entryIndex.entry);
  }, [activeCategoryFilter, activeTagFilters, entrySearchIndexes, rawSearchTerm]);
}
