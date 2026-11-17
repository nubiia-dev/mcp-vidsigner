/**
 * Property paths of the types exported by `src/client/types.ts`, computed with the
 * TypeScript type checker. Used to verify that the client types every documented field.
 */
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve('src/client/types.ts');
const config = ts.readConfigFile(resolve('tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('.'));
const program = ts.createProgram([root], parsed.options);
const checker = program.getTypeChecker();

const PRIMITIVE =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.Never;

function flatten(type: ts.Type, prefix: string, out: Set<string>, stack: number[]): void {
  type = checker.getNonNullableType(type);
  if (type.flags & PRIMITIVE) return;
  if (type.isUnionOrIntersection()) {
    for (const t of type.types) flatten(t, prefix, out, stack);
    return;
  }
  if (checker.isArrayType(type)) {
    const el = checker.getTypeArguments(type as ts.TypeReference)[0];
    if (el) flatten(el, prefix, out, stack);
    return;
  }
  // `Record<string, ...>` or index signature: an open dictionary, with no fixed properties.
  const id = (type as unknown as { id: number }).id;
  if (stack.includes(id)) return;
  stack.push(id);
  for (const prop of type.getProperties()) {
    const path = prefix ? `${prefix}.${prop.getName()}` : prop.getName();
    out.add(path.toLowerCase());
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!decl) continue;
    flatten(checker.getTypeOfSymbolAtLocation(prop, decl), path, out, stack);
  }
  stack.pop();
}

/** Paths (lowercase, without array indices) of a type exported from `src/client/types.ts`. */
export function clientTypePaths(exportedName: string): Set<string> {
  const source = program.getSourceFile(root);
  if (!source) throw new Error('Could not load src/client/types.ts');
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('src/client/types.ts is not a module');
  const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === exportedName);
  if (!symbol) throw new Error(`Type not exported: ${exportedName}`);
  const out = new Set<string>();
  flatten(checker.getDeclaredTypeOfSymbol(symbol), '', out, []);
  return out;
}
