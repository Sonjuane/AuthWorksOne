// Live smoke: clickup (OAuth access token from a real account; build plan 8.3).
import { smoke } from './smoke.js';

smoke('clickup', ['SMOKE_CLICKUP_ACCESS_TOKEN'], (env) => ({ accessToken: env.SMOKE_CLICKUP_ACCESS_TOKEN }));
