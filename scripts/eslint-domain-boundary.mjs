import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
  'next',
  'fastify',
  'drizzle-orm',
  'drizzle-kit',
  'google-auth-library',
  'openid-client',
  '@digital-autograph/db',
  '@digital-autograph/integrations',
];
const namespaces = ['@aws-sdk/', '@fastify/'];
const forbiddenPaths = ['apps', 'packages/db', 'packages/integrations'].map(
  (path) => resolve(root, path).toLowerCase(),
);

function text(node) {
  if (typeof node?.value === 'string') return node.value;
  if (node?.type === 'TSLiteralType') return text(node.literal);
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return undefined;
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      dependency:
        'Domain rules must not depend on frameworks, persistence or provider adapters (AGENTS.md).',
    },
  },
  create(context) {
    const inspect = (node, source) => {
      const name = text(source);
      if (!name) return;
      const target = name.startsWith('.')
        ? resolve(dirname(context.filename), name).toLowerCase()
        : undefined;
      if (
        packages.some((pkg) => name === pkg || name.startsWith(`${pkg}/`)) ||
        namespaces.some((prefix) => name.startsWith(prefix)) ||
        (target &&
          forbiddenPaths.some(
            (path) => target === path || target.startsWith(`${path}${sep}`),
          ))
      )
        context.report({ node, messageId: 'dependency' });
    };
    return {
      ImportDeclaration: (node) => inspect(node, node.source),
      ExportNamedDeclaration: (node) => inspect(node, node.source),
      ExportAllDeclaration: (node) => inspect(node, node.source),
      ImportExpression: (node) => inspect(node, node.source),
      TSImportType: (node) => inspect(node, node.source),
      TSExternalModuleReference: (node) => inspect(node, node.expression),
      CallExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          inspect(node, node.arguments[0]);
      },
    };
  },
};
