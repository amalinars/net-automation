import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

chromium.use(StealthPlugin());

const ACCOUNTS = [
  { email: "riztama1224@gmail.com", password: "plislucu28" },
  { email: "panjij0987@gmail.com", password: "seriusya24" },
  { email: "rismamingyulina21@gmail.com", password: "apaiya26" },
  { email: "morphchrono@gmail.com", password: "terlalunyaman1224" },
  { email: "jovanpolitama@gmail.com", password: "kudahitam1224" },
];

function ask(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

function getStatePath(email: string): string {
  const stateDir = path.resolve('auth');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  return path.join(stateDir, `${email.replace(/[^a-zA-Z0-9]/g, '_')}_state.json`);
}

async function isSomethingWentWrong(page: any): Promise<boolean> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return bodyText.includes('Something went wrong. Please try again in a few minutes') || 
         bodyText.includes('Something went wrong. Please try again in a few minutes.');
}

async function runLoginForAccount(account: typeof ACCOUNTS[0]) {
  const { email, password } = account;
  const statePath = getStatePath(email);

  console.log('\n==================================================');
  console.log(`Starting session generation for: ${email}`);
  console.log(`Target path: ${statePath}`);
  console.log('==================================================');

  if (fs.existsSync(statePath)) {
    const answer = await ask(`Session file already exists for ${email}. Overwrite? (y/N): `);
    if (answer.toLowerCase() !== 'y') {
      console.log(`Skipping ${email}`);
      return;
    }
  }

  console.log('Launching headed browser (Google Chrome). Please monitor the browser window...');
  const launchOptions: any = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  };

  const chromePath = '/opt/google/chrome/chrome';
  if (fs.existsSync(chromePath) || process.platform === 'win32' || process.platform === 'darwin') {
    launchOptions.channel = 'chrome';
  }

  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('playwright install') || errMsg.includes("Executable doesn't exist")) {
      console.log('Playwright browser executable is missing. Attempting to automatically run "npx playwright install"...');
      try {
        const { execSync } = await import('node:child_process');
        execSync('npx playwright install', { stdio: 'inherit' });
        console.log('Playwright browsers installed successfully. Retrying browser launch...');
        browser = await chromium.launch(launchOptions);
      } catch (installErr) {
        console.error('Failed to auto-install Playwright browsers:', installErr);
        throw err;
      }
    } else {
      throw err;
    }
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    console.log('Navigating to Netflix login...');
    await page.goto('https://www.netflix.com/login', {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    let skippedAutoFill = false;

    if (await isSomethingWentWrong(page)) {
      console.log('⚠️ Rate limit / block detected (Something went wrong) on initial load.');
      console.log('Please refresh the page, solve CAPTCHA, or type credentials manually in the browser window.');
      skippedAutoFill = true;
    }

    if (!skippedAutoFill) {
      // Auto-fill email
      const emailInput = page.locator('input[name="userLoginId"], input[type="email"]').first();
      await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
      await emailInput.focus();
      await page.keyboard.type(email, { delay: 100 });
      console.log('Typed email with human delay...');

      // Wait a brief moment, then look for Continue or Password
      await page.waitForTimeout(1000);

      if (await isSomethingWentWrong(page)) {
        console.log('⚠️ Rate limit / block detected after typing email.');
        console.log('Please type your credentials manually in the browser window.');
        skippedAutoFill = true;
      }
    }

    if (!skippedAutoFill) {
      const continueButton = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Sign In")').first();
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
        console.log('Clicked Continue/Sign-in button...');
      }

      // Check if OTP or direct password input appears
      await page.waitForTimeout(3000);

      if (await isSomethingWentWrong(page)) {
        console.log('⚠️ Rate limit / block detected after email submission.');
        console.log('Please type your credentials manually in the browser window.');
        skippedAutoFill = true;
      }
    }

    if (!skippedAutoFill) {
      const isOtpScreen = await page.locator('input[name="challengeOtp"]').first().isVisible().catch(() => false);
      const pwInput = page.locator('input[name="password"], input[type="password"]').first();

      if (isOtpScreen) {
        console.log('OTP screen detected. Attempting to click "Use password instead"...');
        const getHelpButton = page.getByRole('button', { name: /get help/i }).first();
        const getHelpLink = page.getByRole('link', { name: /get help/i }).first();
        if (await getHelpButton.isVisible().catch(() => false)) {
          await getHelpButton.click();
        } else if (await getHelpLink.isVisible().catch(() => false)) {
          await getHelpLink.click();
        }

        const passwordOption = page.getByText('Use password instead', { exact: false }).first();
        await passwordOption.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        if (await passwordOption.isVisible().catch(() => false)) {
          await passwordOption.click();
          console.log('Clicked "Use password instead"');
          await page.waitForTimeout(2000);
        }
      }

      if (await isSomethingWentWrong(page)) {
        console.log('⚠️ Rate limit / block detected before password input.');
        console.log('Please type your credentials manually in the browser window.');
        skippedAutoFill = true;
      }

      // Auto-fill password if visible
      if (!skippedAutoFill && pwInput && await pwInput.isVisible().catch(() => false)) {
        await pwInput.focus();
        await page.keyboard.type(password, { delay: 100 });
        console.log('Typed password with human delay...');
        const submitButton = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Continue")').first();
        await submitButton.click();
        console.log('Submitted login credentials...');
      }
    }

    console.log('\n--- MANUAL INTERACTION REQUIRED ---');
    console.log('If you see CAPTCHA, OTP, or verification code, please solve it in the browser window.');
    console.log('Once you are successfully logged in (the URL shows "/browse" or you see "Who\'s watching?"),');
    console.log('the script will detect the session and save it automatically.');
    console.log('------------------------------------\n');

    // Poll until logged in or browser closed
    let loggedIn = false;
    const timeoutDuration = 5 * 60 * 1000; // 5 minutes timeout
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutDuration) {
      if (browser.isConnected() === false) {
        console.log('Browser was closed.');
        break;
      }

      const currentUrl = page.url();
      const bodyText = await page.locator('body').innerText().catch(() => '');

      if (await isSomethingWentWrong(page)) {
        console.log('⚠️ Rate limit / block detected (Something went wrong). Skipping this account...');
        break;
      }

      if (currentUrl.includes('/browse') || bodyText.includes("Who's watching?")) {
        loggedIn = true;
        break;
      }

      await page.waitForTimeout(1000);
    }

    if (loggedIn) {
      console.log('Successfully logged in!');
      await page.waitForTimeout(2000); // Wait a bit for storage sync
      await context.storageState({ path: statePath });
      console.log(`Saved session to: ${statePath}`);
    } else {
      console.log('Failed to log in or timed out.');
    }
  } catch (err: any) {
    console.error(`Error during login execution: ${err.message}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  console.log('Netflix Session Generator');
  console.log('=========================');
  
  // Show list of accounts and their status
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const acc = ACCOUNTS[i];
    const pathFile = getStatePath(acc.email);
    const exists = fs.existsSync(pathFile);
    console.log(`[${i + 1}] ${acc.email} - ${exists ? 'SESSION EXISTS ✅' : 'NO SESSION ❌'}`);
  }

  const selection = await ask('\nEnter account number to generate (e.g. 1, 2, 3), or type "all" to run through missing/all, or "exit" to quit: ');

  if (selection.toLowerCase() === 'exit') {
    console.log('Exiting.');
    return;
  }

  if (selection.toLowerCase() === 'all') {
    for (const acc of ACCOUNTS) {
      await runLoginForAccount(acc);
    }
  } else if (selection.includes(',')) {
    const indices = selection.split(',').map((s) => parseInt(s.trim(), 10) - 1);
    for (const index of indices) {
      if (index >= 0 && index < ACCOUNTS.length) {
        await runLoginForAccount(ACCOUNTS[index]);
      } else {
        console.log(`Invalid selection index: ${index + 1}`);
      }
    }
  } else {
    const index = parseInt(selection, 10) - 1;
    if (index >= 0 && index < ACCOUNTS.length) {
      await runLoginForAccount(ACCOUNTS[index]);
    } else {
      console.log('Invalid selection.');
    }
  }

  console.log('\nAll done!');
}

main().catch(console.error);
