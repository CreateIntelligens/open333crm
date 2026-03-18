import { MemoryService } from './MemoryService.js';
import { LanceDBService } from './LanceDBService.js';
import { HybridSearchService } from './HybridSearchService.js';
import { BM25Service } from './BM25Service.js';

export interface BrainOptions {
  ltmThreshold: number; // e.g., 0.82
  topK: number;
}

/**
 * Orchestrator Service for the Brain module.
 * Manages hybrid search and similarity-triggered memory retrieval.
 */
export class BrainService {
  private lanceDb: LanceDBService;
  private memoryService: MemoryService;
  private hybridSearch: HybridSearchService;
  private bm25: BM25Service;

  constructor(
    lanceDb: LanceDBService,
    memoryService: MemoryService,
    hybridSearch: HybridSearchService,
    bm25: BM25Service
  ) {
    this.lanceDb = lanceDb;
    this.memoryService = memoryService;
    this.hybridSearch = hybridSearch;
    this.bm25 = bm25;
  }

  /**
   * Generates a context-aware suggestion by combining KM and LTM.
   */
  async getContext(
    queryText: string,
    queryVector: number[],
    contactId: string,
    teamId?: string,
    options: BrainOptions = { ltmThreshold: 0.82, topK: 5 }
  ) {
    // 1. KM Search (Hybrid) with team isolation
    // Filter: (teamId = 'user-team') OR (teamId IS NULL) - for global KM
    const kmFilter = teamId ? `teamId = '${teamId}' OR teamId IS NULL` : 'teamId IS NULL';
    const vectorResults = await this.lanceDb.vectorSearch('km_articles', queryVector, options.topK, kmFilter);
    const ftsResults = await this.bm25.fullTextSearch('km_articles', queryText, options.topK);
    const kmContext = this.hybridSearch.merge(vectorResults, ftsResults);

    // 2. LTM Search (On-demand)
    let memories: any[] = [];
    const pastMemories = await this.memoryService.searchMemories(contactId, queryVector, 3);
    
    // Check for similarity threshold (sim-triggered retrieval)
    // Note: This logic assumes queryVector and memory vectors are compared.
    // In actual implementation, we'd check distance/similarity from 'pastMemories' results metadata.
    if (pastMemories.length > 0) {
      // Simplified: If we found anything within the vector search limit, it might be relevant
      // In Task 4.3 we specifically mentioned the 0.82 threshold
      memories = pastMemories.filter(m => {
        const similarity = m._distance ? (1 - m._distance) : 0; // LanceDB distance to similarity
        return similarity >= options.ltmThreshold;
      });
    }

    return {
      km: kmContext,
      memories: memories,
      triggeredLTM: memories.length > 0
    };
  }
}
