# The Sweep — local dev shortcuts.
# Wraps the npm workspace + db commands. Run `make` (or `make help`) to list targets.
#
# Notes:
#   - Dev uses the shared host Postgres on :5432 (the `sweep` DB). It's expected to be running.
#   - DB / worker targets read DATABASE_URL (+ API_FOOTBALL_KEY) from the git-ignored ./.env.
#   - `make test` (api) needs Docker running — it spins up an ephemeral Postgres via Testcontainers.

.DEFAULT_GOAL := help
.PHONY: help install dev dev-api dev-web test test-api test-web build \
        worker sync crosswalk cutover db-migrate db-seed import-roster \
        provision db-reset psql admin-hash clean

help: ## Show this help
	@echo "The Sweep — make targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all workspace dependencies
	npm install

# ---- run ----
dev: ## Run api (:3000) + web (:5173) together; Ctrl-C stops both
	@echo "api → http://localhost:3000   web → http://localhost:5173"
	@trap 'kill 0' EXIT; \
		npm run dev:api & \
		npm run dev:web & \
		wait

dev-api: ## Run only the Fastify api (--watch, :3000)
	npm run dev:api

dev-web: ## Run only the Vite dev server (:5173, proxies /api → :3000)
	npm run dev:web

# ---- test / build ----
test: test-api test-web ## Run the full test suite (api + web)

test-api: ## Run the api test suite (Vitest + Testcontainers — needs Docker)
	npm run test -w api

test-web: ## Run the web test suite (Vitest + jsdom)
	npm run test -w web

build: ## Production build of the web app
	npm run build

# ---- football worker ----
worker: ## Run the long-running football worker (baseline + live poller)
	npm run worker -w api

sync: ## One-shot baseline football pull (fixtures/standings/predictions)
	npm run sync -w api

crosswalk: ## Fill team_crosswalk provider ids from API-Football
	npm run crosswalk:sync -w api

cutover: ## Re-pin teams to the real WC-2026 field
	npm run cutover -w api

# ---- database ----
db-migrate: ## Apply Drizzle migrations to the sweep DB
	npm run db:migrate -w api

db-seed: ## Seed reference data (teams/people/ownership/scoring)
	npm run db:seed -w api

import-roster: ## Import the real roster (48 players + 96 picks)
	npm run import:roster -w api

provision: db-migrate db-seed import-roster crosswalk cutover ## Full fresh-DB setup, in order
	@echo "Provisioned. Run 'make sync' (or 'make worker') to pull live football data."

db-reset: ## DANGER: drop & recreate the public schema in the sweep dev DB
	@set -a; . ./.env; set +a; \
		echo "This DROPS ALL TABLES in the sweep dev DB ($$DATABASE_URL)."; \
		read -p "Type 'reset' to continue: " c; \
		[ "$$c" = reset ] || { echo "aborted"; exit 1; }; \
		psql "$$DATABASE_URL" -c "drop schema public cascade; create schema public;"; \
		echo "Schema reset. Run 'make provision' to reload."

psql: ## Open a SQL shell on the sweep dev DB
	@set -a; . ./.env; set +a; psql "$$DATABASE_URL"

# ---- misc ----
admin-hash: ## Generate a bcrypt admin passcode hash:  make admin-hash PASS=1234
	@test -n "$(PASS)" || { echo "usage: make admin-hash PASS=<passcode>"; exit 1; }
	npm run admin:hash -w api -- "$(PASS)"

clean: ## Remove build output + local photo uploads (keeps node_modules)
	rm -rf web/dist photos-data api/photos-data
