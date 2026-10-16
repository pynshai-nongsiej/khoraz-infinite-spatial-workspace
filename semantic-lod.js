/**
 * Deterministic semantic summaries and level-of-detail helpers for KhoraZ.
 *
 * These routines intentionally use only text heuristics. They are stable for
 * the same input, work offline, and are small enough to run during a render
 * pass or in a worker without a parser/runtime dependency.
 */

import { clampCamZoom } from './spatial-graph.js';

export const CONTENT_KINDS = Object.freeze({
  MARKDOWN: 'markdown',
  PROSE: 'prose',
  CODE: 'code',
});

export const DEFAULT_SUMMARY_MAX_LENGTH = 180;
export const DEFAULT_SUMMARY_SENTENCES = 2;

/**
 * LOD levels are expressed in log2 zoom stops. A positive bias reveals detail
 * earlier; a negative bias keeps the compact representation longer.
 */
export const LOD_TIERS = Object.freeze([
  Object.freeze({
    id: 'ambient',
    label: 'Ambient',
    minLevel: -Infinity,
    maxLevel: -0.5,
    representation: 'marker',
  }),
  Object.freeze({
    id: 'summary',
    label: 'Summary',
    minLevel: -0.5,
    maxLevel: 0.75,
    representation: 'title-summary',
  }),
  Object.freeze({
    id: 'detail',
    label: 'Detail',
    minLevel: 0.75,
    maxLevel: 1.75,
    representation: 'excerpt',
  }),
  Object.freeze({
    id: 'full',
    label: 'Full',
    minLevel: 1.75,
    maxLevel: Infinity,
    representation: 'content',
  }),
]);

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their',
  'this', 'to', 'was', 'were', 'will', 'with', 'you', 'your', 'we', 'our',
  'not', 'but', 'can', 'into', 'than', 'then', 'they', 'these', 'those',
]);

const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));

const asText = (input) => {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '';
  if (typeof input === 'object') {
    return String(input.content ?? input.text ?? input.body ?? input.source ?? '');
  }
  return String(input);
};

const inputMetadata = (input) => (input && typeof input === 'object' ? input : {});

const normalizeKind = (kind) => {
  const value = String(kind ?? '').toLowerCase();
  if (value === 'md' || value === 'markdown' || value === 'mdx') return CONTENT_KINDS.MARKDOWN;
  if (value === 'code' || value === 'source' || value === 'program') return CONTENT_KINDS.CODE;
  if (value === 'text' || value === 'prose' || value === 'plain' || value === 'plaintext') return CONTENT_KINDS.PROSE;
  return undefined;
};

const extensionKind = (path = '') => {
  const extension = String(path).toLowerCase().split('.').pop();
  if (['md', 'markdown', 'mdx'].includes(extension)) return CONTENT_KINDS.MARKDOWN;
  if ([
    'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js',
    'jsx', 'json', 'kt', 'lua', 'php', 'py', 'rb', 'rs', 'sh', 'sql', 'swift',
    'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml',
  ].includes(extension)) return CONTENT_KINDS.CODE;
  return undefined;
};

const hasMarkdownShape = (text) => {
  const lines = text.split(/\r?\n/);
  return lines.some((line) => /^\s{0,3}(?:#{1,6}\s|[-*+]\s|>\s|```)/.test(line));
};

const hasCodeShape = (text) => {
  const signals = [
    /^\s*(?:import|export|const|let|var|function|class|interface|type|enum|def|fn|func|package|#include)\b/m,
    /[{};]\s*$/m,
    /=>|===|!==|\breturn\b|\bconsole\./,
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 2;
};

/** Infer a stable content kind, with explicit metadata taking precedence. */
export function detectContentKind(input, options = {}) {
  const text = asText(input);
  const metadata = { ...inputMetadata(input), ...options };
  const explicit = normalizeKind(metadata.kind ?? metadata.type ?? metadata.format);
  if (explicit) return explicit;
  const byPath = extensionKind(metadata.path ?? metadata.filePath ?? metadata.filename);
  if (byPath) return byPath;
  if (hasMarkdownShape(text)) return CONTENT_KINDS.MARKDOWN;
  if (/```[\s\S]*```/.test(text) || hasCodeShape(text)) return CONTENT_KINDS.CODE;
  return CONTENT_KINDS.PROSE;
}

const stripFrontMatter = (text) => text.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/, '');

/** Remove presentation markup while preserving words and sentence order. */
export function stripMarkup(input) {
  let text = stripFrontMatter(asText(input));
  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

const splitSentences = (text) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [normalized];
};

const truncate = (text, maxLength = DEFAULT_SUMMARY_MAX_LENGTH) => {
  const limit = Math.max(1, Math.floor(finite(maxLength, DEFAULT_SUMMARY_MAX_LENGTH)));
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  const candidate = value.slice(0, Math.max(1, limit - 1)).replace(/\s+\S*$/, '').trim();
  return `${candidate || value.slice(0, limit - 1).trim()}…`;
};

const wordsFrom = (text) => String(text ?? '').toLowerCase().match(/[a-z][a-z0-9'-]{1,}/g) ?? [];

/** Deterministic FNV-1a hash for cache keys and renderer invalidation. */
export function stableHash(input) {
  const text = asText(input);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Extract the most representative words using frequency then source order. */
export function extractKeywords(input, options = {}) {
  const maxKeywords = Math.max(1, Math.floor(finite(options.maxKeywords, 6)));
  const counts = new Map();
  const firstSeen = new Map();
  let position = 0;
  for (const word of wordsFrom(stripMarkup(input))) {
    const normalized = word.replace(/^['-]+|['-]+$/g, '');
    if (normalized.length < 3 || STOP_WORDS.has(normalized)) {
      position += 1;
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    if (!firstSeen.has(normalized)) firstSeen.set(normalized, position);
    position += 1;
  }
  return [...counts.keys()]
    .sort((a, b) => (counts.get(b) - counts.get(a)) || (firstSeen.get(a) - firstSeen.get(b)) || a.localeCompare(b))
    .slice(0, maxKeywords);
}

const markdownDetails = (text) => {
  const lines = stripFrontMatter(text).split(/\r?\n/);
  const headings = [];
  const paragraphs = [];
  let paragraph = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (paragraph.length) paragraphs.push(paragraph.join(' '));
      paragraph = [];
      headings.push(stripMarkup(heading[1]));
    } else if (line.trim()) {
      paragraph.push(line.trim());
    } else if (paragraph.length) {
      paragraphs.push(paragraph.join(' '));
      paragraph = [];
    }
  }
  if (paragraph.length) paragraphs.push(paragraph.join(' '));
  return { headings, paragraphs };
};

const languageFrom = (input) => {
  const metadata = inputMetadata(input);
  if (metadata.language) return String(metadata.language).toLowerCase();
  const path = metadata.path ?? metadata.filePath ?? metadata.filename ?? '';
  const extension = String(path).toLowerCase().split('.').pop();
  return extension && extension !== String(path).toLowerCase() ? extension : undefined;
};

const codeDetails = (text) => {
  const declarations = [];
  const declarationPattern = /\b(?:class|function|interface|type|enum|struct|trait|def|fn|func)\s+([A-Za-z_$][\w$-]*)/g;
  let match;
  while ((match = declarationPattern.exec(text))) {
    if (!declarations.includes(match[1])) declarations.push(match[1]);
  }
  const exports = [];
  const exportPattern = /\bexport\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)?\s*([A-Za-z_$][\w$-]*)?/g;
  while ((match = exportPattern.exec(text))) {
    if (match[1] && !exports.includes(match[1])) exports.push(match[1]);
  }
  const lines = text.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim()).length;
  const commentLines = lines.filter((line) => /^\s*(?:\/\/|\/\*|\*|#|<!--)/.test(line)).length;
  return { declarations, exports, lines: lines.length, nonEmptyLines, commentLines };
};

const makeCodeSummary = (details, language) => {
  const subjects = [...details.declarations, ...details.exports.filter((name) => !details.declarations.includes(name))].slice(0, 4);
  const languagePart = language ? `${language} ` : '';
  if (subjects.length) return `Code (${languagePart.trim() || 'source'}) defining ${subjects.join(', ')}.`;
  return `Code (${languagePart.trim() || 'source'}) with ${details.nonEmptyLines} non-empty lines.`;
};

const makeProseSummary = (text, maxSentences) => splitSentences(stripMarkup(text)).slice(0, maxSentences).join(' ');

const statsFor = (text) => ({
  characters: text.length,
  words: wordsFrom(text).length,
  lines: text ? text.split(/\r?\n/).length : 0,
  nonEmptyLines: text ? text.split(/\r?\n/).filter((line) => line.trim()).length : 0,
});

/**
 * Build a stable summary object for Markdown, prose, or source code.
 * `input` may be a string or `{ content, kind, path, language }`.
 */
export function summarizeSemantic(input, options = {}) {
  const text = asText(input);
  const metadata = { ...inputMetadata(input), ...options };
  const kind = detectContentKind(input, options);
  const maxLength = finite(options.maxLength, DEFAULT_SUMMARY_MAX_LENGTH);
  const maxSentences = Math.max(1, Math.floor(finite(options.sentences, DEFAULT_SUMMARY_SENTENCES)));
  let title;
  let headings = [];
  let summarySource = '';
  let code;

  if (kind === CONTENT_KINDS.MARKDOWN) {
    const details = markdownDetails(text);
    headings = details.headings;
    title = details.headings[0];
    summarySource = details.paragraphs
      .map((paragraph) => stripMarkup(paragraph))
      .filter(Boolean)
      .join(' ');
    if (!summarySource && headings.length) summarySource = headings.slice(0, 2).join('. ');
  } else if (kind === CONTENT_KINDS.CODE) {
    code = codeDetails(text);
    summarySource = makeCodeSummary(code, languageFrom(input));
  } else {
    summarySource = makeProseSummary(text, maxSentences);
  }

  const summary = truncate(
    kind === CONTENT_KINDS.CODE ? summarySource : splitSentences(summarySource).slice(0, maxSentences).join(' '),
    maxLength,
  );
  const cleanText = stripMarkup(text);
  const result = {
    kind,
    title: title || undefined,
    summary,
    excerpt: truncate(cleanText, maxLength),
    keywords: extractKeywords(text, options),
    hash: stableHash(text),
    stats: statsFor(text),
  };
  if (headings.length) result.headings = headings;
  if (code) {
    result.language = languageFrom(input);
    result.code = code;
  }
  if (metadata.id !== undefined) result.sourceId = metadata.id;
  return result;
}

export const summarizeContent = summarizeSemantic;
export const semanticSummary = summarizeSemantic;

export const summarizeMarkdown = (input, options = {}) => summarizeSemantic(input, { ...options, kind: CONTENT_KINDS.MARKDOWN });
export const summarizeProse = (input, options = {}) => summarizeSemantic(input, { ...options, kind: CONTENT_KINDS.PROSE });
export const summarizeCode = (input, options = {}) => summarizeSemantic(input, { ...options, kind: CONTENT_KINDS.CODE });

const normalizeTiers = (tiers) => {
  const source = Array.isArray(tiers) && tiers.length ? tiers : LOD_TIERS;
  return source.map((tier, index) => {
    const minLevel = tier.minLevel === -Infinity
      ? -Infinity
      : finite(tier.minLevel, index === 0 ? -Infinity : 0);
    const maxLevel = tier.maxLevel === Infinity
      ? Infinity
      : finite(tier.maxLevel, index === source.length - 1 ? Infinity : 0);
    return {
      ...tier,
      id: tier.id ?? `tier-${index}`,
      label: tier.label ?? tier.id ?? `Tier ${index + 1}`,
      minLevel,
      maxLevel,
      representation: tier.representation,
    };
  });
};

/** Convert camera zoom into a continuous semantic-detail level. */
export function getLodLevel(camZoom = 1, bias = 0) {
  const zoom = typeof camZoom === 'object' ? camZoom.camZoom ?? camZoom.zoom : camZoom;
  return Math.log2(clampCamZoom(zoom)) + finite(bias);
}

export const lodLevel = getLodLevel;

/** Apply a bias to a level without changing or clamping the level itself. */
export function applyLodBias(level, bias = 0) {
  return finite(level) + finite(bias);
}

export function removeLodBias(level, bias = 0) {
  return finite(level) - finite(bias);
}

/** Select the tier active at a camera zoom. Returns tier metadata, not only an id. */
export function selectLodTier(input = 1, options = {}) {
  const context = typeof input === 'object' ? input : { camZoom: input, ...options };
  const tiers = normalizeTiers(context.tiers ?? options.tiers);
  const level = context.level !== undefined
    ? applyLodBias(context.level, context.bias)
    : getLodLevel(context.camZoom ?? context.zoom ?? 1, context.bias);
  const index = Math.max(0, tiers.findIndex((tier) => level < tier.maxLevel));
  return {
    ...tiers[index === -1 ? tiers.length - 1 : index],
    index: index === -1 ? tiers.length - 1 : index,
    level,
  };
}

export function lodTierAtZoom(camZoom, bias = 0, tiers = LOD_TIERS) {
  if (camZoom && typeof camZoom === 'object') {
    return selectLodTier({ ...camZoom, bias: camZoom.bias ?? bias, tiers: camZoom.tiers ?? tiers });
  }
  return selectLodTier({ camZoom, bias, tiers });
}

export const getLodTier = lodTierAtZoom;

/** Smooth interpolation suitable for opacity/scale transitions. */
export function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** Crossfade between two representations with an optional easing function. */
export function crossfade(progress, easing = smoothstep) {
  const eased = typeof easing === 'function' ? easing(clamp01(progress)) : clamp01(progress);
  return clamp01(eased);
}

export function crossfadeOpacity(progress, role = 'to', easing = smoothstep) {
  const value = crossfade(progress, easing);
  return role === 'from' ? 1 - value : value;
}

/**
 * Return the active transition near a tier boundary. Outside a fade window,
 * the active representation is opaque and `to` is null.
 */
export function lodCrossfade(input = 1, options = {}) {
  const context = typeof input === 'object' ? input : { camZoom: input, ...options };
  const tiers = normalizeTiers(context.tiers ?? options.tiers);
  const level = context.level !== undefined
    ? applyLodBias(context.level, context.bias)
    : getLodLevel(context.camZoom ?? context.zoom ?? 1, context.bias);
  const fadeWidth = Math.max(0, finite(context.fadeWidth ?? options.fadeWidth, 0.2));

  for (let index = 0; index < tiers.length - 1; index += 1) {
    const boundary = tiers[index].maxLevel;
    if (!Number.isFinite(boundary)) continue;
    const distance = level - boundary;
    if (fadeWidth > 0 && Math.abs(distance) <= fadeWidth) {
      const progress = crossfade((distance + fadeWidth) / (2 * fadeWidth));
      return {
        from: tiers[index],
        to: tiers[index + 1],
        progress,
        fromOpacity: 1 - progress,
        toOpacity: progress,
        level,
        boundary,
      };
    }
  }

  const active = selectLodTier({ level, tiers });
  return {
    from: active,
    to: null,
    progress: 0,
    fromOpacity: 1,
    toOpacity: 0,
    level,
    boundary: undefined,
  };
}

export const getLodCrossfade = lodCrossfade;
export const getLodBlend = lodCrossfade;

/**
 * Compact adapter for renderers that only need a numeric semantic level.
 * Item-local `lodBias` is additive and optional; the item itself otherwise
 * remains renderer-owned data.
 */
export function getLOD(itemOrZoom = 1, context = {}) {
  const item = itemOrZoom && typeof itemOrZoom === 'object' ? itemOrZoom : {};
  const zoom = typeof itemOrZoom === 'object'
    ? context.camZoom ?? context.zoom ?? 1
    : itemOrZoom;
  return getLodLevel(zoom, finite(context.bias) + finite(item.lodBias));
}

export const resolveLOD = getLOD;
export const computeLOD = getLOD;
export const semanticLOD = getLOD;
export const levelOfDetail = getLOD;

/** Combine a semantic summary with the representation a renderer should use. */
export function resolveSemanticLod(input, context = {}) {
  const summary = input?.summary !== undefined && input?.kind ? input : summarizeSemantic(input, context);
  const tier = selectLodTier(context);
  const transition = lodCrossfade(context);
  return {
    summary,
    tier,
    transition,
    representation: tier.representation,
  };
}

export default summarizeSemantic;
