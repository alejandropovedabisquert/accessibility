.PHONY: build up down clean test deploy

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

clean:
	docker compose down --rmi all --volumes --remove-orphans

rebuild: 
	$(MAKE) clean
	$(MAKE) build
	$(MAKE) up

test:
	docker compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from test

logs:
	docker compose logs -f