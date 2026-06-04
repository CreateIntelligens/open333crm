export interface CliOutput {
  log(message?: string, ...args: unknown[]): void;
}

export const consoleOutput: CliOutput = {
  log(message?: string, ...args: unknown[]): void {
    if (message === undefined && args.length === 0) {
      console.log();
      return;
    }

    console.log(message, ...args);
  },
};
