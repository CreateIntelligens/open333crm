import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(apiRoot, '../..');
const sourceRoot = resolve(apiRoot, 'src');

function toOpenApiPath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/\*$/, '/{key}');
}

function routeTag(source) {
  const parts = source.replaceAll('\\', '/').split('/');
  if (parts.includes('modules')) return parts[parts.indexOf('modules') + 1];
  if (parts.includes('channels')) return parts[parts.indexOf('channels') + 1];
  return 'system';
}

function parseImports(source) {
  const imports = new Map();
  for (const match of source.matchAll(/^import\s+([^;]+?)\s+from\s*['"]([^'"]+routes\.js)['"];?/gm)) {
    const [, clause, importPath] = match;
    const routePath = importPath.replace(/\.js$/, '.ts');
    const defaultName = clause.match(/^\s*(\w+)/)?.[1];
    if (defaultName) imports.set(defaultName, routePath);
    const namedImports = clause.match(/\{([^}]+)\}/)?.[1];
    for (const named of namedImports?.split(',') ?? []) {
      const [imported, local] = named.trim().split(/\s+as\s+/);
      imports.set(local ?? imported, routePath);
    }
  }
  return imports;
}

function resolveRouteFile(importPath) {
  const file = resolve(sourceRoot, importPath.replace(/^\.\//, '').replace(/^(\.\.\/)+/, ''));
  return file.endsWith('.routes.ts') ? file : `${file}.routes.ts`;
}

export function collectOpenApiRoutes(apiSource, routeSourceByFile) {
  const imports = parseImports(apiSource);
  const mountPrefixes = new Map();
  for (const match of apiSource.matchAll(/\.register\(\s*(\w+)\s*,\s*\{[^}]*?prefix\s*:\s*['"]([^'"]*)['"]/gs)) {
    const [, symbol, prefix] = match;
    const routeFile = imports.get(symbol);
    if (!routeFile) continue;
    const file = resolveRouteFile(routeFile);
    mountPrefixes.set(file, [...(mountPrefixes.get(file) ?? []), prefix]);
  }
  for (const match of apiSource.matchAll(/\.register\(\s*(\w+)\s*\)/g)) {
    const routeFile = imports.get(match[1]);
    if (!routeFile) continue;
    const file = resolveRouteFile(routeFile);
    if (!mountPrefixes.has(file)) mountPrefixes.set(file, ['']);
  }

  const routes = [];
  const addRoutes = (sourceText, file, prefixes) => {
    const callPattern = /\b(?:fastify|app)\.(get|post|put|patch|delete|options|head)\s*(?:<[^>]+>)?\s*\(/g;
    const pathPattern = /\b(?:fastify|app)\.(get|post|put|patch|delete|options|head)\s*(?:<[^>]+>)?\s*\(\s*(['"])([^'"\n]+)\2/g;
    const callCount = [...sourceText.matchAll(callPattern)].length;
    const matches = [...sourceText.matchAll(pathPattern)];
    if (callCount !== matches.length) {
      throw new Error(`Found ${callCount - matches.length} HTTP route(s) without literal paths in ${file}`);
    }
    for (const match of matches) {
      const method = match[1].toLowerCase();
      const localPath = match[3];
      for (const prefix of prefixes) {
        const path = toOpenApiPath(`${prefix.replace(/\/$/, '')}/${localPath.replace(/^\//, '')}`.replace(/\/$/, '') || '/');
        routes.push({ method, path, tag: routeTag(file), source: file.replace(`${sourceRoot}/`, '') });
      }
    }
  };

  addRoutes(apiSource, resolve(sourceRoot, 'index.ts'), ['/']);
  for (const [file, prefixes] of mountPrefixes) {
    const contents = routeSourceByFile.get(file);
    if (contents) addRoutes(contents, file, prefixes);
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export async function generateOpenApi(outputPath = resolve(repoRoot, 'apps/web/public/openapi.json')) {
  const apiSource = await readFile(resolve(sourceRoot, 'index.ts'), 'utf8');
  const imports = parseImports(apiSource);
  const sources = new Map();
  for (const routeFile of new Set(imports.values())) {
    const file = resolveRouteFile(routeFile);
    try {
      sources.set(file, await readFile(file, 'utf8'));
    } catch {
      // The check below reports unresolved route modules instead of silently omitting them.
    }
  }
  const missing = [...new Set(imports.values())].map(resolveRouteFile).filter((file) => !sources.has(file));
  if (missing.length) throw new Error(`Cannot resolve registered route files: ${missing.join(', ')}`);

  const routes = collectOpenApiRoutes(apiSource, sources);
  if (!routes.length) throw new Error('No HTTP routes were discovered');
  const paths = {};
  for (const route of routes) {
    const parameters = [...route.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    paths[route.path] ??= {};
    if (paths[route.path][route.method]) {
      throw new Error(`Duplicate OpenAPI operation: ${route.method.toUpperCase()} ${route.path}`);
    }
    const isMcp = route.source.startsWith('modules/mcp/');
    paths[route.path][route.method] = {
      operationId: `${route.method}_${route.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      tags: [route.tag],
      summary: `${route.method.toUpperCase()} ${route.path}`,
      description: isMcp
        ? `MCP Streamable HTTP transport. JSON-RPC methods are described in the MCP protocol documentation. Source: ${route.source}.`
        : `Source: ${route.source}. Request and response schemas require route-level documentation.`,
      parameters,
      responses: { default: { description: 'Response contract is not documented yet.' } },
      'x-contract-status': isMcp ? 'protocol-documentation' : 'undocumented',
    };
  }
  const document = {
    openapi: '3.1.0',
    info: {
      title: 'Open333CRM API',
      version: '1.0.0',
      description: 'HTTP API route inventory. Socket.IO and MCP use separate protocol documentation. Request and response contracts marked undocumented need authored schemas.',
    },
    tags: [...new Set(routes.map((route) => route.tag))].sort().map((name) => ({ name })),
    'x-tagGroups': [{ name: 'HTTP API', tags: [...new Set(routes.map((route) => route.tag))].sort() }],
    paths,
  };
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}
