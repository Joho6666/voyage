#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { ZodError } from "zod";
import { commandSchemas, errorEnvelope, type SkillCommand } from "./contracts";
import { SkillError } from "./errors";
import { createRuntime } from "./runtime";

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const command = process.argv[2] as SkillCommand | undefined;
  const inputFlag = process.argv.indexOf("--input");
  const inputPath = inputFlag >= 0 ? process.argv[inputFlag + 1] : undefined;
  if (!command || !(command in commandSchemas) || !inputPath) {
    throw new SkillError("INVALID_INPUT", "Usage: voyage <command> --input <file|->");
  }
  const source = inputPath === "-" ? await readStdin() : await readFile(inputPath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new SkillError("INVALID_INPUT", "Input is not valid JSON", error instanceof Error ? error.message : error);
  }
  const parsed = commandSchemas[command].safeParse(raw);
  if (!parsed.success) throw new SkillError("INVALID_INPUT", "Input failed command schema validation", parsed.error.flatten());
  const response = await createRuntime().execute(command, parsed.data);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof SkillError) {
    process.stdout.write(`${JSON.stringify(errorEnvelope(error.code, error.message, error.details))}\n`);
  } else if (error instanceof ZodError) {
    process.stdout.write(`${JSON.stringify(errorEnvelope("INVALID_INPUT", "Input failed validation", error.flatten()))}\n`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify(errorEnvelope("INTERNAL_ERROR", message))}\n`);
  }
  process.exitCode = 1;
});
