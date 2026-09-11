# Google Ads: request → booked appointment conversion

This is the agency handoff for counting a **real booked appointment** (not just a form submit) as a Google Ads conversion. The practice team does not need access to Google Ads.

## What the app does

1. **GTM** loads when `VITE_GTM_CONTAINER_ID` is set (`GTM-XXXXXXX`).
2. The public appointment form stores last-paid-click IDs (`gclid` / `gbraid` / `wbraid`), UTMs, and the GA4 `client_id` on the request.
3. When that request is linked to an appointment (online self-schedule **or** staff book/link), the API sends a GA4 Measurement Protocol event named **`appointment_booked`**.
4. `appointment_form_submitted` is a **lead** only. Do not use it as the primary Ads optimization conversion.

## Agency setup

### 1. Link GA4 to Google Ads

In the **same GA4 property** the website already uses (`VITE_GA_MEASUREMENT_ID` / `GA4_MEASUREMENT_ID`):

1. GA4 Admin → **Product links** → **Google Ads links**.
2. Link the practice’s Google Ads account.
3. Enable **Personalized advertising** / auto-tagging if prompted.

### 2. Import `appointment_booked` as a conversion

1. In Google Ads: **Goals** → **Conversions** → **New conversion action** → **Import** → **Google Analytics 4**.
2. Select the event **`appointment_booked`**.
3. Conversion window: **90 days** (matches stored click IDs).
4. Count: **One** (one booked visit per request).
5. Use this as the primary campaign optimization action. Optionally keep `appointment_form_submitted` as a secondary **lead**.

### 3. Google Tag Manager

In the existing container (do **not** add a second GA4 Configuration tag — the app already sends GA4 via gtag):

1. Add **Conversion Linker** (all pages).
2. Optional remarketing / lead tags may fire on the dataLayer event `appointment_form_submitted`.
3. **Do not** fire Google Ads conversion tags from staff routes.

The app pushes `app_surface` (`public` | `staff`) and `page_path` on every route change. Exclude staff with:

- `app_surface` equals `staff`, or
- `page_path` starts with `/schedule`, `/pims`, `/admin`, `/analytics`, `/home`, `/tools`

### 4. What you will not see immediately

- Historical requests booked before this shipped have no stored click IDs.
- Staff-booked conversions can land **days after** the ad click. They still attribute in GA4/Ads when `client_id` or enhanced-conversion hashes match, within the conversion window.
- `appointment_booked` is sent server-side. It will not appear as a browser GTM tag fire on the staff calendar.

## Practice / engineering env vars

**Frontend**

- `VITE_GTM_CONTAINER_ID=GTM-XXXXXXX`
- `VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX` (existing)

**API** (same GA4 property)

- `GA4_MEASUREMENT_ID=G-XXXXXXXXXX`
- `GA4_API_SECRET=` (GA4 Admin → Data collection → Measurement Protocol API secrets)

After deploy, submit a test request from an ads-tagged URL (`?gclid=test`), book it, then confirm `appointment_booked` in GA4 **Admin → DebugView** or realtime events (may take up to 24 hours in standard reports).
