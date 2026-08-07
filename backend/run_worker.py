import asyncio
import logging

from app.core.worker import run_worker

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
