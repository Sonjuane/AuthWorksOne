// Live smoke: google (OAuth access token from a real account; build plan 8.3).
import { smoke } from './smoke.js';

smoke('google', ['SMOKE_GOOGLE_ACCESS_TOKEN'], (env) => ({ accessToken: env.SMOKE_GOOGLE_ACCESS_TOKEN }));
