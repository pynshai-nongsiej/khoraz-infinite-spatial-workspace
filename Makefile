.PHONY: test check start

test:
	npm test -- --test-reporter=spec

check:
	npm run check

start:
	npm start
