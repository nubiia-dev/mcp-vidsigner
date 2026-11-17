import { createRequire } from 'node:module';

/** Package version (from package.json), works from both `src/` and `dist/`. */
export const VERSION: string = (() => {
  try {
    const require = createRequire(import.meta.url);
    for (const rel of ['../package.json', '../../package.json']) {
      try {
        const pkg = require(rel) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // try the next path
      }
    }
  } catch {
    // require not available
  }
  return '0.0.0';
})();
