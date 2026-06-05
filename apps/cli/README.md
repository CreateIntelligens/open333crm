# Open333 CLI

The `open333` binary is implemented with oclif command classes. The command helpers still reuse the same API client, profile config store, keychain credential adapter, and shared response types.

Install globally:

```bash
npm install -g @open333crm/cli
```

Log in:

```bash
open333 login --host https://crm.example.com --email agent@example.com
```

Check the current server and identity:

```bash
open333 status
```

List CLI endpoints and capabilities:

```bash
open333 apis
open333 apis --json
```

## Local Sandbox Install

Use this before publishing to npm. It builds the CLI, packs the same tarball npm would publish, installs it into a temporary prefix, and verifies the installed `open333` binary.

From the repo root:

```bash
pnpm cli:sandbox
```

Manual equivalent:

```bash
pnpm --filter @open333crm/cli build
mkdir -p /tmp/open333-npm-cache /tmp/open333-cli-sandbox
NPM_CONFIG_CACHE=/tmp/open333-npm-cache pnpm --filter @open333crm/cli exec npm pack
NPM_CONFIG_CACHE=/tmp/open333-npm-cache npm install --prefix /tmp/open333-cli-sandbox -g ./apps/cli/open333crm-cli-0.1.0.tgz
/tmp/open333-cli-sandbox/bin/open333 --help
/tmp/open333-cli-sandbox/bin/open333 login --help
/tmp/open333-cli-sandbox/bin/open333 status --help
/tmp/open333-cli-sandbox/bin/open333 apis --help
```

If the package version changes, use the tarball filename printed by `npm pack`.

Do not test this package from the monorepo root with:

```bash
npm i @open333crm/cli
```

That changes the workspace dependency tree and can mix npm resolution with the pnpm workspace. Use the sandbox prefix or a clean temporary directory instead.

The CLI stores host/profile metadata in local config and stores the raw CLI token in the OS keychain. For CI or tests, set `OPEN333_TOKEN` to provide an explicit token without using the keychain.
