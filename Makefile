
debug: dcompose
	npm run debug

#run the docker compose file
dcompose:
	docker-compose -f dc-svc-compose/docker-compose.yaml up -d

# run all tests
verify:
	npm run test

stop:
	docker-compose  -f dc-svc-compose/docker-compose.yaml down --remove-orphans 

# delete. everything.
nuke:
	docker-compose  -f dc-svc-compose/docker-compose.yaml down --volumes --remove-orphans 
