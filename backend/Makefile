PY=python3
VENVDIR=.venv
ACT=source $(VENVDIR)/bin/activate

.PHONY: venv install dev fmt lint test

venv:
	$(PY) -m venv $(VENVDIR)

install: venv
	$(ACT) && pip install --upgrade pip && pip install -r requirements.txt

dev:
	$(ACT) && uvicorn app.main:app --reload --port 8000

fmt:
	$(ACT) && python -m pip install black isort && black app && isort app

lint:
	$(ACT) && python -m pip install ruff && ruff app

# Placeholder tests; add when tests exist
test:
	$(ACT) && pytest
