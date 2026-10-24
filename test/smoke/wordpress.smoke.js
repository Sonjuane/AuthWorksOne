// Live smoke: WordPress (application password on a real site; build plan 8.3).
import { smoke } from './smoke.js';

smoke('wordpress', ['SMOKE_WORDPRESS_SITE_URL', 'SMOKE_WORDPRESS_USERNAME', 'SMOKE_WORDPRESS_APP_PASSWORD'], (env) => ({
  username: env.SMOKE_WORDPRESS_USERNAME,
  password: env.SMOKE_WORDPRESS_APP_PASSWORD.replace(/\s+/g, ''),
  input: { siteUrl: env.SMOKE_WORDPRESS_SITE_URL },
}));
