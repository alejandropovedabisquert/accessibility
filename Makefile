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

logs:
	docker compose logs -f