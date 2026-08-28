FROM node:24-slim

# better-sqlite3 compiles a native addon at install time (node-gyp), which
# needs a C++ toolchain and Python not present in the slim base image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
# A fresh named volume mounted at /data inherits this directory's ownership
# on first use (Docker populates an empty volume from the image), so the
# non-root `node` user below can create/open the Decision Record SQLite file.
RUN mkdir -p /data && chown node:node /data
USER node

COPY --chown=node:node package*.json ./
RUN npm ci

COPY --chown=node:node . .

EXPOSE 8000

CMD ["npm", "run", "start:dev"]
