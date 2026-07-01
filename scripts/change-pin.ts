import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const email = process.env.NETFLIX_EMAIL || "morphchrono@gmail.com";
const password = process.env.NETFLIX_PASSWORD || "terlalunyaman1224";
const headless = process.env.HEADLESS !== 'false';
const debug = process.env.DEBUG === 'true';
const profileName = process.env.NETFLIX_PROFILE || "Ballerina";
const profilePin = process.env.NETFLIX_PIN || "7836";
const newProfilePin = process.env.NETFLIX_NEW_PIN || "7840";

if (!email) {
  console.error('Missing NETFLIX_EMAIL env var');
  process.exit(1);
}

if (!password) {
  console.error('Missing NETFLIX_PASSWORD env var');
  process.exit(1);
}

async function isVisible(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function waitForVisible(page: import('@playwright/test').Page, selectors: string[], timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const selector of selectors) {
      if (await isVisible(page, selector)) return selector;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function handleProfileAndPin(page: import('@playwright/test').Page, headless: boolean) {
  if (!profileName) {
    console.log('No profile specified. Skipping profile selection.');
    return;
  }

  try {
    console.log('>>STEP:Pilih profil')
    console.log(`Waiting for profile selection screen to select: "${profileName}"...`);
    
    // Wait for the "Who's watching?" screen or profile links to be visible
    const profileSelector = '.profile-link, .profile, a, span.profile-name';
    await page.locator(profileSelector).first().waitFor({ state: 'visible', timeout: 20_000 });

    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log('Profiles screen text:', bodyText.replace(/\n/g, ' '));

    console.log(`Selecting profile: ${profileName}`);
    
    // We want the text of the profile (lower case comparison to avoid typo mismatch)
    const profiles = page.locator('.profile-link, .profile, a, span');
    const count = await profiles.count();
    let profileClicked = false;
    for (let i = 0; i < count; i++) {
      const text = await profiles.nth(i).innerText().catch(() => '');
      if (text.trim().toLowerCase() === profileName.trim().toLowerCase()) {
        console.log(`Found matching profile element with text "${text}". Clicking...`);
        await profiles.nth(i).click();
        profileClicked = true;
        break;
      }
    }
    
    if (!profileClicked) {
      console.log(`Fallback: attempting to click using text search for "${profileName}"`);
      await page.getByText(profileName, { exact: false }).first().click();
    }
    
    console.log('Clicked profile.');

    // Wait for PIN screen to load (if any) or browse screen
    await page.waitForTimeout(3000);

    const bodyTextAfterProfile = await page.locator('body').innerText().catch(() => '');

    if (bodyTextAfterProfile.toLowerCase().includes('pin') || 
        bodyTextAfterProfile.toLowerCase().includes('code') || 
        bodyTextAfterProfile.toLowerCase().includes('kunci') || 
        bodyTextAfterProfile.toLowerCase().includes('profil') ||
        await page.locator('input[type="number"], input[type="password"], input[type="tel"]').first().isVisible().catch(() => false)) {
      
      if (!profilePin) {
        console.warn('PIN screen detected but no NETFLIX_PIN provided!');
      } else {
        console.log(`PIN entry screen detected. Entering PIN: ${profilePin}...`);
        const pinInputs = page.locator('input[type="number"], input[type="password"], input[type="tel"], .pin-number-input, input').filter({ visible: true });
        const pinInputCount = await pinInputs.count().catch(() => 0);
        
        console.log(`Found ${pinInputCount} visible PIN input(s)`);
        if (pinInputCount === 1) {
          await pinInputs.first().fill(profilePin);
          console.log('Filled single PIN input.');
        } else if (pinInputCount >= 4) {
          for (let i = 0; i < Math.min(4, profilePin.length); i++) {
            await pinInputs.nth(i).fill(profilePin[i]);
            await page.waitForTimeout(200);
          }
          console.log('Filled multi-box PIN input.');
        }
      }

      await page.waitForTimeout(5000);
    }

    // Handle Netflix onboarding screens (Languages, Movie Selection, Tutorials)
    console.log('Checking for onboarding screens...');
    let onboardingActive = true;
    let cycles = 0;
    
    while (onboardingActive && cycles < 15) {
      cycles++;
      const bodyText = await page.locator('body').innerText().catch(() => '');
      
      // 1. Language Selection Screen
      if (bodyText.toLowerCase().includes('which languages do you') || bodyText.toLowerCase().includes('set up your audio and subtitles')) {
        console.log('Language selection screen detected. Clicking Next...');
        const nextBtn = page.locator('button').filter({ hasText: /Next/i }).first();
        if (await nextBtn.isVisible().catch(() => false)) {
          await nextBtn.click();
        } else {
          // Fallback to click any visible button containing "Next"
          await page.locator('button, a').filter({ hasText: /Next/i }).first().click().catch(() => {});
        }
        await page.waitForTimeout(3000); // Wait for transition
        continue;
      }
      
      // 2. Movie Selection Screen
      if (bodyText.toLowerCase().includes('select 3') || 
          bodyText.toLowerCase().includes('pick 3') || 
          bodyText.toLowerCase().includes('ones you like')) {
        console.log('Movie personalization screen detected! Selecting 3 movies...');
        
        const images = page.locator('img').filter({ visible: true });
        const imgCount = await images.count().catch(() => 0);
        console.log(`Found ${imgCount} visible images for movie selection.`);
        
        let clickedCount = 0;
        for (let i = 0; i < imgCount && clickedCount < 3; i++) {
          const img = images.nth(i);
          const src = await img.getAttribute('src').catch(() => '');
          const alt = await img.getAttribute('alt').catch(() => '');
          // Skip logo/brand/navigation icons
          if (src.includes('logo') || alt.toLowerCase().includes('netflix') || src.includes('avatar')) {
            continue;
          }
          console.log(`Clicking movie card ${clickedCount + 1}...`);
          await img.click().catch(() => {});
          clickedCount++;
          await page.waitForTimeout(500);
        }

        console.log('Looking for Continue button...');
        const continueBtn = page.locator('button, a, div[role="button"]').filter({ hasText: /Continue/i }).first();
        await continueBtn.waitFor({ state: 'visible', timeout: 15_000 });
        await continueBtn.click();
        console.log('Clicked Continue button. Waiting for redirect to browse page...');
        await page.waitForURL(/\/browse/, { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(5000); // Allow browser to settle
        continue;
      }
      
      // 3. Tutorial Modals (Next or Done buttons)
      const tutorialNextBtn = page.locator('button').filter({ hasText: /^(Next|Done)$/i }).filter({ visible: true }).first();
      if (await tutorialNextBtn.isVisible().catch(() => false)) {
        const text = await tutorialNextBtn.innerText().catch(() => '');
        console.log(`Tutorial modal button "${text}" found. Clicking...`);
        await tutorialNextBtn.click().catch(() => {});
        await page.waitForTimeout(1500); // Wait for transition
        continue;
      }
      
      // If none of the onboarding screens are detected, we are done
      onboardingActive = false;
    }
    console.log('Finished onboarding checks.');

    // Navigate to profile lock settings to change PIN
    console.log('>>DONE:Pilih profil')
    console.log('>>STEP:Buka Profile Lock')
    console.log('Navigating to account profile settings page...');
    await page.goto('https://www.netflix.com/account/profiles', { waitUntil: 'networkidle' });

    console.log(`Clicking on profile to edit settings: ${profileName}`);
    // Match the profile name case-insensitively
    const profileSettingItem = page.locator('button, a').filter({ hasText: new RegExp(profileName, 'i') }).first();
    await profileSettingItem.waitFor({ state: 'visible', timeout: 15_000 });
    await profileSettingItem.click();

    console.log('Clicking Profile Lock option...');
    const profileLockBtn = page.locator('button, a').filter({ hasText: /Profile Lock/i }).first();
    await profileLockBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await profileLockBtn.click();

    // Wait for the URL to transition to the Lock settings page
    console.log('Waiting for Lock settings page URL transition...');
    await page.waitForURL(/\/settings\/lock\//, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000); // Give the event handlers time to attach
    console.log('>>DONE:Buka Profile Lock')

    console.log('Clicking Edit PIN...');
    const editPinFallback = page.locator('button, a').filter({ hasText: /Edit PIN/i }).first();
    await editPinFallback.waitFor({ state: 'visible', timeout: 15_000 });
    await editPinFallback.click();
    console.log('>>STEP:Edit & simpan PIN')

    console.log('Checking if password confirmation is required...');
    await page.waitForTimeout(3000); // Wait for transition/renders

    const confirmPasswordBtn = page.locator('button, a').filter({ hasText: /Confirm password/i }).first();
    const confirmPwInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="Password" i]').filter({ visible: true }).first();

    if (await confirmPasswordBtn.isVisible().catch(() => false)) {
      console.log('>>STEP:Verifikasi identitas')
      console.log('Password verification modal detected. Clicking Confirm password...');
      await confirmPasswordBtn.click();
      await page.waitForTimeout(2000);

      console.log('Entering account password for verification...');
      const inputField = page.locator('input[type="password"], input[name="password"], input[placeholder*="Password" i]').filter({ visible: true }).first();
      await inputField.waitFor({ state: 'visible', timeout: 15_000 });
      await inputField.fill(password);

      console.log('Submitting password confirmation...');
      const submitConfirmBtn = page.locator('button[type="submit"], button').filter({ hasText: /Submit/i }).first();
      await submitConfirmBtn.click();

      await page.waitForTimeout(5000);
      console.log('>>DONE:Verifikasi identitas')
    } else if (await confirmPwInput.isVisible().catch(() => false)) {
      console.log('>>STEP:Verifikasi identitas')
      console.log('Direct password input page detected. Entering password...');
      await confirmPwInput.fill(password);

      console.log('Submitting password confirmation...');
      const submitConfirmBtn = page.locator('button[type="submit"], button').filter({ hasText: /Submit/i }).first();
      await submitConfirmBtn.click();

      await page.waitForTimeout(5000);
      console.log('>>DONE:Verifikasi identitas')
    } else {
      console.log('No password confirmation required. Landed directly on the PIN entry page.');
    }

    console.log('Successfully reached the new PIN entry screen. Current URL:', page.url());

    // Ensure the "Require a PIN" checkbox is checked if it exists and is unchecked
    console.log('Checking for Require a PIN checkbox...');
    const requirePinCheckbox = page.locator('input[type="checkbox"]').first();
    if (await requirePinCheckbox.isVisible().catch(() => false)) {
      const isChecked = await requirePinCheckbox.isChecked().catch(() => false);
      if (!isChecked) {
        console.log('Checking the "Require a PIN to access..." checkbox...');
        await requirePinCheckbox.check().catch(() => requirePinCheckbox.click());
        await page.waitForTimeout(1000);
      }
    }

    // Clear all existing PIN inputs first to ensure we don't append digits
    console.log('Clearing existing PIN input fields...');
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]');
      inputs.forEach(input => {
        const htmlInput = input as HTMLInputElement;
        htmlInput.value = '';
        htmlInput.dispatchEvent(new Event('input', { bubbles: true }));
        htmlInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await page.waitForTimeout(500); // Give the DOM event handlers time to process clearing

    // Input the new PIN using keyboard typing simulation
    console.log(`Entering new PIN: ${newProfilePin}...`);
    const newPinInputs = page.locator('input[type="text"], input[type="number"], input[type="tel"]').filter({ visible: true });
    const firstInput = newPinInputs.first();
    await firstInput.waitFor({ state: 'visible', timeout: 15_000 });
    await firstInput.focus();
    await page.keyboard.type(newProfilePin, { delay: 150 });
    console.log('Filled new PIN inputs via keyboard simulation.');

    // Save the new PIN
    console.log('Saving the new PIN...');
    const savePinBtn = page.locator('button').filter({ hasText: /Save/i }).first();
    await savePinBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await savePinBtn.click();
    console.log('Clicked Save PIN. Waiting for settings page to load...');
    await page.waitForTimeout(5000);

    console.log('>>DONE:Edit & simpan PIN')
    console.log('PIN changed successfully. Current URL:', page.url());
  } catch (error) {
    console.error('Error in handleProfileAndPin:', error);
  }

  // Keep browser open if not headless
  if (!headless) {
    console.log('Keeping browser open as requested...');
    try {
      await page.waitForTimeout(86_400_000); // Keep open for 24 hours
    } catch (e) {
      console.log('Browser was closed by the user.');
    }
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const stateDir = path.resolve('auth');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  const statePath = path.join(stateDir, `${email.replace(/[^a-zA-Z0-9]/g, '_')}_state.json`);

  const contextOptions: any = {
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  };

  if (fs.existsSync(statePath)) {
    console.log(`Loading session from: ${statePath}`);
    contextOptions.storageState = statePath;
  }

  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();

  try {
    console.log('>>STEP:Login ke Netflix')
    await page.goto('https://www.netflix.com/login', {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    // Check if we are already logged in (redirected to browse or who's watching)
    const currentUrl = page.url();
    const initialBodyText = await page.locator('body').innerText().catch(() => '');
    if (currentUrl.includes('/browse') || initialBodyText.includes("Who's watching?")) {
      console.log('Already logged in using loaded session!');
      if (debug) {
        await page.screenshot({ path: 'artifacts/netflix-login-state.png', fullPage: true });
      }
      console.log(JSON.stringify({
        ok: true,
        status: 'already-logged-in',
        url: page.url(),
        emailValue: '',
        usePasswordInsteadVisible: false,
        bodyTextBeforeHelp: '',
        bodyTextAfterFlow: initialBodyText.slice(0, 3000),
        screenshot: debug ? 'artifacts/netflix-login-state.png' : undefined
      }, null, 2));
      console.log('>>DONE:Login ke Netflix')
      await handleProfileAndPin(page, headless);
      return;
    }

    const emailInput = page.locator('input[name="userLoginId"], input[type="email"]');
    await emailInput.first().waitFor({ state: 'visible', timeout: 30_000 });
    await emailInput.first().fill(email);

    const continueButton = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Sign In")').first();
    await continueButton.click();

    // Now wait for the state transition. We can wait for input[name="challengeOtp"] (OTP screen)
    const isOtpScreen = await page.locator('input[name="challengeOtp"]').first().waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    const bodyText1 = (await page.locator('body').innerText().catch(() => '')).slice(0, 3000);
    let status = 'unknown';
    let usePasswordInsteadVisible = false;
    let loginSuccess = false;

    if (isOtpScreen) {
      status = 'otp-screen-visible';

      const getHelpButton = page.getByRole('button', { name: /get help/i }).first();
      const getHelpLink = page.getByRole('link', { name: /get help/i }).first();
      if (await getHelpButton.isVisible().catch(() => false)) {
        await getHelpButton.click();
      } else if (await getHelpLink.isVisible().catch(() => false)) {
        await getHelpLink.click();
      }

      const passwordOption = page.getByText('Use password instead', { exact: false }).first();
      await passwordOption.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => { });
      usePasswordInsteadVisible = await passwordOption.isVisible().catch(() => false);

      if (usePasswordInsteadVisible) {
        status = 'use-password-instead-visible';
        await passwordOption.click();

        // Wait for password field
        const pwInput = page.locator('input[name="password"], input[type="password"]').first();
        await pwInput.waitFor({ state: 'visible', timeout: 15_000 });
        await pwInput.fill(password);

        // Submit password
        const submitButton = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Continue")').first();
        await submitButton.click();

        // Wait for page load / redirect
        await page.waitForTimeout(5000);

        // Check if we are logged in
        const currentUrl = page.url();
        const bodyTextAfterClick = await page.locator('body').innerText().catch(() => '');
        if (currentUrl.includes('/browse') || bodyTextAfterClick.includes("Who's watching?")) {
          status = 'logged-in';
          loginSuccess = true;
        } else {
          status = 'login-failed';
        }
      }
    } else {
      // If OTP screen didn't show, check if password input is visible
      const pwInput = page.locator('input[name="password"], input[type="password"]').first();
      if (await pwInput.isVisible().catch(() => false)) {
        await pwInput.fill(password);
        const submitButton = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Continue")').first();
        await submitButton.click();
        await page.waitForTimeout(5000);

        const currentUrl = page.url();
        const bodyTextAfterClick = await page.locator('body').innerText().catch(() => '');
        if (currentUrl.includes('/browse') || bodyTextAfterClick.includes("Who's watching?")) {
          status = 'logged-in';
          loginSuccess = true;
        } else {
          status = 'login-failed';
        }
      } else {
        // Check if already on home screen
        const currentUrl = page.url();
        const bodyTextAfterClick = await page.locator('body').innerText().catch(() => '');
        if (currentUrl.includes('/browse') || bodyTextAfterClick.includes("Who's watching?")) {
          status = 'logged-in';
          loginSuccess = true;
        } else if (bodyTextAfterClick.match(/Something went wrong/i)) {
          status = 'netflix-error';
        } else {
          status = 'returned-to-login';
        }
      }
    }

    if (loginSuccess) {
      await context.storageState({ path: statePath });
      console.log(`Saved session to: ${statePath}`);
      console.log('>>DONE:Login ke Netflix')
      await handleProfileAndPin(page, headless);
    }

    const bodyText2 = (await page.locator('body').innerText().catch(() => '')).slice(0, 3000);
    const emailValue = await emailInput.first().inputValue().catch(() => '');

    if (debug) {
      await page.screenshot({ path: 'artifacts/netflix-login-state.png', fullPage: true });
    }

    console.log(JSON.stringify({
      ok: loginSuccess,
      status,
      url: page.url(),
      emailValue,
      usePasswordInsteadVisible,
      bodyTextBeforeHelp: bodyText1,
      bodyTextAfterFlow: bodyText2,
      screenshot: debug ? 'artifacts/netflix-login-state.png' : undefined
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
