/** Utilities over the JSON Schema the model sees (`tools/list`): flattening and sample generation. */

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  enum?: unknown[];
  format?: string;
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  required?: string[];
}

/**
 * Paths (dotted, without array indices) of all schema properties, lowercased,
 * with their description. An open dictionary (`additionalProperties` without `properties`) is a leaf.
 */
export function visibleProps(schema: JsonSchema): Map<string, { description: string }> {
  const out = new Map<string, { description: string }>();
  const walk = (s: JsonSchema, prefix: string): void => {
    for (const sub of [...(s.anyOf ?? []), ...(s.oneOf ?? []), ...(s.allOf ?? [])])
      walk(sub, prefix);
    if (s.items) walk(s.items, prefix);
    for (const [name, child] of Object.entries(s.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      out.set(path.toLowerCase(), { description: child.description ?? '' });
      walk(child, path);
    }
  };
  walk(schema, '');
  return out;
}

/** Field paths of a JSON value (without array indices), lowercased. */
export function wirePaths(value: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, prefix: string): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item, prefix);
    } else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        const path = prefix ? `${prefix}.${k}` : k;
        out.add(path.toLowerCase());
        walk(child, path);
      }
    }
  };
  walk(value, '');
  return out;
}

/** Maximal instance: fills ALL properties (optional ones too) with valid values. */
export function sample(s: JsonSchema, name = ''): unknown {
  if (s.enum && s.enum.length > 0) return s.enum[0];
  const variants = s.anyOf ?? s.oneOf;
  if (variants) {
    const first = variants.find((v) => v.type !== 'null') ?? variants[0];
    return first ? sample(first, name) : undefined;
  }
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  if (s.properties || type === 'object') {
    if (!s.properties) return { k: 'x' };
    const o: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(s.properties)) {
      const v = sample(child, k);
      if (v !== undefined) o[k] = v;
    }
    return o;
  }
  switch (type) {
    case 'array': {
      const item = s.items ? sample(s.items, name) : undefined;
      return item === undefined ? [] : [item];
    }
    case 'integer':
    case 'number':
      return Math.max(1, s.minimum ?? 1);
    case 'boolean':
      return true;
    case 'string': {
      if (s.format === 'uri' || /^(notificationurl|returnurl)$/i.test(name)) {
        return 'https://example.test/x';
      }
      // Fields that the recipient policy always validates: values with a valid format.
      if (
        /^(e?mail|recipientemailaddress|customeremail|notificationemails|emailstatusnotification|destination)$/i.test(
          name,
        )
      ) {
        return 'a@example.test';
      }
      if (/^(recipient)?phone(number)?$/i.test(name)) return '+34600111222';
      if (s.pattern?.includes('\\d{4}')) return '2026/01/01';
      if (s.minLength && s.minLength > 1) return 'x'.repeat(s.minLength);
      return 'x';
    }
    default:
      return undefined;
  }
}

/**
 * Paths (dotted; `[]` for array elements and `{}` for dictionary values)
 * of all schema properties that have NO `description`. Walks every level,
 * including the `anyOf`/`oneOf`/`allOf` branches. Also returns the total number of properties.
 */
export function undocumentedProps(schema: JsonSchema): { missing: string[]; total: number } {
  const missing: string[] = [];
  let total = 0;
  const walk = (s: JsonSchema, prefix: string): void => {
    for (const sub of [...(s.anyOf ?? []), ...(s.oneOf ?? []), ...(s.allOf ?? [])])
      walk(sub, prefix);
    if (s.items) walk(s.items, `${prefix}[]`);
    if (s.additionalProperties && typeof s.additionalProperties === 'object') {
      walk(s.additionalProperties, `${prefix}{}`);
    }
    for (const [name, child] of Object.entries(s.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      total += 1;
      if (!child.description || child.description.trim().length < 3) missing.push(path);
      walk(child, path);
    }
  };
  walk(schema, '');
  return { missing, total };
}
