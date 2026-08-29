.DEFAULT_GOAL := help
.PHONY: help bootstrap up down stop restart build logs logs-service logs-gitea ps \
	sh sh-gitea gitea-cli seed eval reset-demo fresh-start \
	test test-watch typecheck lint preflight check status clean-volumes \
	add

# ---- Help -----------------------------------------------------------------

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ---- Docker lifecycle -------------------------------------------------

bootstrap: ## Bring up Gitea + create admin user/token/target repo (idempotent)
	./bootstrap.sh

up: ## Start Gitea + triage-service (build if needed)
	docker compose up -d --build

down: ## Stop and remove containers (keeps volumes/data)
	docker compose down

stop: ## Stop containers without removing them
	docker compose stop

restart: ## Restart the triage-service container
	docker compose restart triage-service

build: ## Rebuild the triage-service image (needed after package.json changes)
	docker compose up -d --build triage-service

ps: ## Show status of this project's containers
	docker compose ps

status: ## Show container status and service health (GET /health)
	docker compose ps
	@echo
	@curl -s http://localhost:8000/health | jq . || true

logs: ## Tail logs from all containers
	docker compose logs -f

logs-service: ## Tail logs from the triage-service container
	docker compose logs -f triage-service

logs-gitea: ## Tail logs from the gitea container
	docker compose logs -f gitea

# ---- Connecting to containers ------------------------------------------

sh: ## Shell into the running triage-service container
	docker compose exec triage-service sh

sh-gitea: ## Shell into the running gitea container
	docker compose exec -u git gitea sh

gitea-cli: ## Run a `gitea` admin subcommand, e.g. `make gitea-cli ARGS="admin user list"`
	docker compose exec -u git gitea gitea $(ARGS)

# ---- Seeding / demo reset ------------------------------------------------

seed: ## Seed Set A demo issues into the target repo (idempotent)
	docker compose run --rm triage-service npm run seed:set-a

eval: ## Run the eval harness (threshold regression + Set B + Set C) against the live service + real Anthropic API
	docker compose run --rm -e TRIAGE_SERVICE_URL=http://triage-service:8000 triage-service npm run eval

reset-demo: ## Reset just the demo target's Decision Record store (delete acme-app in Gitea's UI first, see service/README.md)
	docker compose down triage-service
	docker volume rm agentic-sdw_triage-decisions
	docker compose up -d --build triage-service

fresh-start: ## Full demo reset to a clean slate (see service/README.md "Fresh start" — delete acme-app in Gitea's UI first)
	@printf '%s\n' \
		"Fresh start requires one manual step first (deliberately not scripted, see service/README.md):" \
		"  Delete the acme-app repo in Gitea's UI:" \
		"  http://localhost:3000/triageadmin/acme-app/settings -> Danger Zone -> Delete This Repository" \
		"Press Enter once that's done, or Ctrl-C to abort."
	@read _ignore
	./bootstrap.sh
	docker compose run --rm triage-service npm run seed:set-a
	docker compose down triage-service
	docker volume rm agentic-sdw_triage-decisions
	docker compose up -d --build triage-service
	docker compose down prometheus grafana loki
	docker volume rm agentic-sdw_prometheus-data agentic-sdw_grafana-data agentic-sdw_loki-data
	docker compose up -d --build prometheus grafana loki

clean-volumes: ## Remove ALL containers and volumes, including Gitea's own data (bug-triage repo included) — full reset from zero, see service/README.md "Fresh start"
	docker compose down -v

# ---- Tests / linters ------------------------------------------------------

test: ## Run the NestJS/Jest test suite (host, requires `npm install` in service/)
	cd service && npm test

test-watch: ## Run the Jest suite in watch mode
	cd service && npm run test:watch

typecheck: ## Run tsc --noEmit against the service
	cd service && npm run typecheck

lint: ## Run eslint against the service
	cd service && npm run lint

preflight: ## Local pre-demo regression check: typecheck + lint + unit tests + eval harness (service must already be up, Set A seeded)
	cd service && npm run preflight

check: test typecheck lint

# ---- Git shortcuts ---------------------------------------------------------

add:
	git add .
	git status
