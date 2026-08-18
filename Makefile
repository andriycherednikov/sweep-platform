# The Sweep — local dev shortcuts.
# Wraps the npm workspace + db commands. Run `make` (or `make help`) to list targets.
#
# Notes:
#   - Dev uses the host Postgres on :5432 (the `sweep_platform` DB). It's expected to be running.
#   - DB / worker targets read DATABASE_URL (+ API_FOOTBALL_KEY) from the git-ignored ./.env.
#   - `make test` (api) needs Docker running — it spins up an ephemeral Postgres via Testcontainers.
#   - `make deploy` ships to the portal test server (sweep-portal.yowiebay.au); it
#     needs Docker + `gcloud auth login` and ssh access to the box.

.DEFAULT_GOAL := help
.PHONY: help install dev dev-front dev-api dev-web test test-api test-web build \
        worker sync crosswalk cutover db-migrate db-seed \
        provision db-reset psql admin-hash clean deploy deploy-status logs

help: ## Show this help
	@echo "The Sweep — make targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all workspace dependencies
	npm install

# ---- run ----
dev: ## Run the full stack — api (:3000) + web (:5173) + football worker; Ctrl-C stops all
	@echo "api → http://localhost:3000   web → http://localhost:5173   worker → baseline + live/recovery (needs API_FOOTBALL_KEY)"
	@trap 'kill 0' EXIT; \
		npm run dev:api & \
		npm run dev:web & \
		npm run worker -w api & \
		wait

dev-front: ## Run api + web only, WITHOUT the worker (frontend work, no API-Football calls)
	@echo "api → http://localhost:3000   web → http://localhost:5173   (no worker)"
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

# ---- deploy (portal test server) ----
SERVER    ?= root@134.199.153.212
REMOTE_DIR ?= /root/sweep-portal
S         ?= api

deploy: ## Build+push amd64 images, sync compose, roll out on the server
	./docker/build-and-push.sh
	scp docker/docker-compose.yml $(SERVER):$(REMOTE_DIR)/docker-compose.yml
	ssh $(SERVER) 'cd $(REMOTE_DIR) && docker compose pull && docker compose up -d'
	@$(MAKE) --no-print-directory deploy-status

deploy-status: ## Deployed container state + public health check
	ssh $(SERVER) 'cd $(REMOTE_DIR) && docker compose ps'
	@curl -fsS https://sweep-portal.yowiebay.au/api/health && echo

logs: ## Tail a deployed service log:  make logs S=api|worker|web|migrate
	ssh $(SERVER) 'cd $(REMOTE_DIR) && docker compose logs -f --tail=100 $(S)'

# ---- database ----
db-migrate: ## Apply Drizzle migrations to the dev DB
	npm run db:migrate -w api

db-seed: ## Seed reference data (teams/people/ownership/scoring)
	npm run db:seed -w api

provision: db-migrate db-seed crosswalk cutover ## Full fresh-DB setup, in order
	@echo "Provisioned. Run 'make sync' (or 'make worker') to pull live football data."

db-reset: ## DANGER: drop & recreate the public schema in the dev DB
	@set -a; . ./.env; set +a; \
		echo "This DROPS ALL TABLES in the dev DB ($$DATABASE_URL)."; \
		read -p "Type 'reset' to continue: " c; \
		[ "$$c" = reset ] || { echo "aborted"; exit 1; }; \
		psql "$$DATABASE_URL" -c "drop schema public cascade; create schema public;"; \
		echo "Schema reset. Run 'make provision' to reload."

psql: ## Open a SQL shell on the dev DB
	@set -a; . ./.env; set +a; psql "$$DATABASE_URL"

# ---- misc ----
admin-hash: ## Generate a bcrypt admin passcode hash:  make admin-hash PASS=1234
	@test -n "$(PASS)" || { echo "usage: make admin-hash PASS=<passcode>"; exit 1; }
	npm run admin:hash -w api -- "$(PASS)"

clean: ## Remove build output + local photo uploads (keeps node_modules)
	rm -rf web/dist photos-data api/photos-data
