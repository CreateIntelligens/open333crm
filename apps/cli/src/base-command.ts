import { Command } from '@oclif/core';
import { formatCliError } from './errors.js';

export abstract class Open333Command extends Command {
  protected async catch(err: Error): Promise<void> {
    console.error(formatCliError(err));
    process.exitCode = 1;
  }
}
