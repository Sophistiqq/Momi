import adapter from '@sveltejs/adapter-node';
import type { Config } from '@sveltejs/kit';

const config: Config = {
  kit: {
    adapter: adapter(),
    bodySizeLimit: '100mb',
  },
};

export default config;
