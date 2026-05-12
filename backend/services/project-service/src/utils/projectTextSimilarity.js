/**
 * Lexical overlap similarity between project text fields (abstract + description).
 * Uses Jaccard similarity on word sets (tokens length > 2, alphanumeric) for interpretable 0–100% scores.
 */

const DEFAULT_SCAN_MAX = Number(process.env.SIMILARITY_SCAN_MAX || 2000);
const DEFAULT_TOP_K = Number(process.env.SIMILARITY_TOP_K || 15);

function normalizeWordSet(text) {
  if (text == null || typeof text !== 'string') return new Set();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

function jaccardPercent(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 100;
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union ? Math.round((100 * inter) / union) : 0;
}

/**
 * @param {string|null|undefined} currentAbstract
 * @param {string|null|undefined} currentDescription
 * @param {string|null|undefined} otherAbstract
 * @param {string|null|undefined} otherDescription
 * @returns {{ combined: number, abstract: number|null, description: number|null }}
 */
function similarityScores(currentAbstract, currentDescription, otherAbstract, otherDescription) {
  const curAbs = normalizeWordSet(currentAbstract || '');
  const curDesc = normalizeWordSet(currentDescription || '');
  const othAbs = normalizeWordSet(otherAbstract || '');
  const othDesc = normalizeWordSet(otherDescription || '');
  const curAll = new Set([...curAbs, ...curDesc]);
  const othAll = new Set([...othAbs, ...othDesc]);

  return {
    combined: jaccardPercent(curAll, othAll),
    abstract: curAbs.size > 0 && othAbs.size > 0 ? jaccardPercent(curAbs, othAbs) : null,
    description: curDesc.size > 0 && othDesc.size > 0 ? jaccardPercent(curDesc, othDesc) : null,
  };
}

/**
 * Rank other open projects by lexical overlap with the current project's abstract + description.
 *
 * @param {object} current - { abstract?, description? }
 * @param {Array<{ id: string, title: string, abstract?: string|null, description?: string|null }>} others
 * @param {{ topK?: number, maxScan?: number }} [opts]
 * @returns {{ similar_projects: Array<object>, projects_compared: number, similarity_method: string }}
 */
function findSimilarOpenProjects(current, others, opts = {}) {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const maxScan = opts.maxScan ?? DEFAULT_SCAN_MAX;

  const slice = others.slice(0, maxScan);
  const scored = slice.map((row) => {
    const scores = similarityScores(
      current.abstract,
      current.description,
      row.abstract,
      row.description
    );
    return {
      project_id: row.id,
      title: row.title,
      match_percent: scores.combined,
      breakdown: {
        combined: scores.combined,
        abstract: scores.abstract,
        description: scores.description,
      },
    };
  });

  scored.sort((a, b) => b.match_percent - a.match_percent || String(a.title).localeCompare(String(b.title)));

  const similar_projects = scored.slice(0, topK).filter((s) => s.match_percent > 0);

  return {
    similar_projects,
    projects_compared: slice.length,
    similarity_method: 'jaccard-word-overlap',
  };
}

module.exports = {
  findSimilarOpenProjects,
  similarityScores,
  jaccardPercent,
  normalizeWordSet,
};
