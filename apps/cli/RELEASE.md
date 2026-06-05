# Release

Build the package:

```bash
pnpm --filter @open333crm/cli build
```

Inspect package contents:

```bash
pnpm --filter @open333crm/cli exec npm pack --dry-run
```

Create a tarball and test the installed binary locally:

```bash
pnpm --filter @open333crm/cli exec npm pack
npm install -g ./apps/cli/open333crm-cli-0.1.0.tgz
open333 --help
open333 login --help
open333 status --help
open333 apis --help
open333 status
open333 apis
```

The published binary uses oclif command classes under the existing `open333` bin name. Keep command names, options, JSON output, and error formatting stable when adding new commands.

Publish:

```bash
pnpm --filter @open333crm/cli build
pnpm --filter @open333crm/cli exec npm pack --dry-run
pnpm --filter @open333crm/cli exec npm publish --access public
```
