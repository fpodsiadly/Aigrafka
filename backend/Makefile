PY=python3
VENVDIR=.venv
ACT=source $(VENVDIR)/bin/activate

.PHONY: venv install dev worker migrate start fmt lint test

venv:
	$(PY) -m venv $(VENVDIR)

install: venv
	$(ACT) && pip install --upgrade pip && pip install -r requirements.txt

dev:
	$(ACT) && uvicorn app.main:app --reload --port 8000

worker:
	$(ACT) && python run_worker.py

migrate:
	$(ACT) && alembic upgrade head

start:
	$(ACT) && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $${PORT:-8000}

fmt:
	$(ACT) && black app tests run_worker.py && isort app tests run_worker.py

lint:
	$(ACT) && ruff check app tests run_worker.py

test:
	$(ACT) && pytest tests/ -v
