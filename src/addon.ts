import { config } from "../package.json";
import hooks from "./hooks";
import * as claude from "./llm/claudeCli";
import * as gemini from "./llm/gemini";
import * as prompts from "./prompts";
import * as paths from "./paths";
import { createZToolkit } from "./utils/ztoolkit";

// Exposed as Zotero.ClaudeAssist.api for in-Zotero tests and debugging.
const api = { claude, gemini, prompts, paths };

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: typeof api;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = api;
  }
}

export default Addon;
