.PHONY: help install dev up down logs build clean test typecheck

help:
	@echo "install    Instala dependencias de backend y frontend"
	@echo "dev        Arranca backend (3000) y frontend (3001) en local, sin Docker"
	@echo "up         Levanta todo con Docker en segundo plano"
	@echo "down       Para los contenedores"
	@echo "logs       Sigue los logs"
	@echo "build      Reconstruye las imagenes"
	@echo "test       Ejecuta los tests del backend"
	@echo "typecheck  Comprueba tipos en backend y frontend"
	@echo "clean      Borra contenedores, imagenes y volumenes"

install:
	cd backend && pnpm install
	cd frontend && pnpm install

dev:
	@echo "Comprobando dependencias..."

	@if [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then \
		echo "Dependencias no encontradas. Instalando..."; \
		$(MAKE) install; \
	fi

	@if [ ! -d "$$HOME/.cache/ms-playwright" ]; then \
		echo "Navegadores de Playwright no encontrados. Instalando..."; \
		cd backend && pnpm exec playwright install; \
	fi

	@echo "Backend -> http://localhost:3000   Frontend -> http://localhost:3001"
	@trap 'kill 0' EXIT; \
	(cd backend && pnpm dev) & \
	(cd frontend && pnpm dev) & \
	wait

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build

test:
	cd backend && pnpm test

typecheck:
	cd backend && pnpm lint
	cd frontend && pnpm lint

clean:
	docker compose down --rmi all --volumes --remove-orphans
