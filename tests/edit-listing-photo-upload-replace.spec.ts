import { test, expect, type Page } from '@playwright/test'
import path from 'path'

/**
 * Real file-picker photo upload + replace, through EditListingForm's actual
 * <input type="file"> — never a direct Storage API call standing in for the
 * UI. Uses locator.setInputFiles() with real PNG files (scripts don't ship
 * fixture images, so these are supplied via env vars — see below).
 *
 * ONLY against a local Supabase instance. Requires:
 *   TEST_OWNER_EMAIL / TEST_OWNER_PASSWORD   — owner of the listing below
 *   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD   — an admin account
 *   TEST_LISTING_TITLE                       — exact title of an existing
 *                                               'active' listing owned by
 *                                               TEST_OWNER, with >=3 photos
 *                                               already (so a significant
 *                                               edit stays >=3 throughout)
 *   TEST_PHOTO_A / TEST_PHOTO_B               — absolute paths to two real,
 *                                               distinct image files
 *
 * If any are unset, the test skips itself — no account or listing is ever
 * created by the test.
 */

const OWNER_EMAIL = process.env.TEST_OWNER_EMAIL
const OWNER_PASSWORD = process.env.TEST_OWNER_PASSWORD
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD
const LISTING_TITLE = process.env.TEST_LISTING_TITLE
const PHOTO_A = process.env.TEST_PHOTO_A
const PHOTO_B = process.env.TEST_PHOTO_B

test.describe('EditListingForm — real file-picker upload and replace', () => {
  test.skip(
    !OWNER_EMAIL || !OWNER_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD || !LISTING_TITLE || !PHOTO_A || !PHOTO_B,
    'TEST_OWNER_EMAIL/PASSWORD, TEST_ADMIN_EMAIL/PASSWORD, TEST_LISTING_TITLE, TEST_PHOTO_A/B not all set — skipping. No account/listing is auto-created.'
  )

  async function login(page: Page, email: string, password: string) {
    await page.goto('/')
    // .isVisible() is a synchronous, non-waiting check — on a fresh
    // context the gate may not have hydrated yet when it runs, silently
    // skipping the click. .click() itself auto-waits for the element to
    // appear and become actionable, so let it do that instead.
    try {
      await page.getByText('Увійти / Зареєструватись').click({ timeout: 8_000 })
    } catch {
      // already past the gate (e.g. the email field is already showing)
    }
    await page.getByPlaceholder('email@example.com').fill(email)
    await page.getByPlaceholder('Мінімум 8 символів').fill(password)
    await page.locator('form button[type="submit"]').click()
    await expect(page.getByText('⚠️').first()).not.toBeVisible({ timeout: 8_000 }).catch(() => {})
  }

  // DesktopHeader (wide viewport) has no "Профіль" text button — the user
  // avatar (initial-letter circle) opens the same ProfileScreen. Mobile's
  // bottom nav has the literal text. Try text first, fall back to the
  // avatar button so this test works under either Playwright project.
  async function openProfile(page: Page) {
    const textBtn = page.getByRole('button', { name: 'Профіль' })
    if (await textBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await textBtn.click()
      return
    }
    await page.locator('header button', { hasText: /^[А-ЯA-Z]$/ }).first().click()
  }

  async function openMyListings(page: Page) {
    await openProfile(page)
    await page.getByRole('button', { name: /Мої оголошення/ }).click()
  }

  async function openEditForListing(page: Page, title: string) {
    // Some fixture rows may be in a different tab (Архів) — check both.
    for (const tabLabel of [null, 'Архів']) {
      if (tabLabel) {
        const tab = page.getByRole('button', { name: new RegExp(tabLabel) })
        if (await tab.isVisible().catch(() => false)) await tab.click()
      }
      const card = page.locator('div', { hasText: title }).filter({ has: page.getByRole('button', { name: 'Керувати оголошенням' }) }).last()
      const menuBtn = card.getByRole('button', { name: 'Керувати оголошенням' })
      if (await menuBtn.isVisible().catch(() => false)) {
        await menuBtn.click()
        await page.getByRole('menuitem', { name: /Редагувати/ }).click()
        return
      }
    }
    throw new Error(`Could not find an editable listing titled "${title}"`)
  }

  // RequestsScreen.tsx builds ZERO menu actions for pending_review (its
  // buildActions() switch has no case for it) — the card renders a direct
  // "Переглянути" trigger instead of the "Керувати оголошенням" dropdown,
  // opening EditListingForm in read-only mode. Used for the reopen-after-
  // first-save check, where the listing is expected to be pending_review.
  async function openReadOnlyView(page: Page, title: string) {
    // The grid (desktop) layout's trigger is an icon-only button whose
    // accessible name comes from aria-label="Переглянути", not visible
    // text — getByRole(..., { name }) matches the accessible name either
    // way, unlike a text-content locator.
    const card = page.locator('div', { hasText: title })
      .filter({ has: page.getByRole('button', { name: /Переглянути/ }) })
      .last()
    await card.getByRole('button', { name: /Переглянути/ }).first().click()
  }

  test('upload a new photo, save, get approved, then replace a photo', async ({ page, browser }) => {
    // Many real steps against a dev server (cold-compile on first hits to
    // each route) — the 30s default is too tight; this is a real E2E flow,
    // not a single-interaction test.
    test.setTimeout(180_000)

    // ── Step 1: owner logs in, opens the editable listing ─────────────────
    await login(page, OWNER_EMAIL!, OWNER_PASSWORD!)
    await openMyListings(page)
    await openEditForListing(page, LISTING_TITLE!)
    await expect(page.getByText("Редагувати об'єкт")).toBeVisible()

    const photoCountLabel = page.locator('span', { hasText: /^\d+\/10$/ })
    const countBefore = await photoCountLabel.textContent()
    await page.screenshot({ path: 'test-results/photo-01-before-upload.png', fullPage: true })

    // ── Step 2: real file-picker upload via the actual hidden input ───────
    page.on('requestfailed', req => console.log('[request failed]', req.method(), req.url(), req.failure()?.errorText))
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(PHOTO_A!)

    // Wait for the upload to actually finish (the ⏳ overlay clears) before
    // touching the count — setInputFiles resolves once the browser has
    // "chosen" the file, not once dbUploadListingImage's network call lands.
    await expect(page.locator('text=⏳').first()).not.toBeVisible({ timeout: 45_000 })
    const countAfterUpload = await photoCountLabel.textContent()
    expect(countAfterUpload).not.toBe(countBefore)
    await page.screenshot({ path: 'test-results/photo-02-after-upload.png', fullPage: true })

    await page.getByRole('button', { name: /Зберегти зміни/ }).click()
    await expect(page.getByText(/Збережено, надіслано на повторну модерацію|Зміни збережено/)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'test-results/photo-03-save-toast.png', fullPage: true })

    // Reopen for real — navigate away and back in, not just trust in-memory
    // state. This significant edit already forced pending_review, so
    // RequestsScreen offers no "Редагувати" menu item for this card at all
    // (buildActions() has no pending_review case) — only the read-only
    // "Переглянути" trigger, which opens the same EditListingForm with
    // readOnly=true. Reading the photo count doesn't need interactivity.
    await page.goto('/')
    await openMyListings(page)
    await openReadOnlyView(page, LISTING_TITLE!)
    await page.screenshot({ path: 'test-results/photo-04-reopened-after-upload.png', fullPage: true })
    const reopenedCount = await photoCountLabel.textContent()
    expect(reopenedCount).toBe(countAfterUpload)

    // ── Step 3: approve as admin (significant edit forced pending_review,
    // which makes this form read-only for the owner until approved) ───────
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    await login(adminPage, ADMIN_EMAIL!, ADMIN_PASSWORD!)
    await openProfile(adminPage)
    await adminPage.getByText('Модерація').click()
    await adminPage.getByText(LISTING_TITLE!).click()
    await adminPage.screenshot({ path: 'test-results/photo-05-admin-queue-detail.png', fullPage: true })
    await adminPage.getByRole('button', { name: /Опублікувати/ }).click()
    await adminPage.getByRole('button', { name: 'Опублікувати', exact: true }).click()
    await expect(adminPage.getByText(LISTING_TITLE!)).not.toBeVisible({ timeout: 15_000 }).catch(() => {})
    await adminContext.close()

    // ── Step 4: back as owner — replace one photo, keep >=3 total ─────────
    await page.goto('/')
    await openMyListings(page)
    await openEditForListing(page, LISTING_TITLE!)
    await expect(page.getByText("Редагувати об'єкт")).toBeVisible()

    // Remove the first thumbnail (the oldest pre-existing photo) via its ✕.
    const firstThumb = page.locator('img[src*="test-photo-0"]').first()
    const removedUrl = await firstThumb.getAttribute('src')
    const removeBtn = firstThumb.locator('xpath=following-sibling::button[1]')
    await removeBtn.click()
    await page.screenshot({ path: 'test-results/photo-06-after-remove.png', fullPage: true })

    await fileInput.setInputFiles(PHOTO_B!)
    await expect(page.locator('text=⏳').first()).not.toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: 'test-results/photo-07-after-second-upload.png', fullPage: true })

    const countBeforeSecondSave = await photoCountLabel.textContent()
    const minPhotos = parseInt(countBeforeSecondSave!.split('/')[0], 10)
    expect(minPhotos).toBeGreaterThanOrEqual(3)

    await page.getByRole('button', { name: /Зберегти зміни/ }).click()
    await expect(page.getByText(/Збережено, надіслано на повторну модерацію|Зміни збережено/)).toBeVisible({ timeout: 15_000 })

    // ── Step 5 (UI half): confirm the new photo shows after a real reopen ─
    // The second save forced pending_review again — same read-only path.
    await page.goto('/')
    await openMyListings(page)
    await openReadOnlyView(page, LISTING_TITLE!)
    await page.screenshot({ path: 'test-results/photo-08-reopened-after-replace.png', fullPage: true })

    const imgs = await page.locator('img').evaluateAll(els => els.map(e => (e as HTMLImageElement).src))
    console.log('REMOVED_URL=' + removedUrl)
    console.log('FINAL_IMAGES=' + JSON.stringify(imgs.filter(u => u.includes('listing-images'))))
  })
})
