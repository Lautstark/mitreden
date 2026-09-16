/* TypeScript inside components, and nothing else: no adapter, no kit, no
   routing. mitreden is one page, and Vite already knows which one. */
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default { preprocess: vitePreprocess() };
