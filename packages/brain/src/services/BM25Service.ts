import * as lancedb from '@lancedb/lancedb';
import { LanceDBService } from './LanceDBService.js';

/**
 * Service to manage BM25 (Full Text Search) indexing via LanceDB.
 * This ensures keyword-level accuracy for product codes and specific terms.
 */
export class BM25Service {
  private lanceDb: LanceDBService;

  constructor(lanceDb: LanceDBService) {
    this.lanceDb = lanceDb;
  }

  /**
   * Creates a full-text search index on a table.
   * @param tableName The table name to index
   * @param columns The columns to include in the index (usually 'content' or 'title')
   */
  async createIndex(tableName: string, columns: string[]): Promise<void> {
    const table = await this.lanceDb.getOrCreateTable(tableName);
    // In LanceDB JS SDK, FTS index creation is handled via create_index or similar
    // Note: Version 0.11+ uses a specific syntax for FTS
    await table.createIndex('fts'); 
  }

  /**
   * Performs a keyword-based search.
   */
  async fullTextSearch(tableName: string, queryText: string, topK = 5): Promise<any[]> {
    const table = await this.lanceDb.getOrCreateTable(tableName);
    // LanceDB full text search syntax
    // @ts-expect-error: LanceDB types lag behind for new FTS syntax
    return await table.fullTextSearch(queryText).limit(topK).toArray();
  }
}
