import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestKnowledgeDirectory } from "../src/services/knowledge/ingest";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  // The ingest root must stay inside the repository: this script reads and
  // chunks every file below `root`, so an arbitrary --root would turn the
  // operator tool into a file-walker over any directory on the machine.
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const root = path.resolve(argValue("--root") ?? "knowledge");
  if (root !== repoRoot && !root.startsWith(repoRoot + path.sep)) {
    throw new Error(`--root must stay inside the repository (${repoRoot})`);
  }
  const force = process.argv.includes("--force");
  const ownerId = argValue("--owner") ?? null;

  const summary = await ingestKnowledgeDirectory({
    root,
    force,
    ownerId,
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    root,
    force,
    ...summary,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2) + "\n");
  process.exitCode = 1;
});
