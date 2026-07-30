import { test, expect } from '@playwright/test'

/**
 * Mobile viewport (390x844) smoke checks. Read-only, guest flow only.
 * Viewport is pinned here explicitly so this file always runs at 390x844
 * regardless of which Playwright project executes it.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test.describe('Mobile 390x844', () => {
  test('splash screen fits without horizontal overflow', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('Увійти / Зареєструватись')).toBeVisible()

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('bottom navigation is visible and usable after entering as guest', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Переглянути як гість').click()

    await expect(page.getByText('Головна', { exact: true })).toBeVisible()
    await expect(page.getByText('Чати', { exact: true })).toBeVisible()
    await expect(page.getByText('Обране', { exact: true })).toBeVisible()
    await expect(page.getByText('Профіль', { exact: true })).toBeVisible()

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(hasHorizontalOverflow).toBe(false)
  })
})
