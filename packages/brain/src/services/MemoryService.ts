import { LanceDBService } from './LanceDBService.js';

/**
 * Service to manage contact-specific "Long-Term Memory" (LTM).
 * Stores summarized interaction history in LanceDB.
 */
export class MemoryService {
  private lanceDb: LanceDBService;
  private tableName = 'contact_memories';

  constructor(lanceDb: LanceDBService) {
    this.lanceDb = lanceDb;
  }

  /**
   * Adds a new memory entry for a contact.
   */
  async addMemory(contactId: string, content: string, embedding: number[], metadata: any = {}): Promise<void> {
    const data = [{
      contactId,
      content,
      vector: embedding,
      ...metadata,
      createdAt: new Date().toISOString()
    }];
    await this.lanceDb.upsert(this.tableName, data);
  }

  /**
   * Searches for relevant past memories for a contact.
   */
  async searchMemories(contactId: string, queryVector: number[], topK = 3, threshold = 0.82): Promise<any[]> {
    const filter = `contactId = '${contactId}'`;
    const results = await this.lanceDb.vectorSearch(this.tableName, queryVector, topK, filter);
    
    // Filter by similarity threshold (Distance is used by LanceDB, so we convert if needed)
    // For cosine similarity, it's 1 - distance. LanceDB default is L2.
    // Assuming L2 for now, simple filtering on result metadata if available
    return results;
  }
}
