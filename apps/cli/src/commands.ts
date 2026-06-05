import type { Command } from '@oclif/core';
import Apis from './commands/apis.js';
import Login from './commands/login.js';
import Stats from './commands/stats.js';
import Status from './commands/status.js';

export default {
  apis: Apis,
  login: Login,
  stats: Stats,
  status: Status,
} satisfies Record<string, Command.Class>;
