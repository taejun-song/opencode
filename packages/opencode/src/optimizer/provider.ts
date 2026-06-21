// The LLM provider seam the optimizer's judge calls. The real implementation
// (bound to opencode's configured Provider + the `ai` SDK) is wired in the
// command integration step; the deterministic FakeProvider (fake.ts) implements
// the same seam for --dry-run and the parity/loop tests.

export interface LLMProvider {
  /** Single text completion; the judge embeds phase markers in `prompt`. */
  complete(prompt: string, opts?: { system?: string }): Promise<string>
}

export class ProviderError extends Error {}

import { generateText, type LanguageModel } from "ai"

/**
 * Real provider bound to opencode's already-configured model. Construct it in an
 * effectCmd handler from the resolved language model:
 *   const prov = yield* Provider.Service
 *   const dm = yield* prov.defaultModel()
 *   const m  = yield* prov.getModel(dm.providerID, dm.modelID)
 *   const language = yield* prov.getLanguage(m)
 *   const provider = new OpencodeProvider(language)
 * It reuses the configured endpoint/model/key — no new credential plumbing.
 */
export class OpencodeProvider implements LLMProvider {
  constructor(private readonly language: LanguageModel) {}
  async complete(prompt: string, opts?: { system?: string }): Promise<string> {
    const res = await generateText({ model: this.language, system: opts?.system, prompt })
    return res.text
  }
}
