# Privacy Policy – AIgrafka Extension

**Last updated:** October 19, 2026

## Overview

AIgrafka is a virtual try-on assistant for online fashion stores. This privacy policy explains how the extension collects, uses, and protects user data.

## Data Collection

### User-Provided Data

- **Selfie images**: You upload your selfie within the extension to generate virtual try-ons. The selfie is sent to our backend API and, for the duration of the generation, to Google's Gemini API, which renders the try-on image.
- **Body measurements**: Height, chest, waist, hip dimensions are stored locally in your browser for convenience and may be sent to the backend to improve fit recommendations.
- **Product information**: Product page URLs, product images you pick on a store page (downloaded by the extension in full resolution) or upload are sent to the backend for processing.
- **Preferences**: Garment category, style/fit preference (masculine/feminine/unisex) are stored locally and sent to the backend.

### Automatic Data

- **Browser/extension logs**: Non-personally identifiable technical logs (model name, latency, error messages) are logged for debugging and analytics.
- **Storage**: Local browser storage (localStorage, chrome.storage.local) is used to remember your preferences and measurements for future sessions.

## Data Usage

Your data is used **only** to:

1. Generate virtual try-on images
2. Improve fit recommendations based on measurements
3. Enhance the styling experience
4. Fix bugs and optimize performance

We **do NOT**:

- Share your data with third parties other than the processors needed to provide the service: Google (Gemini API) renders try-on images and Przelewy24 processes token payments
- Use your images for any purpose outside virtual try-on generation
- Store images permanently on our servers (see retention periods below)
- Sell or monetize your personal information

## Data Storage & Security

- **Local storage**: Your measurements and preferences are stored only on your device.
- **Backend storage**: Uploaded selfies and product images are processed in memory and are not stored. Generated try-on images (which show your face) are stored temporarily so the extension can display them:
  - result images: up to 1 hour,
  - generation cache (lets an identical request return instantly): up to 24 hours,
  - generation job status: up to 1 hour.
- **Account data**: If you sign in with Google, your email, token balance, body measurements and style preference are stored with your account. Payment records are kept as required by accounting law.
- **Selfie cache in the browser**: The extension keeps a downscaled copy of your last selfie in extension storage for up to 30 days to prefill the form.
- **API communication**: Data sent to the backend is encrypted via HTTPS.

## Permissions

The extension requests:

- **storage**: To remember your preferences, measurements and last selfie locally
- **activeTab**: To read the address of the product page you are viewing
- **identity**: To sign in with Google
- **Host access to http/https pages**: To show the try-on panel on store pages, capture the product image you pick and download it in full resolution

These permissions are used **only** to provide the core functionality.

## User Rights

You have the right to:

- Delete your data at any time with **"Usuń moje dane"** (Delete my data) at the bottom of the extension panel. It removes the selfie and measurements stored in your browser and, when you are signed in, your server-side profile (measurements, style preference) and every stored try-on image of you. Your account (email, token balance) and payment records are kept; to delete the account, contact us.
- Request access to, correction or deletion of your data by contacting us
- Disable the extension at any time

## Changes to This Policy

We may update this policy periodically. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

For privacy concerns or questions, please contact: support@aigrafka.pl

---

**By using AIgrafka, you consent to this privacy policy.**
