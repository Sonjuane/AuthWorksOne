// Live smoke: hubspot (OAuth access token from a real account; build plan 8.3).
import { smoke } from './smoke.js';

smoke('hubspot', ['SMOKE_HUBSPOT_ACCESS_TOKEN'], (env) => ({ accessToken: env.SMOKE_HUBSPOT_ACCESS_TOKEN }));
