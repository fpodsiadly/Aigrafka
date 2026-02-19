import Redis from 'ioredis';
import axios from 'axios';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const queueKey = 'aigrafka:ai:jobs';

async function processVariant(job: any, variantIndex: number): Promise<{ imageUrl: string; latencyMs: number }> {
  const start = performance.now();
  // TODO: fetch product image, call Banana.dev SD pipeline, upload to S3/R2, compute fit note.
  // Each variant should use a different seed or prompt variation for diverse results.
  console.log(`Processing AI job ${job.jobId}, variant ${variantIndex + 1}/${job.variants ?? 1}`);

  // Mock: simulate different results per variant
  const imageUrl = `https://placehold.co/320x480?text=AI+variant+${variantIndex + 1}`;
  const latencyMs = Math.round(performance.now() - start);

  return { imageUrl, latencyMs };
}

async function main() {
  while (true) {
    const res = await redis.brpop(queueKey, 5);
    if (!res) continue;
    const [, payload] = res;
    const job = JSON.parse(payload);

    const variantCount = Math.min(Math.max(job.variants ?? 1, 1), 3);
    console.log(`Processing AI job ${job.jobId} with ${variantCount} variant(s)`);

    const results = [];
    for (let i = 0; i < variantCount; i++) {
      const result = await processVariant(job, i);
      results.push(result);
    }

    await axios.post(process.env.BACKEND_RESULT_URL || 'http://localhost:4000/api/ai/result', {
      jobId: job.jobId,
      imageUrl: results[0].imageUrl,
      variants: results.map(r => ({
        imageUrl: r.imageUrl,
        latencyMs: r.latencyMs
      })),
      fitNote: 'Mock fit analysis'
    });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
