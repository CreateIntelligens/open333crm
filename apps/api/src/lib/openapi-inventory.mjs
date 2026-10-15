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

function readOptionObject(source, afterPath) {
  let cursor = afterPath;
  while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  if (source[cursor] !== ',') return '';
  cursor += 1;
  while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  if (source[cursor] !== '{') return '';

  const start = cursor;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    const next = source[cursor + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && next === '/') {
      cursor = source.indexOf('\n', cursor);
      if (cursor < 0) return '';
      continue;
    }
    if (char === '/' && next === '*') {
      cursor = source.indexOf('*/', cursor + 2);
      if (cursor < 0) return '';
      cursor += 1;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, cursor + 1);
  }
  return '';
}

function authenticatedRoute(source, options) {
  const hasPluginAuth = /\b(?:fastify|app)\.addHook\(\s*['"](?:preHandler|onRequest)['"]\s*,\s*(?:\[[^\]]*\]\s*,?\s*)?(?:fastify|app)\.authenticate(?:PlatformSuperuser|JwtOrCliSession|JwtOrPartnerKey|CliSession)?\b/.test(source);
  const authGuards = new Set();
  const authHandlers = new Set();
  for (const match of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*[\[{][\s\S]{0,220}?(?:fastify|app)\.(?:authenticate(?:PlatformSuperuser|JwtOrCliSession|JwtOrPartnerKey|CliSession)?|requirePermission|requireRole)/g)) {
    authGuards.add(match[1]);
  }
  for (const match of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*async\b[\s\S]{0,350}?(?:fastify|app)\.(?:authenticate(?:PlatformSuperuser|JwtOrCliSession|JwtOrPartnerKey|CliSession)?|requirePermission|requireRole)|(?:const|let)\s+(\w+)\s*=\s*async\b[\s\S]{0,350}?\bauthenticateMcp\b/g)) {
    authHandlers.add(match[1] ?? match[2]);
  }
  if (hasPluginAuth) return true;
  if (/\b(?:fastify|app)\.(?:authenticate(?:PlatformSuperuser|JwtOrCliSession|JwtOrPartnerKey|CliSession)?|requirePermission|requireRole)\b|\bauthenticateMcp\b/.test(options)) return true;
  return [...authGuards, ...authHandlers].some((name) => new RegExp(`\\b${name}\\b`).test(options));
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
      const options = readOptionObject(sourceText, match.index + match[0].length);
      routes.push({
        method,
        path,
        tag: routeTag(file),
        source: file.replace(`${sourceRoot}/`, ''),
        authenticated: authenticatedRoute(sourceText, options),
      });
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

export function buildOpenApiDocument(routes) {
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
      ...(route.authenticated ? { security: [{ BearerAuth: [] }] } : {}),
      ...(['post', 'put', 'patch'].includes(route.method) ? {
        requestBody: {
          required: false,
          description: 'Generic JSON editor for Try it out. The exact request schema is undocumented.',
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
      } : {}),
      responses: { default: { description: 'Response contract is not documented yet.' } },
      'x-contract-status': isMcp ? 'protocol-documentation' : 'undocumented',
    };
  }
  const document = {
    openapi: '3.1.0',
    info: {
      title: 'Open333CRM API',
      version: '1.0.0',
      description: 'HTTP API reference with interactive requests. Operations marked undocumented use generic request bodies where applicable. Socket.IO events and MCP JSON-RPC methods have separate protocol documentation.',
    },
    servers: [{ url: '/', description: 'Current origin' }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT or API token',
          description: 'Enter a tenant access JWT, CLI session token, partner API key, or platform token as permitted by the operation.',
        },
      },
    },
    tags: [...new Set(routes.map((route) => route.tag))].sort().map((name) => ({ name })),
    'x-tagGroups': [{ name: 'HTTP API', tags: [...new Set(routes.map((route) => route.tag))].sort() }],
    paths,
  };
  return document;
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
  const document = buildOpenApiDocument(routes);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}
