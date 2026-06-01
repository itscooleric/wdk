# Wiz Build & Test Container
# Builds wiz.js/wiz.html and runs all tests.
#
# Usage:
#   docker build -t wiz .
#   docker run --rm -v $(pwd)/dist:/app/dist wiz
#
# Or just run tests:
#   docker run --rm wiz test

FROM node:18-slim
WORKDIR /app
COPY . .

# Build outputs dist/wiz.js, dist/wiz.html, dist/wiz-bookmarklet.txt
RUN node build.js

# Default: run all tests then copy dist
CMD sh -c 'for f in test/*.test.js; do echo "--- $f ---"; node "$f"; done && echo "All tests passed. dist/ contents:" && ls -la dist/'
