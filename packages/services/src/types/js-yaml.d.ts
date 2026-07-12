/**
 * Minimal ambient type declaration for `js-yaml` (v4).
 *
 * The runtime dependency is installed, but `@types/js-yaml` is not present in
 * this workspace. This declaration exposes only the surface the Knowledge
 * Engine's SpecParser relies on: `load` for parsing and `YAMLException` for
 * surfacing the location of the first invalid element (Req 1.4).
 */
declare module 'js-yaml' {
  export interface Mark {
    line: number;
    column: number;
    position: number;
    snippet?: string;
  }

  export class YAMLException extends Error {
    name: string;
    reason: string;
    mark?: Mark;
    message: string;
  }

  export interface LoadOptions {
    filename?: string;
    onWarning?: (exception: YAMLException) => void;
    json?: boolean;
  }

  export function load(input: string, options?: LoadOptions): unknown;
  export function loadAll(input: string, iterator?: (doc: unknown) => void): unknown[];
}
