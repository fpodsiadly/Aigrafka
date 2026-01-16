import Redis from 'ioredis';
import axios from 'axios';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const queueKey = 'aigrafka:ai:jobs';

async function main() {
  while (true) {
    const res = await redis.brpop(queueKey, 5);
    if (!res) continue;
    const [, payload] = res;
    const job = JSON.parse(payload);

    // TODO: fetch product image, call Banana.dev SD pipeline, upload to S3/R2, compute fit note.
    console.log('Processing AI job', job.jobId);
    await axios.post(process.env.BACKEND_RESULT_URL || 'http://localhost:4000/api/ai/result', {
      jobId: job.jobId,
      imageUrl: 'https://placehold.co/320x480?text=AI+render',
      fitNote: 'Mock fit analysis'
    });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
