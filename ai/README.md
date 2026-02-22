# AIgrafka AI

Placeholder package for Banana.dev / Stable Diffusion virtual try-on pipeline.

- Inputs: selfie, product image URL, body metrics, clothing category.
- Outputs: stitched preview image + size fit analysis.
- Queue: Redis-backed worker triggers Banana.dev run and stores results in S3/R2.
- TODO: add worker code, model selection, and safety filtering.
