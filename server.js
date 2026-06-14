// Si este puente de persistencia se migra a Java, es obligatorio implementar
// try-catch-resources para el manejo de los flujos de entrada/salida de
// archivos (Streams) y asi evitar bloqueos de recursos en el sistema operativo
// [cite: 2026-02-12].

import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(currentFilePath);
const defaultPort = Number(process.env.APP_PORT || 3001);
const directServeStatic = process.env.APP_SERVE_STATIC === 'true';

const formatTimestamp = () =>
  new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  }).format(new Date());

const logServerEvent = (scope, message, details) => {
  const prefix = `[${formatTimestamp()}] [${scope}]`;

  if (details) {
    console.log(`${prefix} ${message}`, details);
    return;
  }

  console.log(`${prefix} ${message}`);
};

const createAllowedOrigins = (port) =>
  new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

const normalizeStorageKey = (value) => {
  const normalizedValue =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      : '';

  return normalizedValue || 'sin-categoria';
};

const buildBlockStoragePaths = (baseDirectory) => {
  const runtimeDataDirectory = path.resolve(baseDirectory);
  const entriesDirectory = path.join(runtimeDataDirectory, 'entries');

  return {
    categoriesFilePath: path.join(runtimeDataDirectory, 'categories.json'),
    deletedCategoriesFilePath: path.join(runtimeDataDirectory, 'deleted-categories.json'),
    entriesDirectory,
    runtimeDataDirectory,
    settingsFilePath: path.join(runtimeDataDirectory, 'settings.json'),
    templatesFilePath: path.join(runtimeDataDirectory, 'templates.json'),
    trashFilePath: path.join(runtimeDataDirectory, 'trash.json'),
  };
};

const resolveRuntimePaths = ({
  appDataDir,
  sourceRoot = projectRoot,
  staticDistDir,
} = {}) => {
  const bundledManualFilePath = path.resolve(sourceRoot, 'src', 'data', 'manual.json');
  const localManualFilePath = path.resolve(sourceRoot, 'src', 'data', 'manual.local.json');
  const sourceRuntimeDataDirectory = path.resolve(sourceRoot, 'src', 'data', 'runtime');
  const sourceBlockStoragePaths = buildBlockStoragePaths(sourceRuntimeDataDirectory);

  if (!appDataDir) {
    return {
      backupsDirectory: path.resolve(sourceRoot, 'backups'),
      bundledManualFilePath,
      imagesDirectory: path.resolve(sourceRoot, 'public', 'images'),
      legacyManualFilePath: localManualFilePath,
      manualFilePath: localManualFilePath,
      staticDistDirectory: staticDistDir ?? path.resolve(sourceRoot, 'dist'),
      ...sourceBlockStoragePaths,
    };
  }

  const appRuntimeDataDirectory = path.resolve(appDataDir, 'data');
  const appBlockStoragePaths = buildBlockStoragePaths(appRuntimeDataDirectory);

  return {
    backupsDirectory: path.resolve(appDataDir, 'backups'),
    bundledManualFilePath,
    imagesDirectory: path.resolve(appDataDir, 'images'),
    legacyManualFilePath: path.resolve(appDataDir, 'manual.json'),
    manualFilePath: path.resolve(appDataDir, 'manual.json'),
    staticDistDirectory: staticDistDir ?? path.resolve(sourceRoot, 'dist'),
    ...appBlockStoragePaths,
  };
};

const writeJsonFile = async (filePath, payload) => {
  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
};

const readJsonFile = async (filePath) => {
  const rawFile = await fs.promises.readFile(filePath, 'utf-8');

  return JSON.parse(rawFile);
};

const hasBlockStorage = (runtimePaths) =>
  fs.existsSync(runtimePaths.categoriesFilePath) &&
  fs.existsSync(runtimePaths.deletedCategoriesFilePath) &&
  fs.existsSync(runtimePaths.settingsFilePath) &&
  fs.existsSync(runtimePaths.templatesFilePath) &&
  fs.existsSync(runtimePaths.trashFilePath) &&
  fs.existsSync(runtimePaths.entriesDirectory);

const groupEntriesByCategory = (entries) => {
  const entriesByCategory = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const categoryName =
      typeof entry?.categoria === 'string' && entry.categoria.trim()
        ? entry.categoria.trim()
        : 'Sin categoria';
    const storageKey = normalizeStorageKey(categoryName);

    if (!entriesByCategory.has(storageKey)) {
      entriesByCategory.set(storageKey, []);
    }

    entriesByCategory.get(storageKey).push(entry);
  });

  return entriesByCategory;
};

const writeBlockManualData = async (
  runtimePaths,
  manualData,
  { syncLegacySnapshot = true } = {},
) => {
  await fs.promises.mkdir(runtimePaths.runtimeDataDirectory, { recursive: true });
  await fs.promises.mkdir(runtimePaths.entriesDirectory, { recursive: true });

  await Promise.all([
    writeJsonFile(runtimePaths.categoriesFilePath, manualData.categories ?? []),
    writeJsonFile(
      runtimePaths.deletedCategoriesFilePath,
      manualData.deletedCategories ?? [],
    ),
    writeJsonFile(runtimePaths.settingsFilePath, manualData.settings ?? {}),
    writeJsonFile(runtimePaths.templatesFilePath, manualData.templates ?? []),
    writeJsonFile(runtimePaths.trashFilePath, manualData.trash ?? []),
  ]);

  const entriesByCategory = groupEntriesByCategory(manualData.entries);
  const nextEntryFileNames = new Set();

  for (const [storageKey, categoryEntries] of entriesByCategory.entries()) {
    const entryFileName = `${storageKey}.json`;
    const entryFilePath = path.join(runtimePaths.entriesDirectory, entryFileName);

    nextEntryFileNames.add(entryFileName);
    await writeJsonFile(entryFilePath, categoryEntries);
  }

  const existingEntryFiles = fs.existsSync(runtimePaths.entriesDirectory)
    ? await fs.promises.readdir(runtimePaths.entriesDirectory, {
        withFileTypes: true,
      })
    : [];

  for (const entryFile of existingEntryFiles) {
    if (!entryFile.isFile() || path.extname(entryFile.name) !== '.json') {
      continue;
    }

    if (nextEntryFileNames.has(entryFile.name)) {
      continue;
    }

    await fs.promises.unlink(path.join(runtimePaths.entriesDirectory, entryFile.name));
  }

  if (syncLegacySnapshot && runtimePaths.legacyManualFilePath) {
    await writeJsonFile(runtimePaths.legacyManualFilePath, manualData);
  }
};

const writeEntryChunks = async (
  runtimePaths,
  entryChunks = {},
  removedEntryChunkKeys = [],
) => {
  await fs.promises.mkdir(runtimePaths.entriesDirectory, { recursive: true });

  for (const [storageKey, categoryEntries] of Object.entries(entryChunks)) {
    const entryFilePath = path.join(runtimePaths.entriesDirectory, `${storageKey}.json`);
    await writeJsonFile(entryFilePath, Array.isArray(categoryEntries) ? categoryEntries : []);
  }

  for (const storageKey of removedEntryChunkKeys) {
    const entryFilePath = path.join(runtimePaths.entriesDirectory, `${storageKey}.json`);
    if (fs.existsSync(entryFilePath)) {
      await fs.promises.unlink(entryFilePath);
    }
  }
};

const applyManualPatch = (currentManualData, manualPatch) => {
  const nextManualData = {
    ...currentManualData,
    categories: Array.isArray(manualPatch.categories)
      ? manualPatch.categories
      : currentManualData.categories,
    deletedCategories: Array.isArray(manualPatch.deletedCategories)
      ? manualPatch.deletedCategories
      : currentManualData.deletedCategories ?? [],
    settings:
      manualPatch.settings && typeof manualPatch.settings === 'object'
        ? manualPatch.settings
        : currentManualData.settings,
    templates: Array.isArray(manualPatch.templates)
      ? manualPatch.templates
      : currentManualData.templates,
    trash: Array.isArray(manualPatch.trash) ? manualPatch.trash : currentManualData.trash,
  };

  const currentEntryChunks = groupEntriesByCategory(currentManualData.entries);
  const nextEntryChunks = new Map(currentEntryChunks);
  const patchedEntryChunks =
    manualPatch.entryChunks && typeof manualPatch.entryChunks === 'object'
      ? manualPatch.entryChunks
      : {};

  Object.entries(patchedEntryChunks).forEach(([storageKey, categoryEntries]) => {
    nextEntryChunks.set(storageKey, Array.isArray(categoryEntries) ? categoryEntries : []);
  });

  const removedEntryChunkKeys = Array.isArray(manualPatch.removedEntryChunkKeys)
    ? manualPatch.removedEntryChunkKeys.filter((value) => typeof value === 'string')
    : [];

  removedEntryChunkKeys.forEach((storageKey) => {
    nextEntryChunks.delete(storageKey);
  });

  nextManualData.entries = Array.from(nextEntryChunks.values()).flatMap((entryChunk) =>
    Array.isArray(entryChunk) ? entryChunk : [],
  );

  return {
    nextManualData,
    removedEntryChunkKeys,
  };
};

const readLegacyOrBundledManualFile = async (runtimePaths) => {
  const candidateFilePath = fs.existsSync(runtimePaths.legacyManualFilePath)
    ? runtimePaths.legacyManualFilePath
    : runtimePaths.bundledManualFilePath;

  return readJsonFile(candidateFilePath);
};

const readBlockManualFile = async (runtimePaths) => {
  const [
    categories,
    deletedCategories,
    settings,
    templates,
    trash,
  ] = await Promise.all([
    readJsonFile(runtimePaths.categoriesFilePath),
    readJsonFile(runtimePaths.deletedCategoriesFilePath),
    readJsonFile(runtimePaths.settingsFilePath),
    readJsonFile(runtimePaths.templatesFilePath),
    readJsonFile(runtimePaths.trashFilePath),
  ]);

  const entryFiles = await fs.promises.readdir(runtimePaths.entriesDirectory, {
    withFileTypes: true,
  });
  const entryFilePaths = entryFiles
    .filter((entryFile) => entryFile.isFile() && path.extname(entryFile.name) === '.json')
    .map((entryFile) => path.join(runtimePaths.entriesDirectory, entryFile.name));
  const entryChunks = await Promise.all(entryFilePaths.map((entryFilePath) => readJsonFile(entryFilePath)));

  return {
    categories: Array.isArray(categories) ? categories : [],
    deletedCategories: Array.isArray(deletedCategories) ? deletedCategories : [],
    entries: entryChunks.flatMap((entryChunk) => (Array.isArray(entryChunk) ? entryChunk : [])),
    settings: settings && typeof settings === 'object' ? settings : {},
    templates: Array.isArray(templates) ? templates : [],
    trash: Array.isArray(trash) ? trash : [],
  };
};

const readManualFile = async (runtimePaths) => {
  if (hasBlockStorage(runtimePaths)) {
    return readBlockManualFile(runtimePaths);
  }

  return readLegacyOrBundledManualFile(runtimePaths);
};

const listRevisionFiles = async (runtimePaths) => {
  if (hasBlockStorage(runtimePaths)) {
    const entryFiles = await fs.promises.readdir(runtimePaths.entriesDirectory, {
      withFileTypes: true,
    });

    return [
      runtimePaths.categoriesFilePath,
      runtimePaths.deletedCategoriesFilePath,
      runtimePaths.settingsFilePath,
      runtimePaths.templatesFilePath,
      runtimePaths.trashFilePath,
      ...entryFiles
        .filter((entryFile) => entryFile.isFile() && path.extname(entryFile.name) === '.json')
        .map((entryFile) => path.join(runtimePaths.entriesDirectory, entryFile.name)),
    ];
  }

  return [
    fs.existsSync(runtimePaths.legacyManualFilePath)
      ? runtimePaths.legacyManualFilePath
      : runtimePaths.bundledManualFilePath,
  ];
};

const getManualRevision = async (runtimePaths) => {
  const revisionFiles = await listRevisionFiles(runtimePaths);
  const fileStats = await Promise.all(
    revisionFiles.map(async (filePath) => {
      const stats = await fs.promises.stat(filePath);

      return {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      };
    }),
  );
  const totalSize = fileStats.reduce((sum, fileStat) => sum + fileStat.size, 0);
  const latestModifiedAt = fileStats.reduce(
    (maxValue, fileStat) => Math.max(maxValue, fileStat.mtimeMs),
    0,
  );

  return `${latestModifiedAt}-${totalSize}-${revisionFiles.length}`;
};

const readManualPayload = async (runtimePaths) => ({
  data: await readManualFile(runtimePaths),
  revision: await getManualRevision(runtimePaths),
});

const ensureRuntimeFiles = async (runtimePaths) => {
  await fs.promises.mkdir(runtimePaths.imagesDirectory, { recursive: true });
  await fs.promises.mkdir(runtimePaths.backupsDirectory, { recursive: true });
  await fs.promises.mkdir(runtimePaths.runtimeDataDirectory, { recursive: true });
  await fs.promises.mkdir(runtimePaths.entriesDirectory, { recursive: true });

  if (hasBlockStorage(runtimePaths)) {
    return;
  }

  const canUseLegacyManual = fs.existsSync(runtimePaths.legacyManualFilePath);
  const canUseBundledManual = fs.existsSync(runtimePaths.bundledManualFilePath);

  if (!canUseLegacyManual && !canUseBundledManual) {
    return;
  }

  const sourceManualData = await readLegacyOrBundledManualFile(runtimePaths);
  await writeBlockManualData(runtimePaths, sourceManualData, {
    syncLegacySnapshot: canUseLegacyManual,
  });

  logServerEvent('BOOT', 'Persistencia por bloques preparada correctamente.', {
    source:
      canUseLegacyManual && fs.existsSync(runtimePaths.legacyManualFilePath)
        ? runtimePaths.legacyManualFilePath
        : runtimePaths.bundledManualFilePath,
    runtimeDataDirectory: runtimePaths.runtimeDataDirectory,
  });
};

const normalizeEndpointTarget = (value) => {
  const trimmedValue = typeof value === 'string' ? value.trim() : '';

  if (!trimmedValue) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/.*)?$/i.test(trimmedValue)) {
    return `http://${trimmedValue.replace(/^\[::1\]/, '::1')}`;
  }

  if (/^[a-z0-9.-]+(?::\d+)?(\/.*)?$/i.test(trimmedValue)) {
    return `https://${trimmedValue}`;
  }

  return null;
};

const imageReferencePattern = /!\[[^\]]*]\((\/images\/[^)\s]+)\)/g;

const collectMarkdownImagePaths = (content) => {
  if (typeof content !== 'string' || !content.trim()) {
    return [];
  }

  return Array.from(content.matchAll(imageReferencePattern), (match) => match[1]);
};

const collectReferencedImageFilenames = (manualData) => {
  const referencedImageFilenames = new Set();
  const contentContainers = [
    ...(Array.isArray(manualData?.entries) ? manualData.entries : []),
    ...(Array.isArray(manualData?.templates) ? manualData.templates : []),
    ...(Array.isArray(manualData?.trash) ? manualData.trash : []),
  ];

  contentContainers.forEach((item) => {
    collectMarkdownImagePaths(item?.contenido).forEach((imagePath) => {
      const imageFilename = path.basename(imagePath);

      if (imageFilename) {
        referencedImageFilenames.add(imageFilename);
      }
    });
  });

  return referencedImageFilenames;
};

const cleanupOrphanedImages = async (imagesDirectory, manualData) => {
  if (!fs.existsSync(imagesDirectory)) {
    logServerEvent('IMAGES', 'No existe el directorio de imagenes; se omite la limpieza.', {
      imagesDirectory,
    });
    return;
  }

  const referencedImageFilenames = collectReferencedImageFilenames(manualData);
  const storedImageEntries = await fs.promises.readdir(imagesDirectory, {
    withFileTypes: true,
  });

  const removableImages = storedImageEntries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }

    if (entry.name.startsWith('.')) {
      return false;
    }

    return !referencedImageFilenames.has(entry.name);
  });

  for (const imageEntry of removableImages) {
    const imageFilePath = path.join(imagesDirectory, imageEntry.name);

    try {
      await fs.promises.unlink(imageFilePath);
      logServerEvent('IMAGES', 'Imagen huerfana eliminada del disco.', {
        imageFilePath,
      });
    } catch (error) {
      const fileMissing =
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT';

      if (fileMissing) {
        logServerEvent('IMAGES', 'La imagen huerfana ya no existia en disco.', {
          imageFilePath,
        });
        continue;
      }

      console.error(
        `[${formatTimestamp()}] [IMAGES] No se pudo eliminar una imagen huerfana.`,
        error,
      );
    }
  }
};

export const startServer = async ({
  allowedOrigins,
  appDataDir,
  port = defaultPort,
  serveStatic = false,
  sourceRoot = projectRoot,
  staticDistDir,
} = {}) => {
  const resolvedAllowedOrigins = allowedOrigins ?? createAllowedOrigins(port);
  const runtimePaths = resolveRuntimePaths({
    appDataDir,
    sourceRoot,
    staticDistDir,
  });

  await ensureRuntimeFiles(runtimePaths);

  const app = express();
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        callback(null, runtimePaths.imagesDirectory);
      },
      filename: (_request, file, callback) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const extension = path.extname(file.originalname);
        callback(null, `${uniqueName}${extension}`);
      },
    }),
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || origin === 'null' || resolvedAllowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origen no permitido por CORS.'));
      },
    }),
  );
  app.use(
    express.json({
      limit: '25mb',
    }),
  );
  app.use('/images', express.static(runtimePaths.imagesDirectory));
  app.use((request, response, next) => {
    const startedAt = Date.now();

    logServerEvent('HTTP', `${request.method} ${request.originalUrl}`, {
      ip: request.ip,
    });

    response.on('finish', () => {
      logServerEvent(
        'HTTP',
        `${request.method} ${request.originalUrl} -> ${response.statusCode} en ${Date.now() - startedAt} ms`,
      );
    });

    next();
  });

  app.get('/health', (_request, response) => {
    logServerEvent('HEALTH', 'Health check respondido con OK.');
    response.json({ ok: true });
  });

  app.get('/manual', async (_request, response) => {
    try {
      const manualPayload = await readManualPayload(runtimePaths);

      logServerEvent('LOAD', 'Manual cargado correctamente.', {
        runtimeDataDirectory: runtimePaths.runtimeDataDirectory,
        legacyManualFilePath: runtimePaths.legacyManualFilePath,
      });

      response.status(200).json(manualPayload);
    } catch (error) {
      console.error(
        `[${formatTimestamp()}] [LOAD] No se pudo leer manual.json desde disco.`,
        error,
      );
      response.status(500).json({
        error: 'No se pudo leer manual.json desde disco.',
      });
    }
  });

  app.get('/check-endpoint', async (request, response) => {
    const target = normalizeEndpointTarget(request.query.url);

    if (!target) {
      response.status(400).json({
        ok: false,
        reason: 'invalid-url',
      });
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const endpointResponse = await fetch(target, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
        });

        response.status(200).json({
          ok: endpointResponse.ok,
          status: endpointResponse.status,
          statusText: endpointResponse.statusText,
          url: target,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      logServerEvent('CHECK', 'Error comprobando endpoint.', {
        target,
        error: error instanceof Error ? error.message : String(error),
      });
      response.status(200).json({
        ok: false,
        reason: 'request-failed',
        url: target,
      });
    }
  });

  app.post('/save-manual', async (request, response) => {
    const requestBody = request.body;
    const usesEnvelope =
      requestBody &&
      typeof requestBody === 'object' &&
      !Array.isArray(requestBody) &&
      'data' in requestBody;
    const manualData = usesEnvelope ? requestBody.data : requestBody;
    const expectedRevision =
      usesEnvelope && typeof requestBody.expectedRevision === 'string'
        ? requestBody.expectedRevision
        : undefined;

    if (!manualData || typeof manualData !== 'object' || Array.isArray(manualData)) {
      logServerEvent('SAVE', 'Peticion rechazada: body no valido para guardado.');
      response.status(400).json({
        error: 'El cuerpo de la peticion debe ser un objeto con el manual completo.',
      });
      return;
    }

    try {
      if (expectedRevision) {
        const currentRevision = await getManualRevision(runtimePaths);

        if (currentRevision !== expectedRevision) {
          logServerEvent('SAVE', 'Conflicto de revision detectado al guardar.', {
            currentRevision,
            expectedRevision,
          });
          response.status(409).json({
            currentRevision,
            error: 'save-conflict',
            message:
              'El manual ha cambiado en disco desde que esta instancia lo cargo.',
          });
          return;
        }
      }

      logServerEvent('SAVE', 'Inicio de persistencia de manual.', {
        totalCategorias: Array.isArray(manualData.categories)
          ? manualData.categories.length
          : 0,
        totalEntradas: Array.isArray(manualData.entries) ? manualData.entries.length : 0,
        totalPlantillas: Array.isArray(manualData.templates)
          ? manualData.templates.length
          : 0,
        totalPapelera: Array.isArray(manualData.trash) ? manualData.trash.length : 0,
      });

      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilePath = path.join(
        runtimePaths.backupsDirectory,
        `manual_${backupTimestamp}.json`,
      );

      try {
        const currentManualSnapshot = await readManualFile(runtimePaths);
        await writeJsonFile(backupFilePath, currentManualSnapshot);
        logServerEvent('SAVE', 'Backup previo generado.', { backupFilePath });
      } catch (error) {
        const fileMissing =
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT';

        if (!fileMissing) {
          throw error;
        }

        logServerEvent(
          'SAVE',
          'No existia manual previo; se omite la copia de seguridad inicial.',
        );
      }

      // Si esta logica de escritura en disco se traslada a Java, es obligatorio
      // el uso de try-catch-resources para el manejo de FileWriter,
      // BufferedWriter y otros flujos de salida, garantizando el cierre seguro de
      // descriptores en JBoss.
      await writeBlockManualData(runtimePaths, manualData);

      await cleanupOrphanedImages(runtimePaths.imagesDirectory, manualData);

      logServerEvent('SAVE', 'Manual actualizado en disco correctamente.', {
        runtimeDataDirectory: runtimePaths.runtimeDataDirectory,
        legacyManualFilePath: runtimePaths.legacyManualFilePath,
        totalCategorias: Array.isArray(manualData.categories)
          ? manualData.categories.length
          : 0,
        totalEntradas: Array.isArray(manualData.entries) ? manualData.entries.length : 0,
        totalPlantillas: Array.isArray(manualData.templates)
          ? manualData.templates.length
          : 0,
        totalPapelera: Array.isArray(manualData.trash) ? manualData.trash.length : 0,
      });
      response.status(200).json({
        ok: true,
        revision: await getManualRevision(runtimePaths),
      });
    } catch (error) {
      console.error(
        `[${formatTimestamp()}] [SAVE] No se pudo guardar manual.json en disco.`,
        error,
      );
      response.status(500).json({
        error: 'No se pudo guardar manual.json en disco.',
      });
    }
  });

  app.post('/save-manual-blocks', async (request, response) => {
    const requestBody = request.body;
    const usesEnvelope =
      requestBody &&
      typeof requestBody === 'object' &&
      !Array.isArray(requestBody) &&
      'data' in requestBody;
    const manualPatch = usesEnvelope ? requestBody.data : requestBody;
    const expectedRevision =
      usesEnvelope && typeof requestBody.expectedRevision === 'string'
        ? requestBody.expectedRevision
        : undefined;

    if (!manualPatch || typeof manualPatch !== 'object' || Array.isArray(manualPatch)) {
      logServerEvent('SAVE-BLOCKS', 'Peticion rechazada: body no valido para guardado por bloques.');
      response.status(400).json({
        error: 'El cuerpo de la peticion debe ser un objeto con bloques del manual.',
      });
      return;
    }

    try {
      if (expectedRevision) {
        const currentRevision = await getManualRevision(runtimePaths);

        if (currentRevision !== expectedRevision) {
          logServerEvent('SAVE-BLOCKS', 'Conflicto de revision detectado al guardar por bloques.', {
            currentRevision,
            expectedRevision,
          });
          response.status(409).json({
            currentRevision,
            error: 'save-conflict',
            message:
              'El manual ha cambiado en disco desde que esta instancia lo cargo.',
          });
          return;
        }
      }

      const currentManualSnapshot = await readManualFile(runtimePaths);
      const { nextManualData, removedEntryChunkKeys } = applyManualPatch(
        currentManualSnapshot,
        manualPatch,
      );

      logServerEvent('SAVE-BLOCKS', 'Inicio de persistencia incremental.', {
        changedCategories: Array.isArray(manualPatch.categories),
        changedDeletedCategories: Array.isArray(manualPatch.deletedCategories),
        changedEntryChunks:
          manualPatch.entryChunks && typeof manualPatch.entryChunks === 'object'
            ? Object.keys(manualPatch.entryChunks).length
            : 0,
        changedSettings: Boolean(manualPatch.settings),
        changedTemplates: Array.isArray(manualPatch.templates),
        changedTrash: Array.isArray(manualPatch.trash),
        removedEntryChunks: removedEntryChunkKeys.length,
      });

      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilePath = path.join(
        runtimePaths.backupsDirectory,
        `manual_${backupTimestamp}.json`,
      );
      await writeJsonFile(backupFilePath, currentManualSnapshot);

      await fs.promises.mkdir(runtimePaths.runtimeDataDirectory, { recursive: true });

      const writes = [];

      if (Array.isArray(manualPatch.categories)) {
        writes.push(
          writeJsonFile(runtimePaths.categoriesFilePath, nextManualData.categories ?? []),
        );
      }

      if (Array.isArray(manualPatch.deletedCategories)) {
        writes.push(
          writeJsonFile(
            runtimePaths.deletedCategoriesFilePath,
            nextManualData.deletedCategories ?? [],
          ),
        );
      }

      if (manualPatch.settings && typeof manualPatch.settings === 'object') {
        writes.push(writeJsonFile(runtimePaths.settingsFilePath, nextManualData.settings ?? {}));
      }

      if (Array.isArray(manualPatch.templates)) {
        writes.push(
          writeJsonFile(runtimePaths.templatesFilePath, nextManualData.templates ?? []),
        );
      }

      if (Array.isArray(manualPatch.trash)) {
        writes.push(writeJsonFile(runtimePaths.trashFilePath, nextManualData.trash ?? []));
      }

      if (
        (manualPatch.entryChunks && typeof manualPatch.entryChunks === 'object') ||
        removedEntryChunkKeys.length
      ) {
        writes.push(
          writeEntryChunks(
            runtimePaths,
            manualPatch.entryChunks && typeof manualPatch.entryChunks === 'object'
              ? manualPatch.entryChunks
              : {},
            removedEntryChunkKeys,
          ),
        );
      }

      if (runtimePaths.legacyManualFilePath) {
        writes.push(writeJsonFile(runtimePaths.legacyManualFilePath, nextManualData));
      }

      await Promise.all(writes);
      await cleanupOrphanedImages(runtimePaths.imagesDirectory, nextManualData);

      response.status(200).json({
        ok: true,
        revision: await getManualRevision(runtimePaths),
      });
    } catch (error) {
      console.error(
        `[${formatTimestamp()}] [SAVE-BLOCKS] No se pudo guardar el manual por bloques.`,
        error,
      );
      response.status(500).json({
        error: 'No se pudo guardar el manual por bloques.',
      });
    }
  });

  app.post('/upload', upload.single('image'), (request, response) => {
    logServerEvent('UPLOAD', 'Recibida peticion de subida de imagen.');

    if (!request.file) {
      logServerEvent('UPLOAD', 'La subida ha llegado sin archivo adjunto.');
      response.status(400).json({ error: 'No se ha recibido ningun archivo.' });
      return;
    }

    logServerEvent('UPLOAD', 'Imagen almacenada correctamente.', {
      filename: request.file.filename,
      originalName: request.file.originalname,
      size: request.file.size,
    });

    response.status(201).json({
      filename: request.file.filename,
      path: `/images/${request.file.filename}`,
    });
  });

  if (serveStatic && fs.existsSync(runtimePaths.staticDistDirectory)) {
    app.use(express.static(runtimePaths.staticDistDirectory));
    app.get(/.*/, (_request, response) => {
      response.sendFile(path.join(runtimePaths.staticDistDirectory, 'index.html'));
    });
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      server.ref();

      logServerEvent('BOOT', 'Servidor de imagenes y persistencia iniciado.', {
        allowedOrigins: Array.from(resolvedAllowedOrigins),
        backupsDirectory: runtimePaths.backupsDirectory,
        imagesDirectory: runtimePaths.imagesDirectory,
        legacyManualFilePath: runtimePaths.legacyManualFilePath,
        port,
        runtimeDataDirectory: runtimePaths.runtimeDataDirectory,
        serveStatic,
        staticDistDirectory: runtimePaths.staticDistDirectory,
      });

      resolve({
        app,
        port,
        runtimePaths,
        server,
      });
    });

    server.on('error', (error) => {
      reject(error);
    });
  });
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === currentFilePath;

if (isDirectExecution) {
  try {
    globalThis.__asistenteOnesaitServerRuntime = await startServer({
      port: defaultPort,
      serveStatic: directServeStatic,
    });
    globalThis.__asistenteOnesaitKeepAliveInterval = setInterval(() => {}, 60_000);
  } catch (error) {
    console.error(`[${formatTimestamp()}] [BOOT] No se pudo iniciar el servidor.`, error);
    process.exit(1);
  }
}
