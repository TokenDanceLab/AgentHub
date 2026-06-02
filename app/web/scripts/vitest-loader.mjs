import { register } from 'node:module';

const hookUrl = new URL('./emoji-mart-data-hook.mjs', import.meta.url);
register(hookUrl.href);
