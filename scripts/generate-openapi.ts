import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import prettier from "prettier";
import { openApiDocument } from "../src/docs/openapi.ts";

const outputDirectory = resolve(process.cwd(), "docs");
const outputPath = resolve(outputDirectory, "openapi.json");

await mkdir(outputDirectory, { recursive: true });
const formattedDocument = await prettier.format(
  JSON.stringify(openApiDocument),
  {
    parser: "json",
  },
);

await writeFile(outputPath, formattedDocument, "utf8");

console.log(`Wrote ${outputPath}`);
