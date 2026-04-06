import { FrameworkAdapter } from "./types.js";
import { FrameworkId } from "../types/project.js";
import { NextjsAdapter } from "./nextjs/index.js";
import { ReactAdapter } from "./react/index.js";
import { VueAdapter } from "./vue/index.js";
import { NuxtAdapter } from "./nuxt/index.js";
import { SvelteAdapter } from "./svelte/index.js";
import { AngularAdapter } from "./angular/index.js";
import { GenericAdapter } from "./generic/index.js";

const adapters: Record<string, () => FrameworkAdapter> = {
  nextjs: () => new NextjsAdapter(),
  react: () => new ReactAdapter(),
  vue: () => new VueAdapter(),
  nuxt: () => new NuxtAdapter(),
  sveltekit: () => new SvelteAdapter(),
  svelte: () => new SvelteAdapter(),
  angular: () => new AngularAdapter(),
  generic: () => new GenericAdapter(),
};

export function getAdapter(frameworkId: FrameworkId): FrameworkAdapter {
  const factory = adapters[frameworkId];
  if (!factory) return new GenericAdapter();
  return factory();
}
