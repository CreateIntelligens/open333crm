/**
 * Service to perform hybrid search combining Vector and FTS results.
 * Uses a simplified Reciprocal Rank Fusion (RRF) approach.
 */
export class HybridSearchService {
  /**
   * Merges and re-ranks results from Vector and FTS searches.
   * @param vectorResults Results from semantic search
   * @param ftsResults Results from keyword search
   * @param vectorWeight Importance of vector results (0-1)
   * @returns Merged and sorted results
   */
  merge(vectorResults: any[], ftsResults: any[], vectorWeight = 0.7): any[] {
    const scores = new Map<string, number>();
    const items = new Map<string, any>();

    // Helper to calculate RRF-like score
    const processResults = (list: any[], weight: number) => {
      list.forEach((item, index) => {
        const id = item.id || item.articleId;
        items.set(id, item);
        
        // Simple weight-based additive scoring for MVP
        // In a real RRF, it would be 1 / (60 + rank)
        const currentScore = scores.get(id) || 0;
        const newScore = currentScore + (weight * (1 / (index + 1)));
        scores.set(id, newScore);
      });
    };

    processResults(vectorResults, vectorWeight);
    processResults(ftsResults, 1 - vectorWeight);

    // Sort by final score
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => items.get(id));
  }
}
