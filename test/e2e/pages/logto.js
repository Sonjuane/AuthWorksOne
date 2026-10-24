// Logto 1.45 hosted pages (sign-in, sign-up, MFA, password reset, Account Center). Every hosted-page
// selector lives here, so a Logto upgrade is fixed in one file (build plan R1).
import { totp } from '../../../scripts/lib/totp.js';
import { URLS } from '../lib/stack.js';

// Verification code from the dev mailbox (http-email devFallback), newest first.
export const mailCode = async (email, type) => {
  for (let i = 0; i < 60; i++) {
    const messages = await (await fetch(`${URLS.mailbox}/`)).json();
    const hit = messages.map((m) => JSON.parse(m.body)).reverse().find((m) => m.to === email && m.type === type);
    if (hit) return hit.payload.code;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no ${type} code for ${email}`);
};

// A TOTP code is used once per 30 s step: wait for the next step when this secret already used it.
const usedStep = new Map();
const freshTotp = async (secret) => {
  if (usedStep.get(secret) === Math.floor(Date.now() / 30_000)) await new Promise((resolve) => setTimeout(resolve, 30_300 - (Date.now() % 30_000)));
  usedStep.set(secret, Math.floor(Date.now() / 30_000));
  return totp(secret);
};
const typeCode = async (page, firstInput, code) => {
  await page.locator(`input[name=${firstInput}]`).click();
  await page.keyboard.type(code);
};
const onLogto = (url) => url.origin === URLS.logto;
const STEP = /\/(mfa-onboarding|mfa-verification\/Totp|mfa-binding\/BackupCode|continue\/extra-profile)/;

export const logto = {
  // After a credential step: complete the follow-up prompts until the browser leaves Logto.
  async finish(page, { totpSecret, displayName = 'E2E User' } = {}) {
    for (let i = 0; i < 6; i++) {
      await page.waitForURL((url) => !onLogto(url) || STEP.test(url.pathname));
      const before = page.url();
      const { pathname } = new URL(before);
      if (!onLogto(new URL(before))) return;
      if (pathname.includes('mfa-onboarding')) await page.getByText('Skip', { exact: true }).click();
      else if (pathname.includes('mfa-verification')) await typeCode(page, 'totpCode_0', await freshTotp(totpSecret));
      else if (pathname.includes('BackupCode')) await page.getByRole('button', { name: 'Continue' }).click();
      else await this.profile(page, displayName);
      await page.waitForURL((url) => url.href !== before);
    }
    throw new Error(`stuck on ${page.url()}`);
  },

  async profile(page, displayName) {
    await page.locator('input[name=displayName]').fill(displayName);
    await page.getByRole('button', { name: 'Continue' }).click();
  },

  // On the sign-in page: email + password (+ TOTP when the user has it).
  async signIn(page, { email, password, totpSecret }) {
    await page.waitForURL((url) => onLogto(url) && url.pathname.startsWith('/sign-in'));
    await page.locator('input[name=identifier]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await this.finish(page, { totpSecret });
  },

  // On the sign-in page: email sign-up with the mailbox code; optional TOTP enrollment (S1).
  async signUp(page, { email, password, displayName = 'E2E User', enrollTotp = false }) {
    await page.waitForURL((url) => onLogto(url) && url.pathname.startsWith('/sign-in'));
    await page.getByText('Create account').click();
    await page.locator('input[name=identifier]').fill(email);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/register\/verification-code/);
    await typeCode(page, 'passcode_0', await mailCode(email, 'Register'));
    await page.waitForURL(/\/continue\/password/);
    await page.locator('input[name=newPassword]').fill(password);
    await page.getByRole('button', { name: 'Save password' }).click();
    await page.waitForURL(/\/continue\/extra-profile/);
    await this.profile(page, displayName);
    await page.waitForURL(/\/mfa-onboarding/);
    if (!enrollTotp) {
      await this.finish(page);
      return {};
    }
    await page.getByRole('button', { name: 'Enable 2-step verification' }).click();
    await page.waitForURL(/\/mfa-binding\/Totp/);
    await page.getByText('Can’t scan the QR code?').click();
    const totpSecret = (await page.locator('body').innerText()).match(/\b[A-Z2-7]{32}\b/)[0];
    await typeCode(page, 'totpCode_0', await freshTotp(totpSecret));
    await this.finish(page, { totpSecret });
    return { totpSecret };
  },

  // On the sign-in page: a social button, then the mock IdP form (S2, S18).
  async social(page, name, email) {
    await page.waitForURL((url) => onLogto(url) && url.pathname.startsWith('/sign-in'));
    await page.getByRole('button', { name: `Continue with ${name}` }).click();
    await page.waitForURL(`${URLS.mock}/oidc/authorize**`);
    await page.locator('input[name=email]').fill(email);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await this.finish(page);
  },

  // On the sign-in page: "Forgot your password?" with the mailbox code; ends back on the sign-in page.
  async resetPassword(page, { email, newPassword }) {
    await page.getByText('Forgot your password?').click();
    await page.locator('input[name=identifier]').fill(email);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/forgot-password\/verification-code/);
    await typeCode(page, 'passcode_0', await mailCode(email, 'ForgotPassword'));
    await page.waitForURL(/\/forgot-password\/reset/);
    await page.locator('input[name=newPassword]').fill(newPassword);
    await page.getByRole('button', { name: 'Save password' }).click();
    await page.waitForURL((url) => onLogto(url) && url.pathname.startsWith('/sign-in'));
  },

  // Account Center: switch 2-step verification off (password re-verification).
  async disableMfa(page, password) {
    await page.goto(`${URLS.logto}/account/security`);
    await page.locator('input[type=checkbox][aria-label="Toggle switch"]').locator('..').click();
    await page.getByRole('button', { name: 'Disable' }).click();
    await page.waitForURL(/\/account\/verified-action/);
    await page.getByText('Verify your password').click();
    await page.locator('input[name=currentPassword]').fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();
    // Back on the security page, and the switch really reads "off".
    await page.locator('input[type=checkbox][aria-label="Toggle switch"]:not(:checked)').waitFor({ state: 'attached' });
  },
};
