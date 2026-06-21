// The LLM provider seam the optimizer's judge calls. The real implementation
// (bound to opencode's configured Provider + the `ai` SDK) is wired in the
// command integration step; the deterministic FakeProvider (fake.ts) implements
// the same seam for --dry-run and the parity/loop tests.

export interface LLMProvider {
  /** Single text completion; the judge embeds phase markers in `prompt`. */
  complete(prompt: string, opts?: { system?: string }): Promise<string>
}

export class ProviderError extends Error {}
