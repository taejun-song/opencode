// CLI entry point for `opencode optimize` (airlock feature 008).
//
// Runs RepoSkillOpt's native, validation-gated skill optimizer (ported to TS in
// src/optimizer/) against a repository, reusing opencode's already-configured
// model. Writes a tuned skill + grounding/score report to --out; never modifies
// the installed skill. --dry-run uses the deterministic fake provider (no network).
import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, CliError } from "../effect-cmd"
import { Provider } from "@/provider/provider"
import { type LLMProvider, OpencodeProvider } from "@/optimizer/provider"
import { DryRunProvider } from "@/optimizer/fake"
import { runOptimize, OptimizeError } from "@/optimizer/run"

export const OptimizeCommand = effectCmd({
  command: "optimize <repo>",
  describe: "tune a skill for a repository with the native optimizer (airlock)",
  builder: (yargs: Argv) =>
    yargs
      .positional("repo", { describe: "path to the target repository", type: "string", demandOption: true })
      .option("skill", { describe: "path to the starting SKILL.md", type: "string", demandOption: true })
      .option("out", { describe: "output directory for the tuned skill + report", type: "string", demandOption: true })
      .option("rounds", { describe: "max convergence rounds", type: "number" })
      .option("dry-run", { describe: "deterministic offline run (no network)", type: "boolean", default: false }),
  handler: Effect.fn("Cli.optimize")(function* (args) {
    let provider: LLMProvider
    if (args["dry-run"]) {
      provider = new DryRunProvider()
    } else {
      provider = yield* Effect.gen(function* () {
        const prov = yield* Provider.Service
        const dm = yield* prov.defaultModel()
        const model = yield* prov.getModel(dm.providerID, dm.modelID)
        const language = yield* prov.getLanguage(model)
        return new OpencodeProvider(language)
      }).pipe(
        Effect.mapError(
          (e) => new CliError({ message: `optimize needs a configured model (run the installer first): ${String(e)}` }),
        ),
      )
    }

    const summary = yield* Effect.tryPromise({
      try: () =>
        runOptimize(provider, {
          repoDir: args.repo as string,
          skillPath: args.skill as string,
          outDir: args.out as string,
          rounds: args.rounds as number | undefined,
        }),
      catch: (e) =>
        new CliError({
          message: e instanceof OptimizeError ? e.message : `optimize failed: ${e instanceof Error ? e.message : String(e)}`,
        }),
    })

    yield* Effect.sync(() => {
      process.stdout.write(
        `optimize: ${summary.accepted} accepted of ${summary.rounds} rounds; ` +
          `final version ${summary.finalVersion}; citation resolution ${(summary.citationRate * 100).toFixed(0)}%\n` +
          `staged at ${summary.outDir}\n`,
      )
    })
  }),
})
