const { jaccardPercent, normalizeWordSet, findSimilarOpenProjects } = require('../utils/projectTextSimilarity');

describe('projectTextSimilarity', () => {
  it('jaccard is 100 for identical word sets', () => {
    const s = normalizeWordSet('machine learning for healthcare applications');
    expect(jaccardPercent(s, new Set(s))).toBe(100);
  });

  it('findSimilarOpenProjects ranks by combined overlap', () => {
    const current = { abstract: 'neural networks', description: 'deep learning vision tasks' };
    const others = [
      { id: 'a', title: 'Low', abstract: 'cooking recipes', description: 'pasta and sauce' },
      { id: 'b', title: 'High', abstract: 'neural networks for vision', description: 'deep learning and CNNs' },
    ];
    const { similar_projects } = findSimilarOpenProjects(current, others, { topK: 5, maxScan: 10 });
    expect(similar_projects[0].project_id).toBe('b');
    expect(similar_projects[0].match_percent).toBeGreaterThan(similar_projects[1].match_percent);
  });
});
