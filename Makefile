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
        provision db-reset psql admin-hash clean \
        build-staging deploy-staging deploy staging docker-cleanup

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

# =============================================================================
# DOCKER BUILD & DEPLOY  (server is x86_64; we cross-build amd64 from arm64 Mac)
# =============================================================================
# Images are built for linux/amd64, pushed to GCP Artifact Registry, and pulled
# on the shared server. The app plugs into the shared Postgres + shared Caddy
# (see docker/README.md). The compose file + .env.docker must already live at
# $(STAGING_DIR) on the server (one-time scp — see README).

REGISTRY       := australia-southeast1-docker.pkg.dev/formal-triode-465902-n1/sweep
API_IMAGE      := $(REGISTRY)/sweep-api
WEB_IMAGE      := $(REGISTRY)/sweep-web
STAGING_HOST   := root@134.199.153.212
STAGING_DIR    := /root/sweep
STAGING_DOMAIN := sweep.andriycherednikov.com

GREEN  := \033[0;32m
YELLOW := \033[1;33m
BLUE   := \033[0;34m
RED    := \033[0;31m
NC     := \033[0m

build-staging: ## Build + push amd64 api & web images to Artifact Registry
	@echo "$(BLUE)Building & pushing images for $(STAGING_DOMAIN)...$(NC)"
	cd docker && chmod +x build-and-push.sh && ./build-and-push.sh
	@echo "$(GREEN)Images pushed$(NC)"

deploy-staging: build-staging ## Build, push, then pull & restart on the server
	@echo "$(BLUE)Deploying The Sweep to $(STAGING_HOST)$(NC)"
	@echo "$(YELLOW)[1/3] Authenticating Docker with GCP on the server...$(NC)"
	@TOKEN=$$(gcloud auth print-access-token) && \
		ssh $(STAGING_HOST) "echo '$$TOKEN' | docker login -u oauth2accesstoken --password-stdin australia-southeast1-docker.pkg.dev"
	@echo "$(YELLOW)[2/3] Pulling and restarting containers...$(NC)"
	@ssh $(STAGING_HOST) "cd $(STAGING_DIR) && docker compose pull && docker compose up -d"
	@echo "$(YELLOW)[3/3] Verifying api health...$(NC)"
	@sleep 5
	@ssh $(STAGING_HOST) "docker exec sweep-api node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>{console.log(j);process.exit(j.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})\"" && \
		echo "$(GREEN)Deploy complete → https://$(STAGING_DOMAIN)$(NC)" || \
		(echo "$(RED)Health check failed — check: ssh $(STAGING_HOST) 'cd $(STAGING_DIR) && docker compose logs'$(NC)" && exit 1)

deploy: deploy-staging   ## Alias of deploy-staging
staging: deploy-staging  ## Alias of deploy-staging

docker-cleanup: ## Remove old (non-:latest) image versions from Artifact Registry
	@for img in $(API_IMAGE) $(WEB_IMAGE); do \
		echo "$(YELLOW)Cleaning $$img...$(NC)"; \
		gcloud artifacts docker images list $$img --include-tags \
			--format="csv[no-heading](version,tags)" 2>/dev/null | \
			while IFS=, read -r digest tags; do \
				echo "$$tags" | grep -q "latest" || { \
					echo "  deleting $$digest"; \
					gcloud artifacts docker images delete "$$img@$$digest" --quiet --delete-tags 2>/dev/null || true; }; \
			done; \
	done
