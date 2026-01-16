import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { put } from '@vercel/blob';

// This function is triggered by Vercel Cron (see vercel.json).
// It pulls queued jobs from Redis, processes a small batch, and updates DB.

const redis = new Redis(process.env.REDIS_URL || '');
const prisma = new PrismaClient();
const queueKey = 'aigrafka:ai:jobs';
const BATCH_SIZE = 3;

export default async function handler(req: any, res: any) {
  // Simple auth via secret header (optional)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const jobs: any[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    const popped = await redis.brpop(queueKey, 1);
    if (!popped) break;
    const [, payload] = popped;
    jobs.push(JSON.parse(payload));
  }

  if (!jobs.length) {
    return res.json({ processed: 0 });
  }

  const results = [];

  for (const job of jobs) {
    try {
      // TODO: call Banana.dev; placeholder returns mock image
      const imageUrl = await runInference(job);
      // Optional: store reference in Vercel Blob for serving from CDN
      const blob = await uploadResultToBlob(job.jobId, imageUrl);
      await prisma.fitJob.update({
        where: { id: job.jobId },
        data: { status: 'SUCCEEDED', resultUrl: blob ?? imageUrl, fitNote: 'Mock fit analysis' }
      });
      results.push({ jobId: job.jobId, status: 'SUCCEEDED' });
    } catch (err) {
      console.error('Job failed', job.jobId, err);
      await prisma.fitJob.update({
        where: { id: job.jobId },
        data: { status: 'FAILED', fitNote: 'Processing error' }
      });
      results.push({ jobId: job.jobId, status: 'FAILED' });
    }
  }

  return res.json({ processed: results.length, results });
}

async function runInference(job: any): Promise<string> {
  // Placeholder: call Banana.dev later; for now, return a mock URL
  const mockUrl = 'https://placehold.co/320x480?text=AI+render';
  // Example Banana call (commented):
  // await axios.post(process.env.BANANA_URL!, { ...job });
  await axios.get('https://example.com'); // noop to keep axios imported
  return mockUrl;
}

async function uploadResultToBlob(jobId: string, imageUrl: string): Promise<string | undefined> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return undefined;
  // For placeholder, we just store the imageUrl as text artifact; replace with real image buffer later.
  const { url } = await put(`ai-results/${jobId}.txt`, imageUrl, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN
  });
  return url;
}
