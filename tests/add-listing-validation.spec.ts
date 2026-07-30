import { test, expect } from '@playwright/test'

/**
 * Add-listing form validation, using a pre-existing test account.
 *
 * This test never registers an account — it only signs in with credentials
 * supplied via TEST_USER_EMAIL / TEST_USER_PASSWORD (see .env.test.local.example).
 * If those are not set, the test skips itself rather than failing.
 *
 * The form is submitted only with empty fields, to check validation errors —
 * a valid submission is never sent, and a network guard fails the test hard
 * if any mutating request to the listings table is observed regardless.
 */

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD

test.describe('Add listing — empty-form validation', () => {
  test.skip(
    !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'TEST_USER_EMAIL / TEST_USER_PASSWORD not set — skipping (see .env.test.local.example). No account is auto-created.'
  )

  test('submitting the empty form shows validation errors and publishes nothing', async ({ page }) => {
    const mutatingListingRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (/supabase\.co\/rest\/v1\/listings/.test(url) && req.method() !== 'GET') {
        mutatingListingRequests.push(`${req.method()} ${url}`)
      }
    })

    await page.goto('/')
    await page.getByText('Увійти / Зареєструватись').click()

    // Sign-in is the default tab on AuthScreen — fill the form and submit it
    // via the form's submit button specifically (the "signin" tab button has
    // the same label "Увійти", so a plain role/name lookup would be ambiguous).
    await page.getByPlaceholder('email@example.com').fill(TEST_USER_EMAIL!)
    await page.getByPlaceholder('Мінімум 8 символів').fill(TEST_USER_PASSWORD!)
    await page.locator('form button[type="submit"]').click()

    // Either the real Home screen loads (login ok) or an auth error shows —
    // fail with a clear message rather than a confusing timeout.
    const loginError = page.locator('text=⚠️').first()
    await expect(async () => {
      const onHome = await page.getByPlaceholder('Офіс, магазин, склад, район...').isVisible().catch(() => false)
      const hasError = await loginError.isVisible().catch(() => false)
      expect(onHome || hasError).toBe(true)
    }).toPass({ timeout: 10_000 })

    if (await loginError.isVisible().catch(() => false)) {
      test.fail(true, `Login failed for TEST_USER_EMAIL — check the account exists and the password is correct: ${await loginError.textContent()}`)
      return
    }

    // Home's "add listing" CTA only renders for a logged-in user.
    await page.getByText('Додати своє приміщення').click()

    // An account without a phone number cannot reach the real form — surface
    // that clearly instead of failing on a missing field later.
    const needsPhone = page.getByText('Потрібен номер телефону')
    if (await needsPhone.isVisible().catch(() => false)) {
      test.fail(true, 'TEST_USER account has no phone number set — AddListingScreen requires one. Add a phone to the test account.')
      return
    }

    await expect(page.getByText("Додати об'єкт", { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Опублікувати об.єкт/ }).click()

    await expect(page.getByText("Введіть назву об'єкту")).toBeVisible()
    await expect(page.getByText('Введіть коректну ціну (більше 0)')).toBeVisible()
    await expect(page.getByText('Введіть коректну площу (більше 0)')).toBeVisible()
    await expect(page.getByText("Введіть адресу об'єкту")).toBeVisible()

    // Still on the add-listing form — no navigation away, no success toast.
    await expect(page.getByText("Додати об'єкт", { exact: true })).toBeVisible()
    await expect(page.getByText('Оголошення опубліковано')).not.toBeVisible()

    expect(
      mutatingListingRequests,
      `A mutating request to rest/v1/listings was observed — the form must not publish anything: ${mutatingListingRequests.join('; ')}`
    ).toEqual([])
  })
})
