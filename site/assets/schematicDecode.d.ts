// Type declarations for schematicDecode.js, consumed by src/ingest/models/tapestryInstances.ts.
// The .js file itself stays plain, dependency-free ES module JS (browser-loadable as-is) -- this
// file exists only so the Node/TS side of the pipeline gets type checking on the import.

export const Ascii85: {
  decode(encoded: string): ArrayBuffer;
};

export class TreeAttributeParser {
  constructor(buffer: ArrayBuffer);
  parse(): Record<string, unknown>;
}

export function decodeBlockEntity(asciiString: string): Record<string, unknown>;
