import { ingestRepositoryCorpus } from "../src/services/knowledge/ingest";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  // Always ingests the repository's own curated corpus; there is no
  // caller-supplied filesystem path on this entry point.
  const force = process.argv.includes("--force");
  const ownerId = argValue("--owner") ?? null;

  const summary = await ingestRepositoryCorpus({ force, ownerId });

  process.stdout.write(JSON.stringify({
    ok: true,
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
