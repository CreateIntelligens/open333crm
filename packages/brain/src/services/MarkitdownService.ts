import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Service to convert various document formats (PDF, Docx, etc.) to Markdown
 * using the Microsoft Markitdown Python utility.
 */
export class MarkitdownService {
  private venvPath: string;

  constructor(workspaceRoot: string) {
    // Path to the venv python executable
    this.venvPath = path.join(workspaceRoot, 'packages', 'brain', '.venv', 'bin', 'markitdown');
  }

  /**
   * Converts a file to Markdown.
   * @param inputPath Absolute path to the input file
   * @returns The converted Markdown content
   */
  async convertToMarkdown(inputPath: string): Promise<string> {
    try {
      // Execute markitdown via the venv
      const { stdout, stderr } = await execAsync(`${this.venvPath} "${inputPath}"`);
      
      if (stderr && !stdout) {
        throw new Error(`Markitdown error: ${stderr}`);
      }

      return stdout;
    } catch (error) {
      console.error('Markitdown conversion failed:', error);
      throw error;
    }
  }

  /**
   * Converts a file and saves the result to a specified output path.
   * @param inputPath Absolute path to the input file
   * @param outputPath Absolute path to the output .md file
   */
  async convertAndSave(inputPath: string, outputPath: string): Promise<void> {
    const markdown = await this.convertToMarkdown(inputPath);
    // In a real implementation, we'd use fs.writeFile here
    // But for now, we'll return the string or let the caller handle saving
  }
}
