import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { openApiDocument } from "./openapi.js";

export async function exportOpenApi(
  outputArgument = "openapi.json",
): Promise<string> {
  const outputPath = resolve(process.cwd(), outputArgument);

  await mkdir(dirname(outputPath), { recursive: true });

  const formattedDocument = await prettier.format(
    JSON.stringify(openApiDocument),
    {
      parser: "json",
    },
  );

  await writeFile(outputPath, formattedDocument, "utf8");

  return outputPath;
}

const entryPoint = process.argv[1];
const isMainModule =
  entryPoint !== undefined &&
  resolve(entryPoint) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const outputPath = await exportOpenApi(process.argv[2]);
  console.log(`Wrote ${outputPath}`);
}
