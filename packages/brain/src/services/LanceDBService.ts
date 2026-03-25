import * as lancedb from '@lancedb/lancedb';
import path from 'node:path';

/**
 * Service to manage LanceDB vector storage and retrieval.
 */
export class LanceDBService {
  private dbPath: string;
  private connection?: lancedb.Connection;

  constructor(workspacePath: string) {
    this.dbPath = path.join(workspacePath, 'lancedb');
  }

  /**
   * Connects to the database and initializes tables if necessary.
   */
  async connect(): Promise<lancedb.Connection> {
    if (this.connection) return this.connection;
    this.connection = await lancedb.connect(this.dbPath);
    return this.connection;
  }

  /**
   * Retrieves a table or creates it if it doesn't exist.
   */
  async getOrCreateTable(tableName: string, data?: any[]): Promise<lancedb.Table> {
    const conn = await this.connect();
    const tables = await conn.tableNames();
    
    if (tables.includes(tableName)) {
      return await conn.openTable(tableName);
    }
    
    if (!data) {
      throw new Error(`Table ${tableName} does not exist and no initial data provided.`);
    }

    return await conn.createTable(tableName, data);
  }

  /**
   * Performs a vector search on a table.
   */
  async vectorSearch(tableName: string, queryVector: number[], topK = 5, filter?: string): Promise<any[]> {
    const table = await this.getOrCreateTable(tableName);
    let query = table.vectorSearch(queryVector).limit(topK);
    
    if (filter) {
      query = query.where(filter);
    }
    
    return await query.toArray();
  }

  /**
   * Upserts data into a table.
   */
  async upsert(tableName: string, data: any[]): Promise<void> {
    const table = await this.getOrCreateTable(tableName, data);
    // LanceDB doesn't have a direct upsert in some versions, often it's add + overwrite or merge
    // For now we'll do simple add
    await table.add(data);
  }
}
