import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/**
 * Read-only smoke tests. No login, no data mutation, no accounts created.
 * All navigation happens as an anonymous guest ("Переглянути як гість").
 */

function trackConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  return { errors, pageErrors }
}

async function enterAsGuest(page: Page) {
  await page.getByText('Переглянути як гість').click()
}

test.describe('Smoke', () => {
  test('home page loads (splash screen)', async ({ page }) => {
    const { errors, pageErrors } = trackConsoleErrors(page)

    await page.goto('/')

    await expect(page.getByText('Оренда комерційної нерухомості')).toBeVisible()
    await expect(page.getByText('Увійти / Зареєструватись')).toBeVisible()
    await expect(page.getByText('Переглянути як гість')).toBeVisible()

    expect(pageErrors, `Uncaught exceptions: ${pageErrors.join('; ')}`).toEqual([])
    expect(errors, `console.error calls: ${errors.join('; ')}`).toEqual([])
  })

  test('app loads without a critical (ErrorBoundary) failure', async ({ page }) => {
    const { pageErrors } = trackConsoleErrors(page)

    await page.goto('/')
    await enterAsGuest(page)

    // ErrorBoundary fallback text from src/app/page.tsx — must never appear.
    await expect(page.getByText('Щось пішло не так')).not.toBeVisible()
    expect(pageErrors, `Uncaught exceptions: ${pageErrors.join('; ')}`).toEqual([])
  })

  test('main screens are reachable via bottom navigation (guest)', async ({ page }) => {
    const { errors, pageErrors } = trackConsoleErrors(page)

    await page.goto('/')
    await enterAsGuest(page)

    // Home (default screen after entering as guest)
    await expect(page.getByPlaceholder('Офіс, магазин, склад, район...')).toBeVisible()

    // Обране (guest can view — favorites list is just empty)
    await page.getByText('Обране', { exact: true }).click()
    await expect(page.getByText('Список порожній')).toBeVisible()

    // Профіль (guest sees a login CTA, not real profile data)
    await page.getByText('Профіль', { exact: true }).click()
    await expect(page.getByText('Увійти / Зареєструватись')).toBeVisible()

    // Головна (back home)
    await page.getByText('Головна', { exact: true }).click()
    await expect(page.getByPlaceholder('Офіс, магазин, склад, район...')).toBeVisible()

    expect(pageErrors, `Uncaught exceptions: ${pageErrors.join('; ')}`).toEqual([])
    expect(errors, `console.error calls: ${errors.join('; ')}`).toEqual([])
  })

  test('"Чати" shows the guest login gate — no login, no chat created', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (/supabase\.co\/rest\/v1\/(chats|messages)/.test(url) && req.method() !== 'GET') {
        requests.push(`${req.method()} ${url}`)
      }
    })
    const { errors, pageErrors } = trackConsoleErrors(page)

    await page.goto('/')
    await enterAsGuest(page)

    await page.getByText('Чати', { exact: true }).click()

    // Guest gate: a login prompt, not an actual chat list or conversation.
    await expect(page.getByRole('button', { name: 'Увійти' })).toBeVisible()

    // Guarantee: nothing was written to chats/messages tables.
    expect(requests, `Unexpected mutating chat requests: ${requests.join('; ')}`).toEqual([])
    expect(pageErrors, `Uncaught exceptions: ${pageErrors.join('; ')}`).toEqual([])
    expect(errors, `console.error calls: ${errors.join('; ')}`).toEqual([])
  })
})
