// page.json against page.schema.json (ModDbCli's PageValidator.cs): the pages folder's own schema if it has one (a project can change
// it), else the one vsdev ships (src/moddb/page.schema.json, copied to dist/). JSON Schema 2020-12 via ajv.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { assetPath } from "../paths.js";
import { SCHEMA_FILE } from "./files.js";

export class PageValidator {
  private readonly check: ValidateFunction;
  /** Which schema file is used. */
  readonly schemaFile: string;

  constructor(pagesDir: string) {
    const own = path.join(pagesDir, SCHEMA_FILE);
    this.schemaFile = existsSync(own) ? own : bundledSchemaPath();
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    this.check = ajv.compile(JSON.parse(readFileSync(this.schemaFile, "utf8")));
  }

  /** Readable problems, empty when valid. */
  validate(pageJson: string): string[] {
    let doc: unknown;
    try {
      doc = JSON.parse(pageJson);
    } catch (err) {
      return [`not valid JSON: ${(err as Error).message}`];
    }
    if (this.check(doc)) return [];
    const problems = (this.check.errors ?? []).map((e) => {
      const where = e.instancePath || "/";
      const extra = e.keyword === "enum" ? `: ${(e.params as { allowedValues: unknown[] }).allowedValues.join(", ")}`
        : e.keyword === "additionalProperties" ? `: ${(e.params as { additionalProperty: string }).additionalProperty}`
        : "";
      return `${where}: ${e.message}${extra}`;
    });
    return problems.length ? [...new Set(problems)] : ["does not match page.schema.json"];
  }
}

/** The page.schema.json vsdev ships. */
export const bundledSchemaPath = () => assetPath("page.schema.json", "src/moddb/page.schema.json");
