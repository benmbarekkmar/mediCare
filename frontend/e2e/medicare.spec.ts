import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = process.env.E2E_API_URL ?? 'http://localhost:4000/api';
const demoPassword = process.env.E2E_DEMO_PASSWORD ?? '';

const roles = [
  { email: 'admin@medicare.tn', destination: '/admin/dashboard' },
  { email: 'salma.benali@medicare.tn', destination: '/doctor/dashboard' },
  { email: 'reception@medicare.tn', destination: '/reception/dashboard' },
  { email: 'ahmed@medicare.tn', destination: '/patient/dashboard' },
] as const;

type RoleAccount = (typeof roles)[number];

async function assertIsolatedDataset(request: APIRequestContext): Promise<void> {
  const response = await request.get(apiBase + '/status');
  expect(response.ok(), 'the API status endpoint must be available').toBeTruthy();
  const status = (await response.json()) as { dataset?: string };
  expect(status.dataset, 'E2E must never write to the normal medicare dataset').toMatch(/_test$/);
}

async function signIn(page: Page, account: RoleAccount): Promise<string> {
  // The UI normally points at port 4000. During E2E, route its browser calls
  // through the configured test API too, so an isolated API can use another port.
  await page.route('http://localhost:4000/api/**', (route) =>
    route.continue({
      url: route.request().url().replace(/^http:\/\/localhost:4000\/api/, apiBase),
    }),
  );
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(demoPassword);

  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.locator('form button[type="submit"]').click();
  const response = await loginResponse;
  expect(response.ok(), 'login failed for ' + account.email).toBeTruthy();
  await page.waitForURL((url) => url.pathname === account.destination, { timeout: 30_000 });

  const tokens = (await response.json()) as { accessToken: string };
  expect(tokens.accessToken).toBeTruthy();
  return tokens.accessToken;
}

async function apiJson<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  method: 'GET' | 'POST',
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(apiBase + path, {
    method,
    headers: { Authorization: 'Bearer ' + token },
    data,
  });
  expect(response.ok(), method + ' ' + path + ' failed: ' + (await response.text())).toBeTruthy();
  return (await response.json()) as T;
}

async function waitForNlp(request: APIRequestContext, token: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    const response = await request.get(apiBase + '/nlp/health', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (response.ok()) {
      const health = (await response.json()) as { ok?: boolean };
      if (health.ok) return;
      lastStatus = 'health endpoint returned ok=false';
    } else {
      lastStatus = `${response.status()} ${await response.text()}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`NLP service did not become healthy within 60 seconds (${lastStatus}).`);
}

test.beforeEach(async ({ request }) => {
  if (!demoPassword) throw new Error('E2E_DEMO_PASSWORD must be supplied from the private SEED_DEMO_PASSWORD setting.');
  await assertIsolatedDataset(request);
});

test('each seeded role signs in and lands in its own workspace', async ({ browser }) => {
  for (const account of roles) {
    const page = await browser.newPage();
    try {
      await signIn(page, account);
      await expect(page.locator('main')).toBeVisible();
    } finally {
      await page.close();
    }
  }
});

test('staff create a patient and appointment, then the assistant returns SPARQL results', async ({
  browser,
  request,
}) => {
  const adminPage = await browser.newPage();
  const receptionPage = await browser.newPage();
  let adminToken = '';
  let patientId = '';

  try {
    adminToken = await signIn(adminPage, roles[0]);
    const receptionToken = await signIn(receptionPage, roles[2]);

    const doctors = await apiJson<{ id: string; label: string }[]>(
      request,
      adminToken,
      '/doctors/refs?limit=200',
      'GET',
    );
    const diseases = await apiJson<{ id: string; label: string }[]>(
      request,
      adminToken,
      '/diseases/refs?limit=200',
      'GET',
    );
    const departments = await apiJson<{ id: string; label: string }[]>(
      request,
      adminToken,
      '/departments/refs?limit=200',
      'GET',
    );
    const doctor = doctors.find((item) => item.id === 'Doctor_Salma') ?? doctors[0];
    const disease = diseases.find((item) => item.id === 'Diabetes') ?? diseases[0];
    const department = departments.find((item) => item.id === 'GeneralMedicineDepartment_01') ?? departments[0];
    if (!doctor || !disease || !department) throw new Error('The seeded ontology references are missing.');

    const unique = Date.now();
    const patient = await apiJson<{ id: string }>(request, adminToken, '/patients', 'POST', {
      label: 'E2E Patient ' + unique,
      name: 'E2E Patient ' + unique,
      age: 35,
      gender: 'Female',
      phone: '5551234567',
      relations: { doctors: [doctor.id], diseases: [disease.id] },
    });
    patientId = patient.id;

    const appointmentDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    appointmentDate.setHours(10, 0, 0, 0);
    await apiJson(request, receptionToken, '/appointments', 'POST', {
      label: 'E2E appointment ' + unique,
      date: appointmentDate.toISOString(),
      status: 'Pending',
      types: ['Consultation'],
      relations: { patient: [patientId], department: [department.id] },
    });

    const auditResponse = await request.get(apiBase + '/audit?limit=500', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    expect(auditResponse.ok()).toBeTruthy();
    const auditSnapshot = JSON.stringify(await auditResponse.json());
    expect(/E2E Patient|Patient_[A-Za-z0-9_]+/.test(auditSnapshot)).toBe(false);

    await waitForNlp(request, adminToken);
    await adminPage.goto('/tools/assistant');
    await adminPage.locator('#assistant-input').fill('List all the doctors');
    const sendButton = adminPage.locator('.composer__buttons button').last();
    await expect(sendButton).toBeEnabled();
    const assistantResponse = adminPage.waitForResponse(
      (response) => response.url().endsWith('/api/nlp/ask') && response.request().method() === 'POST',
      { timeout: 45_000 },
    );
    await sendButton.click();
    const response = await assistantResponse;
    expect(response.ok(), `assistant request failed: ${await response.text()}`).toBeTruthy();

    const answer = adminPage.locator('.answer').last();
    await expect(answer).toBeVisible({ timeout: 60_000 });
    await expect(answer).toContainText('list_instances');
    await expect(answer).toContainText(/SELECT/i);
    await expect(answer.locator('table tbody tr').first()).toBeVisible();
  } finally {
    if (patientId && adminToken) {
      await request.delete(apiBase + '/patients/' + patientId, {
        headers: { Authorization: 'Bearer ' + adminToken },
      });
    }
    await adminPage.close();
    await receptionPage.close();
  }
});
