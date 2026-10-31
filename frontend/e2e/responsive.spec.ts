import { expect, test, type Page } from '@playwright/test';

const apiBase = process.env.E2E_API_URL ?? 'http://localhost:4000/api';
const demoPassword = process.env.E2E_DEMO_PASSWORD ?? '';
const widths = [375, 768, 1440] as const;

const accounts = {
  admin: { email: 'admin@medicare.tn', destination: '/admin/dashboard' },
  doctor: { email: 'salma.benali@medicare.tn', destination: '/doctor/dashboard' },
  reception: { email: 'reception@medicare.tn', destination: '/reception/dashboard' },
  patient: { email: 'ahmed@medicare.tn', destination: '/patient/dashboard' },
} as const;
type Account = (typeof accounts)[keyof typeof accounts];

async function routeApi(page: Page): Promise<void> {
  await page.route('http://localhost:4000/api/**', (route) =>
    route.continue({ url: route.request().url().replace(/^http:\/\/localhost:4000\/api/, apiBase) }),
  );
}

async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(demoPassword);
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.locator('form button[type="submit"]').click();
  expect((await loginResponse).ok()).toBeTruthy();
  await page.waitForURL((url) => url.pathname === account.destination);
}

async function assertNoRawTranslationKeys(page: Page, path: string): Promise<void> {
  const rawKeys = await page.evaluate(() => {
    const contents = [
      document.title,
      document.body.innerText,
      ...Array.from(document.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder], [alt]'))
        .flatMap((element) => ['aria-label', 'title', 'placeholder', 'alt'].map((name) => element.getAttribute(name) ?? '')),
    ];
    const keyPattern = /\b[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){2,}\b/g;
    return contents.flatMap((value) => value.match(keyPattern) ?? []).slice(0, 5);
  });
  expect(rawKeys, path + ' should not expose translation keys').toEqual([]);
}
async function assertFits(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('h1').first(), path + ' should render its page heading').toBeVisible({ timeout: 30_000 });
  await assertNoRawTranslationKeys(page, path);
  const actualPath = new URL(page.url()).pathname;
  expect(actualPath, path + ' resolved to ' + actualPath).toBe(path === '/' ? '/login' : path);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const sidebarSelector = path.startsWith('/patient/')
      ? '.portal-sidebar .sidebar'
      : /^\/(admin|doctor|reception|records|tools|calendar|profile|settings)/.test(path)
        ? '.shell__sidebar .sidebar'
        : null;
    if (sidebarSelector) {
      await expect(page.locator(sidebarSelector), path + ' sidebar should remain visible at ' + width + 'px').toBeVisible();
      await expect(page.locator(sidebarSelector + ' .sidebar__logout')).toBeVisible();
    }
    const size = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    const overflowers = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className.slice(0, 100) : '', left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      })
      .filter((element) => element.right > window.innerWidth + 1 || element.left < -1)
      .slice(0, 10));
    expect(Math.max(size.document, size.body), path + ' overflows at ' + width + 'px; elements=' + JSON.stringify(overflowers)).toBeLessThanOrEqual(size.viewport);
  }
}

async function assertIsolatedApi(page: Page): Promise<void> {
  const response = await page.request.get(apiBase + '/status');
  expect(response.ok()).toBeTruthy();
  const status = (await response.json()) as { dataset?: string };
  expect(status.dataset).toMatch(/_test$/);
}

function monitor(page: Page, errors: { page: number; console: number }): void {
  page.on('pageerror', () => errors.page++);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console++;
  });
}

test.beforeEach(async ({ page }) => {
  if (!demoPassword) throw new Error('E2E_DEMO_PASSWORD must be supplied from the private SEED_DEMO_PASSWORD setting.');
  await routeApi(page);
  await assertIsolatedApi(page);
});

test('public and role workspaces fit at 375, 768 and 1440 pixels', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const errors = { page: 0, console: 0 };
  monitor(page, errors);

  const publicPaths = [
    '/library', '/symptoms', '/treatments', '/medications', '/hospitals', '/departments',
    '/find-a-doctor', '/assistant', '/login', '/register', '/forgot-password',
    '/error/403', '/error/404', '/error/500',
  ];
  await assertFits(page, '/');
  await expect(page.locator('a[href$=register]')).toBeVisible();
  for (const path of publicPaths) await assertFits(page, path);
  for (const path of ['/login', '/register']) {
    await page.goto(path);
    await expect(page.locator('.hero__brand')).toContainText('MedicCare');
    await expect(page.locator('.hero__tagline')).toBeVisible();
    await expect(page.locator('.hero__lead, .hero__points')).toHaveCount(0);
  }

  await signIn(page, accounts.admin);
  await page.goto('/');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/dashboard');
  const themeButton = page.getByRole('button', { name: /toggleTheme|th.me/i });
  const previousTheme = await page.evaluate(() => document.documentElement.dataset['theme']);
  await themeButton.click();

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['theme'])).not.toBe(previousTheme);
  const selectedTheme = await page.evaluate(() => document.documentElement.dataset['theme']);
  expect(await page.evaluate(() => localStorage.getItem('medicare.theme'))).toBe(selectedTheme);
  const languageButton = page.locator('.topbar__text-btn[aria-label]');
  const previousLanguage = await page.evaluate(() => document.documentElement.lang);
  const selectedLanguage = previousLanguage === 'en' ? 'fr' : 'en';
  await languageButton.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(selectedLanguage);
  expect(await page.evaluate(() => localStorage.getItem('medicare.lang'))).toBe(selectedLanguage);
  await languageButton.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(previousLanguage);
  const adminPaths = [
    '/admin/dashboard', '/records/patients', '/records/doctors', '/records/diseases', '/records/symptoms',
    '/records/treatments', '/records/medications', '/records/tests', '/records/appointments',
    '/records/hospitals', '/records/departments', '/calendar', '/admin/users', '/admin/audit',
    '/tools/assistant', '/tools/console', '/tools/explorer', '/profile', '/settings',
  ];
  for (const path of adminPaths) await assertFits(page, path);
  await page.goto('/admin/dashboard');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  const renderedCharts = await page.locator('canvas').evaluateAll((items) => items.filter((item) => {
    const canvas = item as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0 && canvas.getContext('2d') !== null;
  }).length);
  expect(renderedCharts).toBeGreaterThan(0);

  await page.goto('/calendar');
  const calendarProbe = await page.evaluate(() => ({
    route: location.pathname,
    calendarPages: document.querySelectorAll('.calendar-page').length,
    calendarHosts: document.querySelectorAll('full-calendar').length,
    fcRoots: document.querySelectorAll('.fc').length,
    toolbarTitles: document.querySelectorAll('.fc-toolbar-title').length,
    mainHeadings: document.querySelectorAll('main h1').length,
  }));
  console.log('calendar DOM probe=' + JSON.stringify(calendarProbe) + '; pageErrors=' + errors.page + '; consoleErrors=' + errors.console);
  await expect(page.locator('.fc .fc-toolbar-title')).toBeVisible({ timeout: 30_000 });
  await page.locator('.fc-timeGridWeek-button').click();
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible({ timeout: 30_000 });
  await page.locator('.fc-timeGridDay-button').click();
  await expect(page.locator('.fc-timeGridDay-view')).toBeVisible({ timeout: 30_000 });
  await page.locator('.fc-dayGridMonth-button').click();
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible({ timeout: 30_000 });

  await page.goto('/tools/explorer');
  await expect(page.locator('.stage canvas').first()).toBeVisible({ timeout: 30_000 });
  const graphCanvases = await page.locator('.stage canvas').evaluateAll((items) => items.filter((item) => {
    const canvas = item as HTMLCanvasElement;
    return canvas.width > 0 && canvas.height > 0 && canvas.getBoundingClientRect().width > 0;
  }).length);
  expect(graphCanvases).toBeGreaterThan(0);
  await page.locator('.shell__sidebar .sidebar__logout').click();
  await page.waitForURL((url) => url.pathname === '/login');
  await page.close();

  const doctorPage = await browser.newPage();
  monitor(doctorPage, errors);
  await routeApi(doctorPage);
  await signIn(doctorPage, accounts.doctor);
  await doctorPage.goto('/');
  await expect.poll(() => new URL(doctorPage.url()).pathname).toBe('/doctor/dashboard');
  for (const path of ['/doctor/dashboard', '/records/patients', '/records/appointments', '/records/tests', '/records/diseases', '/tools/assistant', '/tools/explorer', '/profile', '/settings'])
    await assertFits(doctorPage, path);
  await doctorPage.close();

  const receptionPage = await browser.newPage();
  monitor(receptionPage, errors);
  await routeApi(receptionPage);
  await signIn(receptionPage, accounts.reception);
  await receptionPage.goto('/');
  await expect.poll(() => new URL(receptionPage.url()).pathname).toBe('/reception/dashboard');
  for (const path of ['/reception/dashboard', '/records/appointments', '/records/patients', '/records/doctors', '/records/departments', '/records/hospitals', '/profile', '/settings'])
    await assertFits(receptionPage, path);
  await receptionPage.goto('/tools/assistant');
  expect(new URL(receptionPage.url()).pathname).not.toBe('/tools/assistant');
  await receptionPage.close();

  const patientPage = await browser.newPage();
  monitor(patientPage, errors);
  await routeApi(patientPage);
  await signIn(patientPage, accounts.patient);
  await patientPage.goto('/');
  await expect.poll(() => new URL(patientPage.url()).pathname).toBe('/patient/dashboard');
  for (const path of ['/patient/dashboard', '/patient/record', '/patient/appointments', '/patient/request', '/patient/doctors', '/patient/library', '/patient/hospitals', '/patient/assistant', '/patient/profile', '/patient/settings'])
    await assertFits(patientPage, path);
  await patientPage.goto('/patient/dashboard');
  await expect(patientPage.locator('.greet__eyebrow')).not.toContainText('patient.dashboard.');
  await expect(patientPage.locator('.portal-sidebar .sidebar__logout')).toBeVisible();
  await patientPage.goto('/patient/record');
  await patientPage.emulateMedia({ media: 'print' });
  expect(await patientPage.evaluate(() => matchMedia('print').matches)).toBe(true);
  expect(await patientPage.locator('.printable').evaluate((node) => getComputedStyle(node).display)).toBe('block');
  expect(await patientPage.locator('.no-print').first().evaluate((node) => getComputedStyle(node).display)).toBe('none');
  await patientPage.close();

  expect(errors.page + errors.console).toBe(0);
});