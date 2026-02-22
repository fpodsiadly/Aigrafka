# Privacy Policy – AIgrafka Extension

**Last updated:** January 31, 2026

## Overview

AIgrafka is a virtual try-on assistant for online fashion stores. This privacy policy explains how the extension collects, uses, and protects user data.

## Data Collection

### User-Provided Data

- **Selfie images**: You upload your selfie locally within the extension to generate virtual try-ons. These images are sent to our backend API to process the garment overlay.
- **Body measurements**: Height, chest, waist, hip dimensions are stored locally in your browser for convenience and may be sent to the backend to improve fit recommendations.
- **Product information**: URLs from reserved.com or uploaded product images are sent to the backend for processing.
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

- Share your data with third parties
- Use your images for any purpose outside virtual try-on generation
- Store images permanently on our servers (images are processed and discarded)
- Sell or monetize your personal information

## Data Storage & Security

- **Local storage**: Your measurements and preferences are stored only on your device.
- **Backend storage**: Images are temporarily processed and not retained after the request completes.
- **API communication**: Data sent to the backend is encrypted via HTTPS.

## Permissions

The extension requests:

- **storage**: To remember your preferences and measurements locally
- **activeTab**: To detect page context
- **scripting**: To inject the UI panel into web pages
- **<all_urls>**: To make requests to the backend API

These permissions are used **only** to provide the core functionality.

## User Rights

You have the right to:

- Request deletion of your local data (clear browser storage)
- Disable the extension at any time
- Opt out of storing preferences by not checking the "Remember" checkbox

## Changes to This Policy

We may update this policy periodically. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

For privacy concerns or questions, please contact: support@aigrafka.pl

---

**By using AIgrafka, you consent to this privacy policy.**
